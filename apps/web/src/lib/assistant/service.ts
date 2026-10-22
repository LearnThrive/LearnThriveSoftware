import type { ChatOwner, LibraryStore } from "@learnthrive/data/library";
import type { LibraryStorage } from "@/lib/library/storage";
import type { AssistantConfig } from "./config";
import { OutputGuard, accountReference, moderateInput, safeguardingExcerpt, type SafeguardingKind } from "./moderation";
import { VOICE_PROMPT_ADDENDUM } from "./speech";
import { BLOCKED_REPLIES, OUTPUT_BLOCKED_REPLY, SAFEGUARDING_REPLY, SYSTEM_PROMPT } from "./prompt";
import { GenerationQueue, QueueAborted, QueueFull } from "./queue";
import { ProviderError, type ChatProvider, type ProviderMessage } from "./types";
import { DOCUMENT_LIMITS, defuse, describeDocument, readPdfDocument } from "./documents";

/**
 * One question to Study Buddy, from the signed-in family's request to the stored answer (plan19 phase F). The route is a thin
 * wrapper; this is where the order of the checks lives, so it is tested without a network:
 *
 *   length and emptiness -> the per-minute and per-day caps (an attempt counts, blocked or not) -> the chat -> input moderation
 *   (a safeguarding match is answered with fixed words, a flag and NO model call; a blocked one with a fixed reply) -> the
 *   uploads attached to this message -> the history that fits -> the hosted-provider cost cap -> the queue -> the provider's
 *   stream, checked sentence by sentence by the OutputGuard before any of it is shown -> the answer is stored.
 *
 * Nothing the person typed, uploaded or was answered is ever logged: `log` receives counters and reason codes only.
 * Personal details are never stored: a message that carries them is replaced by a notice before it is saved.
 */
export type ChatErrorCode = "empty" | "too_long" | "rate_limited_minute" | "rate_limited_day" | "busy" | "unavailable" | "timeout" | "budget" | "vision_unavailable" | "no_chat" | "aborted";

export type ChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "queued"; position: number }
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

  // Uploads: the files attached to this question or, for a follow-up with none, the ones attached most recently in this chat, so
  // "and question 3?" still sees the paper. Each document is read page by page; pages are pictured within one shared budget.
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
  const maxImages = vision ? DOCUMENT_LIMITS.imagesPerMessage : 0;
  let index = 0;
  for (const file of attachable) {
    index += 1;
    const label = `${fresh ? "" : "earlier "}upload ${index}`;
    const bytes = await deps.uploads.read(file.storagePath);
    if (!bytes) {
      uploadedText += `\n\n<uploaded-file name="${label}" missing="true">This file is no longer stored (uploads are deleted after 7 days or with the chat). Tell the student you cannot see it and ask them to upload it again.</uploaded-file>`;
      continue;
    }
    if (file.contentType === "application/pdf") {
      const read = await readPdfDocument(bytes, { question: text, maxImages: maxImages - images.length });
      if (!read.ok) {
        log("document_unreadable", { code: read.problem.code });
        uploadedText += `\n\n<uploaded-file name="${label}" unreadable="true">${defuse(read.problem.message)} Tell the student this plainly; do not guess what the file says.</uploaded-file>`;
        continue;
      }
      uploadedText += `\n\n${describeDocument(label, read, images.length)}`;
      for (const page of read.pages) if (page.image) images.push(Buffer.from(page.image).toString("base64"));
      log("document_read", { pages: read.pageCount, pictured: read.shownAsImages.length });
    } else if (vision && images.length < maxImages) {
      images.push(Buffer.from(bytes).toString("base64"));
      uploadedText += `\n\n<uploaded-file name="${label}" type="photo" picture="${images.length}"></uploaded-file>`;
    } else if (!vision) {
      log("vision_unavailable");
      yield { type: "error", code: "vision_unavailable" };
      return;
    } else {
      uploadedText += `\n\n<uploaded-file name="${label}" type="photo" note="not shown: too many pictures in one message"></uploaded-file>`;
    }
  }

  // The history that fits in the context window, newest kept first.
  const history = await store.chat.listMessages(input.owner, sessionId);
  const userContent = (text || "Please look at the attached file.") + uploadedText;
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

  // Wait for a turn, then stream.
  const guard = new OutputGuard();
  let shown = "";
  // Assigned from inside the stream below, so they live on an object (TypeScript cannot see closure writes to a plain let).
  const st: { firstTokenMs: number | null; providerId: string | null; failure: ChatErrorCode | null } = { firstTokenMs: null, providerId: null, failure: null };
  const queuedEvents: ChatEvent[] = [];

  const stream = async function* (): AsyncGenerator<ChatEvent> {
    try {
      for await (const chunk of deps.provider.stream(messages, {
        maxTokens: config.maxOutputTokens,
        temperature: 0.4,
        contextSize: config.contextSize,
        signal: input.signal,
        firstTokenTimeoutMs: config.firstTokenTimeoutMs,
        totalTimeoutMs: config.totalTimeoutMs,
        ...(images.length && config.visionModel ? { model: config.visionModel } : {}),
      })) {
        if (chunk.type === "text") {
          const safe = guard.push(chunk.text);
          if (safe) {
            shown += safe;
            yield { type: "delta", text: safe };
          }
          if (guard.stoppedFor) return;
        } else {
          st.providerId = chunk.provider;
          st.firstTokenMs = chunk.stats.firstTokenMs;
          if (deps.hosted) await store.chat.incrementUsage(input.owner.clientId, USAGE_TOKENS_DAY, day, chunk.usage.completionTokens);
          log("answered", { promptTokens: chunk.usage.promptTokens, completionTokens: chunk.usage.completionTokens, firstTokenMs: chunk.stats.firstTokenMs });
        }
      }
      const rest = guard.finish();
      if (rest) {
        shown += rest;
        yield { type: "delta", text: rest };
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        st.failure = error.code === "timeout" ? "timeout" : error.code === "aborted" ? "aborted" : "unavailable";
        log("provider_error", { code: error.code });
      } else throw error;
    }
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
        { signal: input.signal, onWait: (position) => (queuedEvents.push({ type: "queued", position }), wake?.()) },
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
    if (crashed instanceof QueueFull) {
      log("busy");
      yield { type: "error", code: "busy" };
      return;
    }
    if (crashed instanceof QueueAborted) st.failure = "aborted";
    else if (crashed) throw crashed;
  } finally {
    // Whatever was shown is stored, even if the person stopped it or the model failed halfway.
  }

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
