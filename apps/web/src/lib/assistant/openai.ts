import { ProviderError, hasImages, type ChatProvider, type ProviderCapabilities, type ProviderHealth, type ProviderMessage, type StreamChunk, type StreamOptions } from "./types";

/**
 * An OpenAI-compatible chat endpoint (plan19 section 5.1): the shape NVIDIA's hosted catalogue (`nim`, DEVELOPMENT ONLY, synthetic
 * prompts only) and most hosted providers speak. The same class is the production slot (`custom`) once a provider has been chosen
 * under section 6 (a data processing agreement, no training on inputs, a suitable processing location): config.ts refuses `nim` in
 * production and refuses `custom` without `ASSISTANT_PRODUCTION_APPROVED`.
 *
 * A 429 is retried with backoff (the server's Retry-After if it sends one, else a doubling wait with jitter), up to `maxRetries`
 * times and only BEFORE any token has been sent: once text is flowing a failure is a failure. The key is in a request header only;
 * nothing the person typed or the model said is ever logged.
 */
export interface OpenAiCompatibleConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel?: string;
  /** Capabilities are not discoverable over this API, so they are declared. */
  vision?: boolean;
  maxContext?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Where waits happen, so a test need not really wait. */
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
}

const MAX_WAIT_MS = 8_000;

export class OpenAiCompatibleProvider implements ChatProvider {
  readonly id: string;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: OpenAiCompatibleConfig) {
    this.id = config.id;
    this.doFetch = config.fetch ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return { vision: Boolean(this.config.vision || this.config.visionModel), jsonMode: true, toolUse: true, maxContext: this.config.maxContext ?? 0 };
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const response = await this.doFetch(this.url("/models"), { headers: { Authorization: `Bearer ${this.config.apiKey}` }, signal: signal ?? AbortSignal.timeout(8_000) });
      if (response.status === 401 || response.status === 403) return { ok: false, detail: "unauthorised" };
      return response.ok ? { ok: true, detail: "ok" } : { ok: false, detail: "unreachable" };
    } catch {
      return { ok: false, detail: "unreachable" };
    }
  }

  private wireMessages(messages: readonly ProviderMessage[]) {
    return messages.map((m) =>
      m.images?.length
        ? { role: m.role, content: [{ type: "text", text: m.content }, ...m.images.map((b64) => ({ type: "image_url", image_url: { url: `data:${b64.startsWith("/9j/") ? "image/jpeg" : "image/png"};base64,${b64}` } }))] }
        : { role: m.role, content: m.content },
    );
  }

  async *stream(messages: readonly ProviderMessage[], options: StreamOptions): AsyncGenerator<StreamChunk> {
    const model = options.model ?? (hasImages(messages) ? (this.config.visionModel ?? this.config.model) : this.config.model);
    const started = Date.now();
    const caller = options.signal;
    if (caller?.aborted) throw new ProviderError("aborted", this.id);
    const maxRetries = this.config.maxRetries ?? 2;

    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const onCaller = () => controller.abort("caller");
      caller?.addEventListener("abort", onCaller, { once: true });
      let timedOut = false;
      const first = setTimeout(() => ((timedOut = true), controller.abort("timeout")), options.firstTokenTimeoutMs);
      const total = setTimeout(() => ((timedOut = true), controller.abort("timeout")), options.totalTimeoutMs);
      const cleanup = () => {
        clearTimeout(first);
        clearTimeout(total);
        caller?.removeEventListener("abort", onCaller);
      };
      try {
        let response: Response;
        try {
          response = await this.doFetch(this.url("/chat/completions"), {
            method: "POST",
            headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" },
            signal: controller.signal,
            body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, max_tokens: options.maxTokens, temperature: options.temperature, messages: this.wireMessages(messages) }),
          });
        } catch {
          throw new ProviderError(timedOut ? "timeout" : caller?.aborted ? "aborted" : "unavailable", this.id);
        }
        if (response.status === 429 || response.status === 503) {
          const header = Number(response.headers.get("retry-after"));
          const wait = Math.min(Number.isFinite(header) && header > 0 ? header * 1000 : 500 * 2 ** attempt + (this.config.jitter?.() ?? Math.random() * 250), MAX_WAIT_MS);
          if (attempt < maxRetries && !caller?.aborted) {
            cleanup();
            await this.sleep(wait);
            continue;
          }
          throw new ProviderError(response.status === 429 ? "rate_limited" : "unavailable", this.id, wait);
        }
        if (response.status === 400 || response.status === 413 || response.status === 422) throw new ProviderError("bad_request", this.id);
        if (response.status === 401 || response.status === 403 || !response.ok || !response.body) throw new ProviderError("unavailable", this.id);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let firstTokenMs: number | null = null;
        let usage = { promptTokens: 0, completionTokens: 0 };
        for (;;) {
          let read: ReadableStreamReadResult<Uint8Array>;
          try {
            read = await reader.read();
          } catch {
            throw new ProviderError(timedOut ? "timeout" : caller?.aborted ? "aborted" : "unavailable", this.id);
          }
          if (read.done) break;
          buffer += decoder.decode(read.value, { stream: true });
          for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
            const line = buffer.slice(0, at).trim();
            buffer = buffer.slice(at + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") {
              yield { type: "done", provider: this.id, model, usage, stats: { firstTokenMs: firstTokenMs ?? Date.now() - started, totalMs: Date.now() - started } };
              return;
            }
            let part: { choices?: Array<{ delta?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
            try {
              part = JSON.parse(data);
            } catch {
              throw new ProviderError("protocol", this.id);
            }
            if (part.usage) usage = { promptTokens: part.usage.prompt_tokens ?? 0, completionTokens: part.usage.completion_tokens ?? 0 };
            const text = part.choices?.[0]?.delta?.content ?? "";
            if (text) {
              if (firstTokenMs === null) {
                firstTokenMs = Date.now() - started;
                clearTimeout(first);
              }
              yield { type: "text", text };
            }
          }
        }
        // The stream ended without [DONE]: treat what arrived as complete, but say so with a zero usage.
        if (firstTokenMs === null) throw new ProviderError("protocol", this.id);
        yield { type: "done", provider: this.id, model, usage, stats: { firstTokenMs, totalMs: Date.now() - started } };
        return;
      } finally {
        cleanup();
        controller.abort("done");
      }
    }
  }
}

export const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
