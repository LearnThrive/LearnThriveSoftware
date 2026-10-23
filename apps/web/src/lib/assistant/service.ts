import type { ChatOwner, LibraryStore } from "@learnthrive/data/library";
import type { LibraryStorage } from "@/lib/library/storage";
import { stageBudgetsFor, type AssistantConfig, type StageBudgets } from "./config";
import { OutputGuard, accountReference, moderateInput, safeguardingExcerpt, type SafeguardingKind } from "./moderation";
import { VOICE_PROMPT_ADDENDUM } from "./speech";
import { BLOCKED_REPLIES, OUTPUT_BLOCKED_REPLY, SAFEGUARDING_REPLY, SYSTEM_PROMPT } from "./prompt";
import { GenerationQueue, QueueAborted, QueueFull, QueueTimeout } from "./queue";
import { ProviderError, isWarmable, type ChatProvider, type ProviderMessage, type ProviderToolCall, type StreamMetrics } from "./types";
import { defuse, describeDocument, preparePhoto, readPdfDocument } from "./documents";
import { warmOnce } from "./warmup";
import { deterministicRoute, needsDecision, type RouteDecision, type SystemOneClient } from "./decision";
import { enqueueIndex, drainIndexQueue, describeHits, indexFile, searchUploads, type RetrievalDeps, type RetrievalHit } from "./retrieval";
import { TOOL_DEFINITIONS, runTool } from "./tools";
import type { EmbeddingProvider } from "./embeddings";

/**
 * One question to Study Buddy, from the signed-in family's request to the stored answer (plan19 phase F, three-model brief).
 *
 * The order is the security order, and it is tested without a network:
 *
 *   length and emptiness -> the per-minute and per-day caps (an attempt counts, blocked or not) -> the chat -> input moderation
 *   (a safeguarding match is answered with fixed words, a flag and NO model call) -> the uploads attached to this message ->
 *   the history that fits -> routing (explicit action, file metadata, then the decision model only if ambiguous) -> retrieval
 *   from the family's OWN uploads -> the model that is resident (prepared first, shown as "preparing") -> the provider's stream,
 *   checked sentence by sentence by the OutputGuard -> a bounded tool round trip -> the answer is stored.
 *
 * Deadlines are staged (brief section 7). Prepare (load) and image reading are bounded separately from the turn, and the turn has
 * one ABSOLUTE end that tool rounds and retries never reset. Hidden thinking and tool calls are activity, not the answer: they are
 * reported, but they do not stop the clock on the first visible word. Nothing the person typed, uploaded or was answered is ever
 * logged: `log` receives counters and reason codes only.
 */
export type ChatErrorCode = "empty" | "too_long" | "rate_limited_minute" | "rate_limited_day" | "busy" | "unavailable" | "timeout" | "budget" | "vision_unavailable" | "no_chat" | "aborted";

/** What the page may show while the server has evidence for it. Never a percentage. */
export type ChatStatus = "preparing" | "reading" | "thinking";

export type ChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "queued"; position: number }
  | { type: "status"; state: ChatStatus }
  | { type: "delta"; text: string }
  | { type: "done"; messageId: string | null; provider: string | null; firstTokenMs: number | null }
  | { type: "error"; code: ChatErrorCode; retryAfterSeconds?: number };

export interface SafeguardingFlag {
  reference: string;
  kind: SafeguardingKind;
  excerpt: string;
  at: Date;
}

export interface ChatServiceDeps {
  store: LibraryStore;
  provider: ChatProvider;
  queue: GenerationQueue;
  uploads: LibraryStorage;
  config: AssistantConfig;
  /** The embedding role. Absent: retrieval is off and nothing is indexed. */
  embeddings?: EmbeddingProvider | null;
  /** The decision role. Absent: only explicit actions and file metadata route a turn. */
  decision?: SystemOneClient | null;
  /** Tells the safeguarding lead. Best effort: a failure never changes what the person sees. */
  flag?: (flag: SafeguardingFlag) => Promise<void>;
  now?: () => Date;
  /** Counters and reason codes only. */
  log?: (outcome: string, details?: Record<string, string | number>) => void;
  /** Whether the provider is a hosted one, which the token budget protects (a local model costs nothing per token). */
  hosted?: boolean;
}

