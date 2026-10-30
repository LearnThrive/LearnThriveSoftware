import type { ChatOwner, LibraryStore } from "@learnthrive/data/library";
import type { LibraryStorage } from "@/lib/library/storage";
import type { AssistantConfig, StageBudgets } from "./config";
import { OutputGuard, accountReference, moderateInput, safeguardingExcerpt, type SafeguardingKind } from "./moderation";
import { VOICE_PROMPT_ADDENDUM } from "./speech";
import { BLOCKED_REPLIES, OUTPUT_BLOCKED_REPLY, SAFEGUARDING_REPLY, SYSTEM_PROMPT } from "./prompt";
import { GenerationQueue, QueueAborted, QueueFull, QueueTimeout } from "./queue";
import { ProviderError, type ChatProvider, type ProviderMessage, type ProviderToolCall, type StreamMetrics } from "./types";
import { defuse, describeDocument, preparePhoto, readPdfDocument } from "./documents";
import { deterministicRoute, type RouteDecision } from "./decision";
import { enqueueIndex, drainIndexQueue, describeHits, indexFile, searchUploads, type RetrievalDeps, type RetrievalHit } from "./retrieval";
import { runTool, toolsFor } from "./tools";
import { fallbackStudy, finishStudy, planStudy, prepareStudy, type StudyPrep } from "./study";
import { reviewAnswer, UNCHECKED_WITHHELD } from "./gate";
import { hasCitations, stripCitations } from "./research/citations";
import { ActivityLog, drainActivity, serializeActivity, withActivity, type ActivityEvent, type ActivityOutcome } from "./activity";
import type { ResearchService } from "./research/verify";
import type { EmbeddingProvider } from "./embeddings";
import { defaultTarget, type GenerationTarget } from "./target";
import { runInterface } from "./interface";
import { modelText } from "@/lib/openui/format";
import { interfacePrompt } from "@/lib/openui/library";
import { planInterface } from "@/lib/openui/intent";

/**
 * One question to LearnThrive AI, from the signed-in family's request to the stored answer (plan19 phase F, three-model brief).
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
/** `no_answer`: the model finished without anything to read (a reasoning model that spent its allowance thinking). */
export type ChatErrorCode =
  | "empty"
  | "too_long"
  | "rate_limited_minute"
  | "rate_limited_day"
  | "busy"
  | "unavailable"
  | "timeout"
  | "budget"
  | "vision_unavailable"
  | "no_chat"
  | "aborted"
  | "no_answer";

/** What the page may show while the server has evidence for it. Never a percentage. */
export type ChatStatus = "preparing" | "reading" | "researching" | "verifying" | "thinking";

export type ChatEvent =
  | { type: "session"; sessionId: string }
  /** One step of the real work being done for this answer (activity.ts). Updates to a step arrive with the same id. */
  | ActivityEvent
  | { type: "queued"; position: number }
  | { type: "status"; state: ChatStatus }
  /**
   * Answer text. An ordinary answer streams as many deltas. A held answer (verified or advanced: study.ts) arrives as ONE delta with `whole: true`,
   * only after every check has finished: the complete approved text, its notes included, which the page shows in one go.
   */
  | { type: "delta"; text: string; whole?: true }
  /**
   * An interactive answer (lib/openui, docs/OPENUI.md). `start`: a draft begins (the page clears any earlier one). `chunk`: more of the program, drawn as it
   * arrives with every control off. `discard`: the draft did not pass its checks and must not be used. `final`: the checked interface in its stored form,
   * which replaces the draft; this is what is kept and what a reopened chat shows. If no `final` arrives, the answer is plain text.
   */
  | { type: "ui"; phase: "start" | "discard" } | { type: "ui"; phase: "chunk"; text: string } | { type: "ui"; phase: "final"; content: string }
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
  /** Tells the safeguarding lead. Best effort: a failure never changes what the person sees. */
  flag?: (flag: SafeguardingFlag) => Promise<void>;
  now?: () => Date;
  /** Counters and reason codes only. */
  log?: (outcome: string, details?: Record<string, string | number>) => void;
  /** Whether the provider is a hosted one, which the token budget protects (a local model costs nothing per token). */
  hosted?: boolean;
  /** Web research (Ollama's web search and reader, SearXNG behind them). Absent (tests): nothing is looked up and quotations are reported as unchecked. */
  research?: ResearchService | null;
  /** What generates this turn (target.ts): the provider, the model it is asked for, and that model's limits. Absent: the configured provider with the configured limits. */
  target?: GenerationTarget;
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

