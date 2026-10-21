/**
 * The assistant's provider boundary (plan19 section 5.1). Everything above it (the chat service, the routes, the benchmark)
 * talks to `ChatProvider`, never to a concrete model server, so Ollama on a developer's machine, NVIDIA's hosted catalogue
 * (development only) and a production provider chosen later are interchangeable.
 */
export type ProviderRole = "system" | "user" | "assistant";

export interface ProviderMessage {
  role: ProviderRole;
  content: string;
  /** Base64 image data without a `data:` prefix. Only for models that can see. */
  images?: string[];
}

export interface ProviderCapabilities {
  vision: boolean;
  jsonMode: boolean;
  toolUse: boolean;
  /** The largest context window the model accepts, in tokens (0 when unknown). */
  maxContext: number;
}

export interface StreamOptions {
  /** Overrides the provider's default text model. */
  model?: string;
  maxTokens: number;
  temperature: number;
  /** The context window to ask for. Set explicitly: a server's default may be far smaller. */
  contextSize?: number;
  signal?: AbortSignal;
  /** How long to wait for the first token before giving up (a model that is loading can be slow). */
  firstTokenTimeoutMs: number;
  /** The most the whole answer may take. */
  totalTimeoutMs: number;
  /** Ask for a single JSON object (the Paper Tutor's structured solutions). Still validated by the caller: this only steers. */
  json?: boolean;
  /** Let a model that can reason ("think") do so before answering: slower, more careful. Off for chat, where the first word matters. */
  reasoning?: boolean;
}

export interface StreamStats {
  /** Milliseconds from sending the request to the first token. */
  firstTokenMs: number;
  totalMs: number;
}

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "done"; provider: string; model: string; usage: { promptTokens: number; completionTokens: number }; stats: StreamStats };

export type ProviderErrorCode = "unavailable" | "timeout" | "rate_limited" | "bad_request" | "aborted" | "protocol";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly provider: string,
    readonly retryAfterMs?: number,
  ) {
    super(`${provider}: ${code}`);
  }
}

export interface ProviderHealth {
  ok: boolean;
  /** A short machine word, never a secret or a message body: `ok`, `unreachable`, `model_missing`, `unauthorised`. */
  detail: string;
}

export interface ChatProvider {
  readonly id: string;
  capabilities(model?: string): Promise<ProviderCapabilities>;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
  /** Streams the answer. Throws ProviderError (before or during the stream). Never logs a message. */
  stream(messages: readonly ProviderMessage[], options: StreamOptions): AsyncGenerator<StreamChunk>;
}

/** The text of the request, for a model that can see only when images are attached. */
export const hasImages = (messages: readonly ProviderMessage[]): boolean => messages.some((m) => (m.images?.length ?? 0) > 0);