export interface ChatInput {
  /** The family and the learner (if any) whose chat this is: resolved on the server, never taken from a request. */
  owner: ChatOwner;
  /** null starts a new chat. */
  sessionId: string | null;
  text: string;
  fileIds?: string[];
  signal?: AbortSignal;
  /** The answer will be spoken: this turn's system prompt asks for short wording that reads well aloud (the stored answer is unchanged). */
  voice?: boolean;
  /** An explicit UI action (the Paper Tutor, "look this up") wins over any classification. */
  intent?: RouteDecision["intent"];
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
export const USAGE_MINUTE = "assistant_message_minute";
export const USAGE_DAY = "assistant_message_day";
export const USAGE_TOKENS_DAY = "assistant_token_day";

const windowStart = (now: Date, size: number) => new Date(Math.floor(now.getTime() / size) * size);

/** A title for the chat list: the first words of the first question, one line, with nothing that looks like a detail of the person. */
function titleFrom(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim().replace(/[<>]/g, "");
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat || "New chat";
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Thinking is selective (brief section 6): off for greetings, ordinary questions and image transcription; on for genuinely
 * multi-step work or when the owner asks for it. The model stays the same one: no fourth reasoning model is loaded.
 */
export function thinkingFor(policy: AssistantConfig["thinking"], text: string, hasImages: boolean): { reasoning: boolean; think?: boolean | string } {
  if (policy === "off") return { reasoning: false };
  if (policy === "on") return { reasoning: true };
  if (policy === "low" || policy === "medium" || policy === "high") return { reasoning: true, think: policy };
  const hard = /\b(prove|show that|hence|simultaneous|quadratic|derive|justify|explain why|deduce|working backwards)\b/i.test(text) || (text.length > 180 && /\d/.test(text) && /\b(solve|find|calculate|work out)\b/i.test(text));
  return { reasoning: hard && !hasImages };
}

/** Per-paragraph timing, for one turn. All relative to the turn's own start; null where the server did not report it. */
interface TurnTimings {
  queueMs: number;
  prepareMs: number;
  firstActivityMs: number | null;
  firstAnswerMs: number | null;
  totalMs: number;
  rounds: number;
  tools: number;
  metrics: StreamMetrics | null;
}

const remaining = (deadline: number) => Math.max(1, deadline - Date.now());

export async function* sendMessage(deps: ChatServiceDeps, input: ChatInput): AsyncGenerator<ChatEvent> {
  const { store, config } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? (() => {});
  const text = input.text.replace(/\r\n/g, "\n").trim();
  const fileIds = [...new Set(input.fileIds ?? [])].slice(0, 3);

  if (!text && fileIds.length === 0) return void (yield { type: "error", code: "empty" });
  if (text.length > config.maxInputChars) return void (yield { type: "error", code: "too_long" });

  // Caps first, and they count the attempt: a flood of blocked messages is still a flood.
  const minute = windowStart(now, MINUTE_MS);
  const day = windowStart(now, DAY_MS);
  const [perMinute, perDay] = await Promise.all([store.chat.usageCount(input.owner.clientId, USAGE_MINUTE, minute), store.chat.usageCount(input.owner.clientId, USAGE_DAY, day)]);
  if (perMinute >= config.perMinute) {
    log("rate_limited", { window: "minute" });
    return void (yield { type: "error", code: "rate_limited_minute", retryAfterSeconds: Math.max(1, Math.ceil((minute.getTime() + MINUTE_MS - now.getTime()) / 1000)) });
  }
  if (perDay >= config.dailyMessages) {
    log("rate_limited", { window: "day" });
    return void (yield { type: "error", code: "rate_limited_day", retryAfterSeconds: Math.ceil((day.getTime() + DAY_MS - now.getTime()) / 1000) });
  }
  await store.chat.incrementUsage(input.owner.clientId, USAGE_MINUTE, minute, 1);
  await store.chat.incrementUsage(input.owner.clientId, USAGE_DAY, day, 1);

  const verdict = moderateInput(text);

  // The chat.
  let sessionId = input.sessionId;
  if (sessionId) {
    if (!(await store.chat.getSession(input.owner, sessionId))) return void (yield { type: "error", code: "no_chat" });
  } else {
    const title = verdict.action === "allow" ? titleFrom(text) : "New chat";
    sessionId = (await store.chat.createSession(input.owner, { title }, now)).id;
  }
  yield { type: "session", sessionId };

  // Fixed replies: the model is not asked.
  if (verdict.action !== "allow") {
    const reply = verdict.action === "safeguard" ? SAFEGUARDING_REPLY : BLOCKED_REPLIES[verdict.category];
    const kept = verdict.action === "block" && verdict.category === "personal_info" ? "[This message was removed because it contained personal details.]" : text;
    await store.chat.appendMessage(input.owner, sessionId, "user", kept, now);
    const stored = await store.chat.appendMessage(input.owner, sessionId, "assistant", reply, now);
    if (verdict.action === "safeguard") {
      log("safeguarding", { kind: verdict.kind });
      if (deps.flag) {
        try {
          await deps.flag({ reference: accountReference(input.owner.clientId), kind: verdict.kind, excerpt: safeguardingExcerpt(text), at: now });
        } catch {
          log("safeguarding_alert_failed");
        }
      }
    } else log("blocked", { category: verdict.category });
    yield { type: "delta", text: reply };
    yield { type: "done", messageId: stored.id, provider: null, firstTokenMs: null };
    return;
  }

  // ---- uploads ---------------------------------------------------------------------------------------------------
  // The files attached to this question, or, for a follow-up with none, the ones attached most recently in this chat. A file
  // that was read before is NOT read again: its stored text is used, and only an explicit request for the picture re-attaches one
  // (the previous code re-sent every page of the paper on every follow-up, breaking the prompt cache and the latency budget).
  const images: string[] = [];
  let uploadedText = "";
  let attachable = fileIds.length ? await store.chat.getUnattachedFiles(input.owner, sessionId, fileIds) : [];
  const fresh = attachable.length > 0;
  if (!fresh) {
    const earlier = (await store.chat.listFiles(input.owner, sessionId)).filter((f) => f.messageId !== null);
    const last = earlier.at(-1)?.messageId;
    attachable = last ? earlier.filter((f) => f.messageId === last) : [];
  }
  const vision = attachable.length > 0 ? (await deps.provider.capabilities(config.visionModel ?? undefined)).vision : false;
  const maxImages = vision ? config.images.perMessage : 0;
  const wantsPicture = /\b(photo|picture|image|diagram|drawing|look at|see (it|that|the)|show me|page\s*\d+)\b/i.test(text);
  // A fresh upload really is being decoded and read here, so saying so is evidence, not decoration. Once per turn.
  let announcedReading = false;
  let index = 0;
  for (const file of attachable) {
    index += 1;
    const label = `${fresh ? "" : "earlier "}upload ${index}`;
    if (!fresh && file.extractedText) {
      // Already read once: the text is enough, and it costs no image tokens and no document work. Only an explicit request for
      // the picture ("look at the diagram on page 2") re-renders the page, and then just one page.
      uploadedText += `\n\n<uploaded-file name="${label}" from="an earlier turn">\n${defuse(file.extractedText)}\n</uploaded-file>`;
      if (wantsPicture && vision && images.length < maxImages && file.contentType === "application/pdf") {
        const againBytes = await deps.uploads.read(file.storagePath);
        if (againBytes) {
          const again = await readPdfDocument(againBytes, { question: text, maxImages: 1, renderLongSide: config.images.renderLongSide });
          if (again.ok) for (const page of again.pages) if (page.image) images.push(Buffer.from(page.image).toString("base64"));
          log("document_revisited", { pages: again.ok ? 1 : 0 });
        }
      }
      continue;
    }
    if (!announcedReading) {
      announcedReading = true;
      yield { type: "status", state: "reading" };
    }
    const bytes = await deps.uploads.read(file.storagePath);
    if (!bytes) {
      uploadedText += `\n\n<uploaded-file name="${label}" missing="true">This file is no longer stored (uploads are deleted after 7 days or with the chat). Tell the student you cannot see it and ask them to upload it again.</uploaded-file>`;
      continue;
    }
    if (file.contentType === "application/pdf") {
      const read = await readPdfDocument(bytes, { question: text, maxImages: maxImages - images.length, renderLongSide: config.images.renderLongSide });
      if (!read.ok) {
        log("document_unreadable", { code: read.problem.code });
        uploadedText += `\n\n<uploaded-file name="${label}" unreadable="true">${defuse(read.problem.message)} Tell the student this plainly; do not guess what the file says.</uploaded-file>`;
        continue;
      }
      uploadedText += `\n\n${describeDocument(label, read, images.length)}`;
      for (const page of read.pages) if (page.image) images.push(Buffer.from(page.image).toString("base64"));
      log("document_read", { pages: read.pageCount, pictured: read.shownAsImages.length, reused: fresh ? 0 : 1 });
      // Keep what it said (for this turn and every later one), then index it in the background for retrieval.
      const plain = read.pages.map((p) => `[page ${p.number}]\n${p.text}`).join("\n\n").replace(/\r\n/g, "\n").slice(0, 32_000);
      if (plain.trim()) {
        await store.chat.setFileReading(input.owner, file.id, { extractedText: plain, pages: read.pageCount });
        if (config.retrieval.enabled) {
          const queued = enqueueIndex({ owner: input.owner, sessionId, fileId: file.id, pages: read.pages.map((p) => ({ number: p.number, text: p.text })) });
          if (queued === "queued") {
            void drainIndexQueue(async (job) => {
              await indexFile({ store, embeddings: deps.embeddings ?? null }, job);
            });
          }
        }
      }
    } else if (vision && images.length < maxImages) {
      // The stored original is never changed; what is sent is a bounded, upright, metadata-free copy at the measured size.
      const kind = file.contentType === "image/png" ? "png" : "jpeg";
      const prepared = await preparePhoto(bytes, kind, { longSide: config.images.photoLongSide });
      const picture = prepared.ok ? prepared.bytes : bytes;
      images.push(Buffer.from(picture).toString("base64"));
      uploadedText += `\n\n<uploaded-file name="${label}" type="photo" picture="${images.length}"></uploaded-file>`;
    } else if (!vision) {
      log("vision_unavailable");
      yield { type: "error", code: "vision_unavailable" };
      return;
    } else {
      uploadedText += `\n\n<uploaded-file name="${label}" type="photo" note="not shown: too many pictures in one message"></uploaded-file>`;
    }
  }
  // ---- routing and retrieval --------------------------------------------------------------------------------------
  // The explicit action and the file metadata win. Only an ambiguous text-only follow-up spends a decision call, and a helper
  // failure falls back to the deterministic route (a greeting is still answered).
  const history = await store.chat.listMessages(input.owner, sessionId);
  const hasHistory = history.length > 0;
  let route = deterministicRoute({ text, hasFreshFiles: fresh, hasHistory, explicit: input.intent });
  if (!route && config.decision.enabled && deps.decision && needsDecision(text, fresh, hasHistory)) {
    try {
      route = await deps.decision.route(`Student message: ${text.slice(0, 400)}${fresh ? ` (a new ${images.length ? "picture" : "file"} is attached)` : ""}`);
    } catch {
      route = null;
    }
    if (route) log("routed", { by: "model", intent: route.intent });
  }
  const intent = route?.intent ?? "general_chat";

  let retrieved: RetrievalHit[] = [];
  const retrievalDeps: RetrievalDeps = { store, embeddings: deps.embeddings ?? null };
  // Retrieval is for text-only turns that refer to earlier material (a direct photo question never waits for the whole index).
  if (config.retrieval.enabled && deps.embeddings && !fresh && attachable.length > 0 && (intent === "search_material" || intent === "explain_question" || intent === "solve_paper" || hasHistory)) {
    try {
      retrieved = await searchUploads(retrievalDeps, { owner: input.owner, sessionId, query: text || "the uploaded material", topK: config.retrieval.topK, minScore: config.retrieval.minScore, signal: input.signal });
    } catch {
      retrieved = [];
    }
  }
  const fileNames = new Map(attachable.map((f, i) => [f.id, `upload ${i + 1}`]));

  // The history that fits in the context window, newest kept first.
  const userContent = (text || "Please look at the attached file.") + uploadedText + (retrieved.length ? describeHits(retrieved, fileNames) : "");
  const systemPrompt = input.voice ? `${SYSTEM_PROMPT}\n\n${VOICE_PROMPT_ADDENDUM}` : SYSTEM_PROMPT;
  const budgetChars = Math.max(2000, (config.contextSize - config.maxOutputTokens - approxTokens(systemPrompt) - approxTokens(userContent)) * 3.5);
  const kept: ProviderMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i]!;
    used += m.content.length;
    if (used > budgetChars) break;
    kept.unshift({ role: m.role, content: m.content });
  }
  const messages: ProviderMessage[] = [{ role: "system", content: systemPrompt }, ...kept, { role: "user", content: userContent, ...(images.length ? { images } : {}) }];