const INTERFACE_FALLBACK = "I could not build the interactive version, so here is the explanation in words.\n\n";
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

/**
 * How hard a hosted reasoning model (Beam) should reason for this turn: not at all for ordinary chat (the first word matters), lightly for a question
 * answered from sources, fully for a hard problem. The provider turns this into the endpoint's own control (providers.ts).
 */
export function hostedEffort(mode: "fast" | "verified" | "advanced"): { reasoning: boolean; think: "off" | "low" | "medium" | "high" } {
  if (mode === "advanced") return { reasoning: true, think: "high" };
  if (mode === "verified") return { reasoning: true, think: "low" };
  return { reasoning: false, think: "off" };
}

export async function* sendMessage(deps: ChatServiceDeps, input: ChatInput): AsyncGenerator<ChatEvent> {
  const { store, config } = deps;
  const target = deps.target ?? defaultTarget(config, deps.provider, deps.hosted === true);
  const provider = target.provider;
  const now = (deps.now ?? (() => new Date()))();
  const log = deps.log ?? (() => {});
  const text = input.text.replace(/\r\n/g, "\n").trim();
  const fileIds = [...new Set(input.fileIds ?? [])].slice(0, 3);
  // The turn has its own cancellation, joined to the request's: Stop (or the page going away) ends it, and so does this function when whoever is
  // reading its events stops reading, so work never goes on for a reader who has left (see `settle`, below).
  const turn = new AbortController();
  const turnSignal = turn.signal;
  if (input.signal) {
    if (input.signal.aborted) turn.abort();
    else input.signal.addEventListener("abort", () => turn.abort(), { once: true });
  }

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
  // The real work done for this answer, as it happens: shown live, then kept (sanitised) with the answer. Nothing is added to it for show.
  const activity = new ActivityLog();

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
  // Beam reads text only: a text-based PDF is read as text, and a photo or a scanned page is reported as unsupported (below) rather than guessed at.
  const vision = attachable.length > 0 ? (await provider.capabilities()).vision : false;
  const maxImages = vision ? config.images.perMessage : 0;
  const wantsPicture = /\b(photo|picture|image|diagram|drawing|look at|see (it|that|the)|show me|page\s*\d+)\b/i.test(text);
  // A fresh upload really is being decoded and read here, so saying so is evidence, not decoration. Once per turn.
  let announcedReading = false;
  let readingStep: string | null = null;
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
      readingStep = activity.start("document", "Reading what you sent");
      yield* drainActivity(activity);
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
  if (readingStep) {
    activity.done(readingStep, images.length ? { detail: `${images.length} picture${images.length === 1 ? "" : "s"} ready to look at` } : {});
    yield* drainActivity(activity);
  }
  // ---- routing and retrieval --------------------------------------------------------------------------------------
  // The explicit action and the file metadata win. Only an ambiguous text-only follow-up spends a decision call, and a helper
  // failure falls back to the deterministic route (a greeting is still answered).
  const history = (await store.chat.listMessages(input.owner, sessionId)).map((m) => (m.role === "assistant" ? { ...m, content: modelText(m.content) } : m));
  const hasHistory = history.length > 0;
  const route = deterministicRoute({ text, hasFreshFiles: fresh, hasHistory, explicit: input.intent });
  const intent = route?.intent ?? "general_chat";

  let retrieved: RetrievalHit[] = [];
  const retrievalDeps: RetrievalDeps = { store, embeddings: deps.embeddings ?? null };
  // Retrieval is for text-only turns that refer to earlier material (a direct photo question never waits for the whole index).
  if (config.retrieval.enabled && deps.embeddings && !fresh && attachable.length > 0 && (intent === "search_material" || intent === "explain_question" || intent === "solve_paper" || hasHistory)) {
    // A real search of the family's own uploads: shown as it starts, and how it went once it has.
    const looking = activity.start("document", "Looking through your earlier uploads");
    yield* drainActivity(activity);
    try {
      retrieved = await searchUploads(retrievalDeps, { owner: input.owner, sessionId, query: text || "the uploaded material", topK: config.retrieval.topK, minScore: config.retrieval.minScore, signal: turnSignal });
      activity.done(looking, { detail: retrieved.length ? `${retrieved.length} relevant passage${retrieved.length === 1 ? "" : "s"}` : "nothing relevant found" });
    } catch {
      retrieved = [];
      activity.fail(looking, "could not be searched");
    }
    yield* drainActivity(activity);
  }
  const fileNames = new Map(attachable.map((f, i) => [f.id, `upload ${i + 1}`]));

  // What the server can check before the model answers (quotations, an exam board's documents), and the subject-aware instructions for this turn.
  // A failure here costs the extra checks, never the answer. Spoken turns skip it to stay quick.
  let study: StudyPrep | null = null;
  if (!input.voice) {
    // Reading sources takes a few seconds: say so, so the wait is not mistaken for a stall.
    if (deps.research && planStudy(text, history).ground) yield { type: "status", state: "researching" };
    try {
      // The searches, the pages read and the checks are sent to the page WHILE they run, not after this returns.
      study = yield* withActivity(activity, () => prepareStudy({ text, material: text + uploadedText, history, research: deps.research ?? null, extracts: uploadedText ? [uploadedText] : [], owner: input.owner.clientId, signal: turnSignal, activity }));
    } catch {
      // The preparation failed part-way: whatever it had started is over and did not work, and the turn is still classified (deterministically) so
      // an answer that must be verified is held and checked rather than streamed unchecked. It says no sources could be read.
      log("study_failed");
      activity.closeAll("failed");
      yield* drainActivity(activity);
      study = fallbackStudy({ text, material: text + uploadedText, history, extracts: uploadedText ? [uploadedText] : [] });
    }
  }

  // The history that fits in the context window, newest kept first.
  const userContent = (text || "Please look at the attached file.") + uploadedText + (retrieved.length ? describeHits(retrieved, fileNames) : "") + (study?.evidence ?? "");
  const systemPrompt = input.voice ? `${SYSTEM_PROMPT}\n\n${VOICE_PROMPT_ADDENDUM}` : SYSTEM_PROMPT + (study?.system ?? "");
  const budgetChars = Math.max(2000, (target.contextSize - target.maxOutputTokens - approxTokens(systemPrompt) - approxTokens(userContent)) * 3.5);
  const kept: ProviderMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i]!;
    used += m.content.length;
    if (used > budgetChars) break;
    kept.unshift({ role: m.role, content: m.content });
  }
  const messages: ProviderMessage[] = [{ role: "system", content: systemPrompt }, ...kept, { role: "user", content: userContent, ...(images.length ? { images } : {}) }];

  // Whether this message asks for something better shown as an interface (lib/openui/intent.ts). Never for a spoken turn, and never when an explicit action
  // (the Paper Tutor, "look this up") already decided what the turn is.
  const plan = config.openui.enabled && !input.voice && !input.intent ? planInterface(text) : null;

  // Stored before the model runs, so a stopped or failed answer still leaves the question in the chat.
  const userMessage = await store.chat.appendMessage(input.owner, sessionId, "user", text || "(attached a file)", now);
  if (fresh) await store.chat.attachFiles(input.owner, sessionId, attachable.map((f) => f.id), userMessage.id);

  if (target.hosted && (await store.chat.usageCount(input.owner.clientId, USAGE_TOKENS_DAY, day)) >= config.dailyTokenBudget) {
    log("budget");
    yield { type: "error", code: "budget" };
    return;
  }

  // Every request to the provider goes through here, so a tool round or a repair is counted and charged like the first request.
  const charge = async (completionTokens: number) => {
    if (target.hosted && completionTokens > 0) await store.chat.incrementUsage(input.owner.clientId, USAGE_TOKENS_DAY, day, completionTokens);
  };
  const generate = (prompt: readonly ProviderMessage[], options: Parameters<ChatProvider["stream"]>[1]) => provider.stream(prompt, options);

  // ---- the turn ---------------------------------------------------------------------------------------------------
  const stage: StageBudgets = { ...config.stages, ...target.stages };
  const guard = new OutputGuard();
  let shown = "";
  const st: {
    firstTokenMs: number | null;
    providerId: string | null;
    /** The provider and model that reported finishing ("nim:minimaxai/minimax-m3.1-flash"): what the answer is attributed to. */
    generatedBy: string | null;
    failure: ChatErrorCode | null;
    retryAfterSeconds: number | undefined;
    cutOff: boolean;
    timings: TurnTimings;
  } = {
    firstTokenMs: null,
    cutOff: false,
    providerId: null,
    generatedBy: null,
    failure: null,
    retryAfterSeconds: undefined,
    timings: { queueMs: 0, prepareMs: 0, firstActivityMs: null, firstAnswerMs: null, totalMs: 0, rounds: 0, tools: 0, metrics: null },
  };
  const queuedEvents: ChatEvent[] = [];
  const enqueuedAt = Date.now();

  // Verified and advanced answers are held until every check has finished and then shown whole; those where a wrong quotation, an invented event or
  // a wrong step of working does real harm are also repaired (and, if still wrong, cut or flagged) by the gate before the student reads a word.
  const gated = study?.gated === true;
  let heldUndelivered = gated;
  /** The checking of a held draft failed: the student is told so, and nothing is added to that message as if it were an answer. */
  let withheldUnchecked = false;

  const stream = async function* (): AsyncGenerator<ChatEvent> {
    // The target's model name (a provider also refuses a name that is not its own).
    const model = target.model ?? undefined;
    const caps = await provider.capabilities(model);


    const tools = caps.toolUse && config.maxToolRounds > 0 ? toolsFor(study?.session) : [];
    // A hosted reasoning model reasons by the turn's mode (fast chat, a sourced answer, a hard problem); the mock keeps the configured policy.
    const mode = study?.mode ?? (thinkingFor("auto", text, images.length > 0).reasoning ? "advanced" : "fast");
    const thinking: { reasoning: boolean; think?: boolean | string } = target.hosted ? hostedEffort(mode) : thinkingFor(config.thinking, text, images.length > 0);
    let announcedThinking = false;
    const turnStartedAt = Date.now();
    const turnDeadline = turnStartedAt + stage.turnMs;
    // An interactive answer is tried first when it was asked for. It is checked before the student can use it (interface.ts); if it cannot be made, the answer
    // is given in words, and says so.
    let uiNotice = "";
    if (plan) {
      const uiMessages: ProviderMessage[] = [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${interfacePrompt()}` },
        ...messages.slice(1, -1),
        { role: "user", content: `${messages.at(-1)!.content}\n\n<interface-request>\n${plan.guidance}\n</interface-request>` },
      ];
      const ui = hostedEffort("verified");
      const outcome = yield* runInterface({
        messages: uiMessages,
        generate,
        charge,
        activity,
        research: study?.session ?? null,
        extracts: study?.extracts ?? [],
        maxRepairs: config.openui.maxRepairs,
        signal: turnSignal,
        options: () => ({
          model,
          maxTokens: Math.max(256, Math.min(target.maxOutputTokens + (target.hosted ? target.thinkingTokens : 0), target.contextSize - uiMessages.reduce((n, m) => n + approxTokens(m.content), 0) - 64)),
          temperature: 0.3,
          contextSize: target.contextSize,
          signal: turnSignal,
          firstTokenTimeoutMs: Math.min(stage.firstActivityMs, remaining(turnDeadline)),
          firstAnswerTimeoutMs: Math.min(stage.firstAnswerMs, remaining(turnDeadline)),
          idleTimeoutMs: stage.idleMs,
          totalTimeoutMs: remaining(turnDeadline),
          reasoning: target.hosted ? ui.reasoning : false,
          ...(target.hosted ? { think: ui.think } : {}),
        }),
      });
      log("interface", { ok: outcome.ok ? 1 : 0, kind: plan.kind, repairs: outcome.repairs, issues: outcome.ok ? outcome.firstDraft.length : outcome.issues.length, components: outcome.ok ? outcome.components : 0, quotes: outcome.ok ? outcome.quotes : 0 });
      if (outcome.ok) {
        // Delivered by the `ui` events; this is also what is stored. Nothing is held back for the text gate.
        shown = outcome.content;
        heldUndelivered = false;
        st.timings.totalMs = Date.now() - turnStartedAt;
        return;
      }
      if (turnSignal.aborted) {
        st.failure = "aborted";
        return;
      }
      uiNotice = INTERFACE_FALLBACK;
      // Not held: the notice is the first words of the written answer. Held answers carry it at the front when they are released (below).
      if (!gated) {
        shown = uiNotice;
        yield { type: "delta", text: uiNotice };
      }
    }
    const noticeLength = gated ? 0 : uiNotice.length;

    // Writing the answer is a step like any other. A held answer is a DRAFT until the checks have passed, and the step says so.
    const writeStep = activity.start("write", gated ? "Drafting the answer" : "Writing the answer");
    let wroteText = false;
    yield* drainActivity(activity);
    const toolCtx = {
      store,
      owner: input.owner,
      sessionId,
      fileNames,
      search: async (query: string) => {
        const looking = activity.start("document", "Looking through your uploads");
        try {
          const hits = await searchUploads(retrievalDeps, { owner: input.owner, sessionId, query, topK: config.retrieval.topK, minScore: config.retrieval.minScore, signal: turnSignal });
          activity.done(looking, { detail: hits.length ? `${hits.length} relevant passage${hits.length === 1 ? "" : "s"}` : "nothing relevant found" });
          return hits;
        } catch (error) {
          activity.fail(looking, "could not be searched");
          throw error;
        }
      },
      research: study?.session ?? null,
    };

    let rounds = 0;
    for (;;) {
      const calls: ProviderToolCall[] = [];
      const retryMessages: ProviderMessage[] = [];
      for await (const chunk of generate(messages, {
        model,
        // Thinking spends output tokens: give it its own budget so the final answer is not cut off (measured in the benchmark).
        // The answer's limit plus, when the model may think, its own allowance (thinking and answer share one count), but never more than
        // the context window leaves once the prompt is in it, so the window is not overrun.
        maxTokens: Math.max(256, Math.min(target.maxOutputTokens + (thinking.reasoning ? target.thinkingTokens : 0), target.contextSize - messages.reduce((n, m) => n + approxTokens(m.content), 0) - 64)),
        temperature: 0.4,
        contextSize: target.contextSize,
        signal: turnSignal,
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
          if (chunk.kind === "thinking" && !announcedThinking && shown.length <= noticeLength && st.timings.firstAnswerMs === null) {
            announcedThinking = true;
            yield { type: "status", state: "thinking" };
            // The provider reported hidden reasoning. Only the fact that the model is working it out is shown, never the reasoning itself.
            activity.update(writeStep, { label: "Working it out" });
            yield* drainActivity(activity);
          }
          continue;
        }
        if (chunk.type === "tool_call") {
          calls.push(chunk.call);
          continue;
        }
        if (chunk.type === "text") {
          if (st.timings.firstAnswerMs === null) st.timings.firstAnswerMs = Date.now() - turnStartedAt;
          if (!wroteText) {
            wroteText = true;
            // Text has begun: the model is no longer only working it out.
            if (announcedThinking) {
              activity.update(writeStep, { label: gated ? "Drafting the answer" : "Writing the answer" });
              yield* drainActivity(activity);
            }
          }
          const safe = guard.push(chunk.text);
          if (safe) {
            shown += safe;
            if (!gated) yield { type: "delta", text: safe };
          }
          if (guard.stoppedFor) return;
          continue;
        }
        st.providerId = chunk.provider;
        st.generatedBy = `${chunk.provider}:${chunk.model}`;
        st.firstTokenMs = chunk.stats.firstTokenMs;
        st.cutOff = chunk.cutOff === true;
        st.timings.metrics = chunk.metrics ?? null;
        await charge(chunk.usage.completionTokens);
      }

      // A tool round only while nothing has been shown and the budget allows: a tool call after text would stitch two answers.
      if (!calls.length || shown.length > noticeLength || rounds >= config.maxToolRounds) break;
      rounds += 1;
      st.timings.rounds = rounds;
      const used = calls.slice(0, 2);
      for (const call of used) {
        if (Date.now() > turnDeadline) break;
        // A tool's searches and page reads are recorded by the research session; they reach the page while the tool runs.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const outcome = yield* withActivity(activity, () =>
          Promise.race([
            runTool(call.name, call.arguments, toolCtx, turnSignal),
            new Promise<{ ok: false; content: string; code: "unavailable" }>((resolve) => {
              timer = setTimeout(() => resolve({ ok: false, content: "That tool took too long. Answer without it.", code: "unavailable" }), Math.min(stage.toolRoundMs, remaining(turnDeadline)));
            }),
          ]).finally(() => clearTimeout(timer)),
        );
        st.timings.tools += 1;
        log("tool", { ok: outcome.ok ? 1 : 0, name: tools.some((t) => t.name === call.name) ? 1 : 0 });
        retryMessages.push({ role: "tool", toolName: call.name, toolCallId: call.id, content: outcome.content });
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
      if (!gated) yield { type: "delta", text: rest };
    }
    activity.done(writeStep, { label: gated ? "Drafted the answer" : "Wrote the answer" });
    yield* drainActivity(activity);
    // The gate: the draft is checked, repaired by the model (twice at most) and cut by the server if it is still unsupported. Then it is shown.
    if (gated && study && heldUndelivered && !guard.stoppedFor) {
      if (shown.trim() && study.review) {
        yield { type: "status", state: "verifying" };
        // A corrected rewrite from the model. Not allowed to think, never allowed to overrun the window: if it cannot fit, the draft is cut instead.
        const rewrite = async (instruction: string, draft: string): Promise<string> => {
          const prompt: ProviderMessage[] = [...messages, { role: "assistant", content: draft }, { role: "user", content: instruction }];
          const room = target.contextSize - prompt.reduce((n, m) => n + approxTokens(m.content), 0) - 64;
          if (room < approxTokens(draft) * 0.9) return draft;
          const again = new OutputGuard();
          let out = "";
          let cut = false;
          try {
            // The same target as the draft: a repair is never written by a different model.
            for await (const c of generate(prompt, {
              model,
              maxTokens: Math.min(target.maxOutputTokens, room),
              temperature: 0.2,
              contextSize: target.contextSize,
              signal: turnSignal,
              firstTokenTimeoutMs: stage.firstActivityMs,
              firstAnswerTimeoutMs: stage.firstAnswerMs,
              idleTimeoutMs: stage.idleMs,
              totalTimeoutMs: Math.min(stage.turnMs, target.hosted ? 240_000 : 120_000),
              reasoning: false,
              think: false,
            })) {
              if (c.type === "text") {
                const s = again.push(c.text);
                if (s) out += s;
                if (again.stoppedFor) return draft;
              } else if (c.type === "done") {
                if (c.cutOff) cut = true;
                await charge(c.usage.completionTokens);
              }
            }
            out += again.finish();
          } catch {
            return draft;
          }
          return cut ? draft : out;
        };
        let reviewed: Awaited<ReturnType<typeof reviewAnswer>> | null = null;
        try {
          reviewed = yield* withActivity(activity, () => reviewAnswer(study!, shown, { rewrite, maxRepairs: 2, deadlineMs: target.hosted ? 240_000 : 90_000, activity }));
        } catch {
          reviewed = null;
          // The checks that were under way did not finish.
          activity.closeAll("failed");
          yield* drainActivity(activity);
        }
        study.gate = reviewed;
        // If the checking itself failed, the draft is NOT released: an answer that was never verified is not shown as if it had been.
        shown = reviewed ? reviewed.text : UNCHECKED_WITHHELD;
        withheldUnchecked = !reviewed;
        log("gate", { repairs: reviewed?.repairs ?? -1, firstDraftProblems: reviewed?.firstDraft.length ?? -1, removed: reviewed?.removed.length ?? -1 });
      }
      // Still held: the length note and the server's own notes join the approved text first, and then it is shown whole (below).
    }
    // The model's citation markers (research/citations.ts) are bookkeeping between it and the server: the number names the source a quotation was checked
    // against. They are removed here, once, before a length note or a check note is added and before anything is stored. A held answer that the gate did not
    // review (a biology explanation, say) is covered by the same line, and an answer that never had a marker is not touched at all.
    if (hasCitations(shown)) shown = stripCitations(shown);
    // An answer that hit the length limit says so, instead of stopping mid-sentence as if it had finished. "Continue" carries on from it.
    if (st.cutOff && shown.trim() && !guard.stoppedFor && !withheldUnchecked) {
      const note = `\n\n(This answer reached its length limit, so it stops here. Say "continue" and I will carry on from where it stopped.)`;
      shown += note;
      if (!gated) yield { type: "delta", text: note };
    }
    // The server's own look at the finished reply: marks the evidence lowers, mistakes it can prove, and the sources that were read. Its own lookups
    // (a quotation the reply added) reach the page while they run.
    if (study && shown.trim() && !guard.stoppedFor && !withheldUnchecked) {
      let extra = "";
      try {
        extra = yield* withActivity(activity, () => finishStudy(study!, shown, { activity }));
      } catch {
        extra = "";
        activity.closeAll("failed");
        yield* drainActivity(activity);
      }
      if (extra) {
        shown += extra;
        if (!gated) yield { type: "delta", text: extra };
      }
    }
    // A held answer that follows a failed interface says so at its front.
    if (gated && uiNotice && shown.trim() && !shown.startsWith(uiNotice)) shown = uiNotice + shown;
    // The held answer, released: once, whole, after every check. Not if the student pressed Stop while it was being checked.
    if (gated && heldUndelivered && !guard.stoppedFor) {
      if (turnSignal.aborted) {
        st.failure = "aborted";
        return;
      }
      if (shown.trim()) yield { type: "delta", text: shown, whole: true };
      heldUndelivered = false;
    }
    st.timings.totalMs = Date.now() - turnStartedAt;
  };

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
        signal: turnSignal,
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

  /** The events that close the turn, once the answer has been stored. Null until `settle` has run. */
  let closing: ChatEvent[] | null = null;
  let unexpected: unknown = null;

  /**
   * Everything after the work: how it ended, and keeping what the student was shown. It runs exactly once, and it runs whether or not anyone is
   * still reading the events. When the page goes away mid-turn (Stop closes the connection) the reader stops, the generator is ended at its next
   * `yield`, and the `finally` below calls this: so a stopped answer is stored, as the page promises ("Stop ends a long answer and keeps what was
   * shown"), however the stop and the stream happened to interleave. Nothing in here yields: the events to send are returned, and the caller sends
   * them only if it is still being read.
   */
  const settle = async (): Promise<ChatEvent[]> => {
    if (closing) return closing;
    await work;
    if (crashed instanceof QueueFull || crashed instanceof QueueTimeout) {
      log("busy", { waitedMs: st.timings.queueMs });
      closing = [{ type: "error", code: "busy" }];
      return closing;
    }
    if (crashed instanceof QueueAborted) st.failure = "aborted";
    else if (crashed instanceof ProviderError) {
      // The real failure, said plainly: never replaced by an answer from another model.
      st.failure = crashed.code === "timeout" ? "timeout" : crashed.code === "aborted" ? "aborted" : crashed.code === "empty" ? "no_answer" : "unavailable";
      st.retryAfterSeconds = crashed.retryAfterMs ? Math.max(1, Math.ceil(crashed.retryAfterMs / 1000)) : undefined;
      // A machine word (`unauthorised`, `rate_limited`, `reasoning_exhausted`): never a message body or a key. It is what makes a failed turn diagnosable.
      log("provider_error", { code: crashed.code, detail: crashed.detail ?? crashed.code });
    } else if (crashed) {
      unexpected = crashed;
      closing = [];
      return closing;
    }

    if (study) log("study", { subject: study.ctx.subject ? 1 : 0, activity: study.ctx.activity === "mark_essay" ? 1 : study.ctx.activity === "quote_check" ? 2 : 0, searches: study.session?.searches ?? 0, fetches: study.session?.fetches ?? 0, skipped: study.session?.skipped ?? 0 });
    log("turn", {
      intent: intent === "search_material" ? 1 : intent === "explain_question" ? 2 : intent === "solve_paper" ? 3 : intent === "clarify" ? 4 : 0,
      routedByModel: route?.source === "model" ? 1 : 0,
      retrieved: retrieved.length,
      images: images.length,
      queueMs: st.timings.queueMs,
      prepareMs: st.timings.prepareMs,
      firstActivityMs: st.timings.firstActivityMs ?? -1,
      firstAnswerMs: st.timings.firstAnswerMs ?? -1,
      cutOff: st.cutOff ? 1 : 0,
      turnMs: st.timings.totalMs,
      toolRounds: st.timings.rounds,
      tools: st.timings.tools,
      loadMs: st.timings.metrics?.loadMs ?? -1,
      promptEvalMs: st.timings.metrics?.promptEvalMs ?? -1,
      evalMs: st.timings.metrics?.evalMs ?? -1,
      tokensPerSecond: st.timings.metrics?.tokensPerSecond ?? -1,
    });

    // A held draft that the turn ended before checking (an error, a timeout, the student pressing Stop, a blocked output) is never released: the
    // student sees the error, not an answer that was not verified.
    if (heldUndelivered) {
      shown = "";
      heldUndelivered = false;
    }
    activity.closeAll(st.failure ? "failed" : "done");
    const outcome: ActivityOutcome = !st.failure ? "done" : st.failure === "aborted" ? "stopped" : "failed";
    let blockedNote = "";
    if (guard.stoppedFor) {
      log("output_blocked", { reason: guard.stoppedFor });
      blockedNote = `${shown ? "\n\n" : ""}${OUTPUT_BLOCKED_REPLY}`;
      shown += blockedNote;
    }
    // Who wrote it: what the provider reported when it finished ("ollama_cloud:beam"); without a report it is left unattributed rather than guessed.
    const generatedBy = st.generatedBy;
    let messageId: string | null = null;
    const record = serializeActivity(activity.steps, outcome);
    if (shown.trim()) messageId = (await store.chat.appendMessage(input.owner, sessionId, "assistant", shown, deps.now ? deps.now() : new Date(), { ...(generatedBy ? { generatedBy } : {}), ...(record ? { activity: record } : {}) })).id;

    // Stored. What the page is told, in order: the last of the activity, the blocked-output note, and how the turn ended.
    const out: ChatEvent[] = drainSteps(activity);
    if (blockedNote) out.push({ type: "delta", text: blockedNote });
    if (st.failure && st.failure !== "aborted") {
      out.push({
        type: "error",
        code: st.failure,
        ...(st.retryAfterSeconds && st.failure === "unavailable" ? { retryAfterSeconds: st.retryAfterSeconds } : {}),
      });
    } else out.push({ type: "done", messageId, provider: st.providerId, firstTokenMs: st.firstTokenMs });
    closing = out;
    return out;
  };

  try {
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
    for (const event of await settle()) yield event;
    if (unexpected) throw unexpected;
  } finally {
    // Whoever was reading has gone (the generator was ended at a `yield`, or an error left it): end the work and keep what was shown, as for Stop.
    if (!closing) {
      turn.abort();
      try {
        await settle();
      } catch {
        // Nobody is listening for an error, and ending a reader must never raise one: the failure to keep the partial answer is the only loss.
        log("settle_failed");
      }
    }
  }
}

/** The queued activity of a turn as chat events. */
function drainSteps(log: ActivityLog): ChatEvent[] {
  return log.take().map((step) => ({ type: "activity" as const, step }));
}
