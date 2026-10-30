/**
 * The assistant's provider boundary (plan19 section 5.1). Everything above it (the chat service, the routes, the benchmark)
 * talks to `ChatProvider`, never to a concrete model server, so Ollama Cloud (Beam, in development)
 * (development only) and a production provider chosen later are interchangeable.
 *
 * A turn is not only text: a model may think before it answers and may ask the server to run a read-only tool. Both are
 * ACTIVITY (evidence the backend is working) but neither is the student-facing answer; the service keeps the two clocks apart
 * (`activity` and `text` chunks) so a hidden pause can never be mistaken for progress (brief section 7).
 */
export type ProviderRole = "system" | "user" | "assistant" | "tool";

/** A tool the tutor may ask the server to run. The schema is JSON Schema, validated by the caller before any tool runs. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** One tool call the model asked for, with its arguments already parsed (never executed here). */
export interface ProviderToolCall {
  /** The provider's id when it gives one, otherwise the index within the message (`call-1`). Used to pair the result. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderMessage {
  role: ProviderRole;
  content: string;
  /** Base64 image data without a `data:` prefix. Only for models that can see. */
  images?: string[];
  /** On an assistant message: the tools it asked for. */
  toolCalls?: ProviderToolCall[];
  /** On a tool message: the tool the content answers. */
  toolName?: string;
  /** On a tool message: the id of the call it answers (OpenAI-compatible endpoints pair a result with its call by this). */
  toolCallId?: string;
}

export interface ProviderCapabilities {
  vision: boolean;
  jsonMode: boolean;
  toolUse: boolean;
  /** The largest context window the model accepts, in tokens (0 when unknown). */
  maxContext: number;
  /** Whether the model can think before answering; null when the server does not say. */
  thinking?: boolean | null;
  /** The values `/api/show` reports for `think` (booleans or level names). Empty when unsupported. */
  thinkingValues?: Array<boolean | string>;
  /** The model digest, which changes when the tag is re-pulled: the capability cache is keyed by it. */
  digest?: string;
}

export interface StreamOptions {
  /** Overrides the provider's default text model. */
  model?: string;
  maxTokens: number;
  temperature: number;
  /** The context window to ask for. Set explicitly: a server's default may be far smaller, and a different value reloads the model. */
  contextSize?: number;
  signal?: AbortSignal;
  /**
   * How long to wait for the first ACTIVITY (thinking, a tool call or text) after the request is sent. A model that is already
   * resident answers quickly; one that has to load is prepared before the turn starts (see warmup.ts), not waited for here.
   */
  firstTokenTimeoutMs: number;
  /** How long to wait for the first VISIBLE text after the request is sent. Defaults to the first-activity allowance. */
  firstAnswerTimeoutMs?: number;
  /** The longest silence allowed between two events once activity has started. Defaults to the first-answer allowance. */
  idleTimeoutMs?: number;
  /** The most the whole request may take, across tool rounds (the service passes one absolute deadline). */
  totalTimeoutMs: number;
  /** Ask for a single JSON object (the Paper Tutor's structured solutions). Still validated by the caller: this only steers. */
  json?: boolean;
  /** Let a model that can reason ("think") do so before answering: slower, more careful. Off for chat, where the first word matters. */
  reasoning?: boolean;
  /** The exact thinking control to send: true/false or a level the model reports in `thinkingValues`. Overrides `reasoning`. */
  think?: boolean | string;
  /** How long the server keeps the model resident after the request. Omitted: the server's default (`OLLAMA_KEEP_ALIVE`). */
  keepAlive?: string;
  /** Native tool definitions. Empty or absent: no tools are offered. */
  tools?: readonly ToolDefinition[];
}

export interface StreamMetrics {
  /** Time the server spent loading the model, when it reports it. */
  loadMs: number | null;
  promptEvalMs: number | null;
  promptEvalCount: number | null;
  evalMs: number | null;
  evalCount: number | null;
  totalMs: number | null;
  /** Completion tokens per second over the evaluation window, when the server reports both. */
  tokensPerSecond: number | null;
}

export interface StreamStats {
  /** Milliseconds from sending the request to the first chunk of any kind (thinking, tool call or text). */
  firstTokenMs: number;
  /** Milliseconds from sending the request to the first visible text. Null/absent when no text was ever produced. */
  firstAnswerMs?: number | null;
  totalMs: number;
}

export type StreamChunk =
  | { type: "text"; text: string }
  /** The backend is working but has not said anything the student should read yet. */
  | { type: "activity"; kind: "thinking" | "tool_call" }
  | { type: "tool_call"; call: ProviderToolCall }
  | {
      type: "done";
      provider: string;
      model: string;
      usage: { promptTokens: number; completionTokens: number };
      stats: StreamStats;
      /** What the server reported about this request (`null` where the backend does not report it). */
      metrics?: StreamMetrics;
      /** True when the reply stopped because it reached the token limit, not because it was finished. */
      cutOff?: boolean;
    };

/** `empty`: the request finished without anything the student could read (a reasoning model that spent its allowance thinking, say). */
export type ProviderErrorCode = "unavailable" | "timeout" | "rate_limited" | "bad_request" | "aborted" | "protocol" | "empty";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly provider: string,
    readonly retryAfterMs?: number,
    /** A short machine word for the developer (`unauthorised`, `model_missing`, `http_500`, `reasoning_exhausted`): never a message body or a secret. */
    readonly detail?: string,
  ) {
    super(`${provider}: ${code}${detail ? ` (${detail})` : ""}`);
  }
}

export interface ProviderHealth {
  ok: boolean;
  /** A short machine word, never a secret or a message body: `ok`, `unreachable`, `model_missing`, `unauthorised`. */
  detail: string;
}

/** What a warm-up reports: whether the model is resident, and what it cost to make it so. */
export interface WarmResult {
  ok: boolean;
  /** Milliseconds the load took, when the server reported it. Null when it was already resident. */
  loadMs: number | null;
  /** `ok`, `already_resident`, `missing` or `unreachable` — never a message body. */
  detail: string;
}

export interface WarmableProvider {
  /** Makes the model resident with EXACTLY the options a turn uses (a different num_ctx forces a reload). Shared by callers. */
  warm(options: { model?: string; contextSize?: number; keepAlive?: string; signal?: AbortSignal }): Promise<WarmResult>;
  /** Whether the server reports the model in memory now (`/api/ps`). Never cached. */
  resident(model?: string): Promise<boolean>;
}

export const isWarmable = (provider: ChatProvider): provider is ChatProvider & WarmableProvider =>
  typeof (provider as Partial<WarmableProvider>).warm === "function" && typeof (provider as Partial<WarmableProvider>).resident === "function";

export interface ChatProvider {
  readonly id: string;
  capabilities(model?: string): Promise<ProviderCapabilities>;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
  /** Streams the answer. Throws ProviderError (before or during the stream). Never logs a message. */
  stream(messages: readonly ProviderMessage[], options: StreamOptions): AsyncGenerator<StreamChunk>;
}

/** The text of the request, for a model that can see only when images are attached. */
export const hasImages = (messages: readonly ProviderMessage[]): boolean => messages.some((m) => (m.images?.length ?? 0) > 0);