  // Stored before the model runs, so a stopped or failed answer still leaves the question in the chat.
  const userMessage = await store.chat.appendMessage(input.owner, sessionId, "user", text || "(attached a file)", now);
  if (fresh) await store.chat.attachFiles(input.owner, sessionId, attachable.map((f) => f.id), userMessage.id);

  if (deps.hosted && (await store.chat.usageCount(input.owner.clientId, USAGE_TOKENS_DAY, day)) >= config.dailyTokenBudget) {
    log("budget");
    yield { type: "error", code: "budget" };
    return;
  }

  // ---- the turn ---------------------------------------------------------------------------------------------------
  const stage: StageBudgets = stageBudgetsFor(config, images.length > 0);
  const guard = new OutputGuard();
  let shown = "";
  const st: { firstTokenMs: number | null; providerId: string | null; failure: ChatErrorCode | null; timings: TurnTimings } = {
    firstTokenMs: null,
    providerId: null,
    failure: null,
    timings: { queueMs: 0, prepareMs: 0, firstActivityMs: null, firstAnswerMs: null, totalMs: 0, rounds: 0, tools: 0, metrics: null },
  };
  const queuedEvents: ChatEvent[] = [];
  const enqueuedAt = Date.now();

  const stream = async function* (): AsyncGenerator<ChatEvent> {
    const model = images.length && config.visionModel ? config.visionModel : config.model;
    const caps = await deps.provider.capabilities(model);

    // Prepare the model only when the server says it is not resident, and say so only then (evidence, not a guess).
    if (isWarmable(deps.provider) && (await deps.provider.resident(model)) !== true) {
      yield { type: "status", state: "preparing" };
      const prepared = await warmOnce({ provider: deps.provider, model, contextSize: config.contextSize, keepAlive: config.keepAlive }, { signal: input.signal, budgetMs: stage.loadMs });
      st.timings.prepareMs = Date.now() - enqueuedAt;
      log("prepared", { ok: prepared.ok ? 1 : 0, loadMs: prepared.loadMs ?? -1, detail: prepared.detail });
      if (!prepared.ok) {
        st.failure = prepared.detail === "aborted" ? "aborted" : "unavailable";
        return;
      }
    }

    const tools = caps.toolUse && config.maxToolRounds > 0 ? TOOL_DEFINITIONS : [];
    const thinking = thinkingFor(config.thinking, text, images.length > 0);
    const turnStartedAt = Date.now();
    const turnDeadline = turnStartedAt + stage.turnMs;
    const toolCtx = {
      store,
      owner: input.owner,
      sessionId,
      fileNames,
      search: (query: string) => searchUploads(retrievalDeps, { owner: input.owner, sessionId, query, topK: config.retrieval.topK, minScore: config.retrieval.minScore, signal: input.signal }),
    };

    let rounds = 0;
    for (;;) {
      const calls: ProviderToolCall[] = [];
      const retryMessages: ProviderMessage[] = [];
      for await (const chunk of deps.provider.stream(messages, {
        model,
        // Thinking spends output tokens: give it its own budget so the final answer is not cut off (measured in the benchmark).
        maxTokens: config.maxOutputTokens + (thinking.reasoning ? config.thinkingTokens : 0),
        temperature: 0.4,
        contextSize: config.contextSize,
        signal: input.signal,
        keepAlive: config.keepAlive,
        firstTokenTimeoutMs: Math.min(stage.firstActivityMs, remaining(turnDeadline)),
        firstAnswerTimeoutMs: Math.min(stage.firstAnswerMs, remaining(turnDeadline)),
        idleTimeoutMs: stage.idleMs,
        totalTimeoutMs: remaining(turnDeadline),
        reasoning: thinking.reasoning,
        ...(thinking.think !== undefined ? { think: thinking.think } : {}),
        ...(tools.length ? { tools } : {}),
      })) {
        if (chunk.type === "activity") {
          if (st.timings.firstActivityMs === null) st.timings.firstActivityMs = Date.now() - turnStartedAt;
          // Activity is not the answer: report it once, do not touch the visible-answer clock.
          if (chunk.kind === "thinking" && !shown && st.timings.firstAnswerMs === null) yield { type: "status", state: "thinking" };
          continue;
        }
        if (chunk.type === "tool_call") {
          calls.push(chunk.call);
          continue;
        }
        if (chunk.type === "text") {
          if (st.timings.firstAnswerMs === null) st.timings.firstAnswerMs = Date.now() - turnStartedAt;
          const safe = guard.push(chunk.text);
          if (safe) {
            shown += safe;
            yield { type: "delta", text: safe };
          }
          if (guard.stoppedFor) return;
          continue;
        }
        st.providerId = chunk.provider;
        st.firstTokenMs = chunk.stats.firstTokenMs;
        st.timings.metrics = chunk.metrics ?? null;
        if (deps.hosted) await store.chat.incrementUsage(input.owner.clientId, USAGE_TOKENS_DAY, day, chunk.usage.completionTokens);
      }

      // A tool round only while nothing has been shown and the budget allows: a tool call after text would stitch two answers.
      if (!calls.length || shown || rounds >= config.maxToolRounds) break;
      rounds += 1;
      st.timings.rounds = rounds;
      const used = calls.slice(0, 2);
      for (const call of used) {
        if (Date.now() > turnDeadline) break;
        const outcome = await Promise.race([
          runTool(call.name, call.arguments, toolCtx, input.signal),
          new Promise<{ ok: false; content: string; code: "unavailable" }>((resolve) => setTimeout(() => resolve({ ok: false, content: "That tool took too long. Answer without it.", code: "unavailable" }), Math.min(stage.toolRoundMs, remaining(turnDeadline)))),
        ]);
        st.timings.tools += 1;
        log("tool", { ok: outcome.ok ? 1 : 0, name: TOOL_DEFINITIONS.some((t) => t.name === call.name) ? 1 : 0 });
        retryMessages.push({ role: "tool", toolName: call.name, content: outcome.content });
      }
      messages.push({ role: "assistant", content: "", toolCalls: used }, ...retryMessages);
      if (Date.now() > turnDeadline) {
        st.failure = "timeout";
        return;
      }
    }

    const rest = guard.finish();
    if (rest) {
      shown += rest;
      yield { type: "delta", text: rest };
    }
    st.timings.totalMs = Date.now() - turnStartedAt;
  };

