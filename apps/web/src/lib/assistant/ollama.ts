import { ProviderError, hasImages, type ChatProvider, type ProviderCapabilities, type ProviderHealth, type ProviderMessage, type StreamChunk, type StreamOptions } from "./types";

/**
 * Ollama's native chat API (plan19 section 5.1): the development provider, run on the owner's own machine. NOT for
 * production (config.ts refuses it there): it is one GPU on a laptop.
 *
 * Each model's abilities are read from `/api/show` rather than assumed: a model that can "think" is told not to
 * (`think: false`) because the pause before the first token is the latency that matters; vision is on only for models that
 * report it. The context size is always sent, because the server's default is small. The request, the messages and the
 * answer are never logged, and the stream is NDJSON read line by line.
 */
export interface OllamaConfig {
  baseUrl: string;
  model: string;
  /** Used when a message carries images. Falls back to `model` if that one can see. */
  visionModel?: string;
  contextSize?: number;
  fetch?: typeof fetch;
}

interface ShowReply {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
}

export class OllamaProvider implements ChatProvider {
  readonly id = "ollama";
  private readonly doFetch: typeof fetch;
  private readonly shown = new Map<string, Promise<ShowReply | null>>();

  constructor(private readonly config: OllamaConfig) {
    this.doFetch = config.fetch ?? fetch;
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private show(model: string): Promise<ShowReply | null> {
    let known = this.shown.get(model);
    if (!known) {
      known = (async () => {
        try {
          const response = await this.doFetch(this.url("/api/show"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(10_000) });
          return response.ok ? ((await response.json()) as ShowReply) : null;
        } catch {
          return null;
        }
      })();
      this.shown.set(model, known);
    }
    return known;
  }

  private modelFor(messages: readonly ProviderMessage[], override?: string): string {
    if (override) return override;
    return hasImages(messages) ? (this.config.visionModel ?? this.config.model) : this.config.model;
  }

  async capabilities(model: string = this.config.model): Promise<ProviderCapabilities> {
    const info = await this.show(model);
    const caps = info?.capabilities ?? [];
    const contextKey = Object.keys(info?.model_info ?? {}).find((k) => k.endsWith(".context_length"));
    const context = contextKey ? Number(info!.model_info![contextKey]) : 0;
    return { vision: caps.includes("vision"), jsonMode: true, toolUse: caps.includes("tools"), maxContext: Number.isFinite(context) ? context : 0 };
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const response = await this.doFetch(this.url("/api/tags"), { signal: signal ?? AbortSignal.timeout(5_000) });
      if (!response.ok) return { ok: false, detail: "unreachable" };
      const body = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
      const names = new Set((body.models ?? []).flatMap((m) => [m.name, m.model]).filter(Boolean));
      const wanted = [this.config.model, this.config.visionModel].filter((m): m is string => Boolean(m));
      return wanted.every((m) => names.has(m) || names.has(`${m}:latest`)) ? { ok: true, detail: "ok" } : { ok: false, detail: "model_missing" };
    } catch {
      return { ok: false, detail: "unreachable" };
    }
  }

  async *stream(messages: readonly ProviderMessage[], options: StreamOptions): AsyncGenerator<StreamChunk> {
    const model = this.modelFor(messages, options.model);
    if (hasImages(messages) && !(await this.capabilities(model)).vision) throw new ProviderError("bad_request", this.id);
    const thinking = (await this.show(model))?.capabilities?.includes("thinking") ?? false;

    const started = Date.now();
    const controller = new AbortController();
    const caller = options.signal;
    const onCaller = () => controller.abort("caller");
    if (caller?.aborted) throw new ProviderError("aborted", this.id);
    caller?.addEventListener("abort", onCaller, { once: true });
    let timedOut: "first" | "total" | null = null;
    const first = setTimeout(() => ((timedOut = "first"), controller.abort("timeout")), options.firstTokenTimeoutMs);
    const total = setTimeout(() => ((timedOut = "total"), controller.abort("timeout")), options.totalTimeoutMs);

    let response: Response;
    try {
      response = await this.doFetch(this.url("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          stream: true,
          ...(thinking ? { think: false } : {}),
          messages: messages.map((m) => ({ role: m.role, content: m.content, ...(m.images?.length ? { images: m.images } : {}) })),
          options: { num_ctx: options.contextSize ?? this.config.contextSize ?? 4096, num_predict: options.maxTokens, temperature: options.temperature },
        }),
      });
    } catch {
      clearTimeout(first);
      clearTimeout(total);
      caller?.removeEventListener("abort", onCaller);
      throw new ProviderError(timedOut ? "timeout" : caller?.aborted ? "aborted" : "unavailable", this.id);
    }

    try {
      if (!response.ok || !response.body) {
        throw new ProviderError(response.status === 400 ? "bad_request" : response.status === 429 ? "rate_limited" : "unavailable", this.id);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let firstTokenMs: number | null = null;
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
          if (!line) continue;
          let part: { message?: { content?: string }; done?: boolean; error?: string; prompt_eval_count?: number; eval_count?: number };
          try {
            part = JSON.parse(line);
          } catch {
            throw new ProviderError("protocol", this.id);
          }
          if (part.error) throw new ProviderError("unavailable", this.id);
          const text = part.message?.content ?? "";
          if (text) {
            if (firstTokenMs === null) {
              firstTokenMs = Date.now() - started;
              clearTimeout(first);
            }
            yield { type: "text", text };
          }
          if (part.done) {
            yield {
              type: "done",
              provider: this.id,
              model,
              usage: { promptTokens: part.prompt_eval_count ?? 0, completionTokens: part.eval_count ?? 0 },
              stats: { firstTokenMs: firstTokenMs ?? Date.now() - started, totalMs: Date.now() - started },
            };
            return;
          }
        }
      }
      throw new ProviderError("protocol", this.id);
    } finally {
      clearTimeout(first);
      clearTimeout(total);
      caller?.removeEventListener("abort", onCaller);
      controller.abort("done");
    }
  }
}