  try {
    // The queue runs the generator inside its slot; events are collected as they are produced and yielded below.
    const pending: ChatEvent[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    let crashed: unknown = null;
    const work = deps.queue
      .run(
        async () => {
          for await (const event of stream()) {
            pending.push(event);
            wake?.();
          }
        },
        {
          signal: input.signal,
          maxWaitMs: stage.queueMs,
          onWait: (position) => {
            st.timings.queueMs = Date.now() - enqueuedAt;
            queuedEvents.push({ type: "queued", position });
            wake?.();
          },
        },
      )
      .catch((error) => {
        crashed = error;
      })
      .finally(() => {
        finished = true;
        wake?.();
      });

    for (;;) {
      while (queuedEvents.length) yield queuedEvents.shift()!;
      while (pending.length) yield pending.shift()!;
      if (finished) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (pending.length || queuedEvents.length || finished) resolve();
      });
      wake = null;
    }
    await work;
    if (crashed instanceof QueueFull || crashed instanceof QueueTimeout) {
      log("busy", { waitedMs: st.timings.queueMs });
      yield { type: "error", code: "busy" };
      return;
    }
    if (crashed instanceof QueueAborted) st.failure = "aborted";
    else if (crashed instanceof ProviderError) {
      st.failure = crashed.code === "timeout" ? "timeout" : crashed.code === "aborted" ? "aborted" : "unavailable";
      log("provider_error", { code: crashed.code });
    } else if (crashed) throw crashed;
  } finally {
    // Whatever was shown is stored, even if the person stopped it or the model failed halfway.
  }

  log("turn", {
    intent: intent === "search_material" ? 1 : intent === "explain_question" ? 2 : intent === "solve_paper" ? 3 : intent === "clarify" ? 4 : 0,
    routedByModel: route?.source === "model" ? 1 : 0,
    retrieved: retrieved.length,
    images: images.length,
    queueMs: st.timings.queueMs,
    prepareMs: st.timings.prepareMs,
    firstActivityMs: st.timings.firstActivityMs ?? -1,
    firstAnswerMs: st.timings.firstAnswerMs ?? -1,
    turnMs: st.timings.totalMs,
    toolRounds: st.timings.rounds,
    tools: st.timings.tools,
    loadMs: st.timings.metrics?.loadMs ?? -1,
    promptEvalMs: st.timings.metrics?.promptEvalMs ?? -1,
    evalMs: st.timings.metrics?.evalMs ?? -1,
    tokensPerSecond: st.timings.metrics?.tokensPerSecond ?? -1,
  });

  if (guard.stoppedFor) {
    log("output_blocked", { reason: guard.stoppedFor });
    const note = `${shown ? "\n\n" : ""}${OUTPUT_BLOCKED_REPLY}`;
    shown += note;
    yield { type: "delta", text: note };
  }
  let messageId: string | null = null;
  if (shown.trim()) messageId = (await store.chat.appendMessage(input.owner, sessionId, "assistant", shown, deps.now ? deps.now() : new Date())).id;
  if (st.failure && st.failure !== "aborted") {
    yield { type: "error", code: st.failure };
    return;
  }
  yield { type: "done", messageId, provider: st.providerId, firstTokenMs: st.firstTokenMs };
}
