import {
  ProviderError,
  hasImages,
  type ChatProvider,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderMessage,
  type ProviderToolCall,
  type StreamChunk,
  type StreamMetrics,
  type StreamOptions,
  type WarmResult,
  type WarmableProvider,
} from "./types";

/**
 * Ollama's native chat API (plan19 section 5.1): the development provider, run on the owner's own machine. NOT for
 * production (config.ts refuses it there): it is one GPU on a laptop.
 *
 * What the brief asked of this adapter, and where it lives here:
 *   - `keep_alive` is always sent, so a warm model stays resident between questions (section 6);
 *   - `num_ctx` is always the app's context, and the warm-up sends the same value: a different value reloads the model;
 *   - `message.thinking` and `message.tool_calls` are reported as activity and tool calls, separately from text, so a hidden
 *     pause is never counted as the student's answer (sections 7 and 8);
 *   - the server's own `*_duration` fields (nanoseconds) are converted to milliseconds and reported, not dropped;
 *   - capabilities are cached per endpoint, model and digest, and a FAILED lookup is retried after a short interval instead
 *     of becoming a permanent "no vision" (the old bug);
 *   - `warm`/`resident` let the service prepare the model before a turn starts, evidenced by `/api/ps`.
 *
 * The request, the messages and the answer are never logged, and the stream is NDJSON read line by line.
 */
export interface OllamaConfig {
  baseUrl: string;
  model: string;
  /** Used when a message carries images. Falls back to `model` if that one can see. */
  visionModel?: string;
  contextSize?: number;
  /** How long the server keeps a model resident. Default: the server's own setting. */
  keepAlive?: string;
  fetch?: typeof fetch;
}

interface ShowReply {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
  details?: { digest?: string; quantization_level?: string; format?: string };
  /** Newer servers: `{ values: [false] | [true] | ["low","high"], default: ... }`. */
  thinking?: { values?: Array<boolean | string>; default?: boolean | string };
}

/** A successful capability lookup is cached for five minutes; a failed one for ten seconds, then tried again. */
const CAPS_OK_MS = 5 * 60_000;
const CAPS_FAIL_MS = 10_000;
const TAGS_MS = 30_000;

export class OllamaProvider implements ChatProvider, WarmableProvider {
  readonly id = "ollama";
  private readonly doFetch: typeof fetch;
  private readonly shown = new Map<string, { at: number; promise?: Promise<ShowReply | null>; reply?: ShowReply | null }>();
  private readonly digests = new Map<string, { at: number; value: Promise<string | null> }>();

  constructor(private readonly config: OllamaConfig) {
    this.doFetch = config.fetch ?? fetch;
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private show(model: string): Promise<ShowReply | null> {
    const key = `${this.config.baseUrl.replace(/\/+$/, "")}|${model}`;
    const cached = this.shown.get(key);
    if (cached) {
      // A resolved lookup lives for its interval; an in-flight one is shared, so a burst of turns makes one request.
      if (cached.reply !== undefined) {
        if (Date.now() - cached.at < (cached.reply ? CAPS_OK_MS : CAPS_FAIL_MS)) return Promise.resolve(cached.reply);
      } else if (cached.promise) return cached.promise;
    }
    const entry: { at: number; promise?: Promise<ShowReply | null>; reply?: ShowReply | null } = { at: Date.now() };
    const fresh = (async () => {
      try {
        const response = await this.doFetch(this.url("/api/show"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(10_000) });
        return response.ok ? ((await response.json()) as ShowReply) : null;
      } catch {
        return null;
      }
    })();
    entry.promise = fresh;
    this.shown.set(key, entry);
    void fresh.then((reply) => {
      entry.at = Date.now();
      entry.reply = reply;
      entry.promise = undefined;
    });
    return fresh;
  }

  /** The model's digest, from `/api/tags` (cached briefly): part of the capability-cache key. */
  private digest(model: string): Promise<string | null> {
    const cached = this.digests.get(model);
    if (cached && Date.now() - cached.at < TAGS_MS) return cached.value;
    const fresh = (async () => {
      try {
        const response = await this.doFetch(this.url("/api/tags"), { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) return null;
        const body = (await response.json()) as { models?: Array<{ name?: string; model?: string; digest?: string }> };
        const hit = (body.models ?? []).find((m) => m.name === model || m.model === model || m.name === `${model}:latest` || m.model === `${model}:latest`);
        return hit?.digest ?? null;
      } catch {
        return null;
      }
    })();
    this.digests.set(model, { at: Date.now(), value: fresh });
    return fresh;
  }

  private modelFor(messages: readonly ProviderMessage[], override?: string): string {
    if (override) return override;
    return hasImages(messages) ? (this.config.visionModel ?? this.config.model) : this.config.model;
  }

  async capabilities(model: string = this.config.model): Promise<ProviderCapabilities> {
    const [info, digest] = await Promise.all([this.show(model), this.digest(model)]);
    const caps = info?.capabilities ?? [];
    const contextKey = Object.keys(info?.model_info ?? {}).find((k) => k.endsWith(".context_length"));
    const context = contextKey ? Number(info!.model_info![contextKey]) : 0;
    const values = (info?.thinking?.values ?? []).filter((v): v is boolean | string => typeof v === "boolean" || typeof v === "string");
    const thinking = values.length ? values.some((v) => v !== false) : caps.includes("thinking") ? true : null;
    return {
      vision: caps.includes("vision"),
      jsonMode: true,
      toolUse: caps.includes("tools"),
      maxContext: Number.isFinite(context) ? context : 0,
      thinking,
      thinkingValues: values,
      ...(digest ? { digest } : {}),
    };
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

  async resident(model: string = this.config.model): Promise<boolean> {
    try {
      const response = await this.doFetch(this.url("/api/ps"), { signal: AbortSignal.timeout(3_000) });
      if (!response.ok) return false;
      const body = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
      return (body.models ?? []).some((m) => [m.name, m.model, `${model}:latest`].includes(model) || m.name === model || m.model === model);
    } catch {
      return false;
    }
  }

  /**
   * Loads the model with the exact options a turn uses. `/api/generate` with an empty prompt is a load; one token proves the
   * API answers. The server reports `load_duration` only when it actually loaded, which is the honest number to record.
   */
  async warm(options: { model?: string; contextSize?: number; keepAlive?: string; signal?: AbortSignal } = {}): Promise<WarmResult> {
    const model = options.model ?? this.config.model;
    if (await this.resident(model)) return { ok: true, loadMs: null, detail: "already_resident" };
    try {
      const response = await this.doFetch(this.url("/api/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options.signal ?? AbortSignal.timeout(300_000),
        body: JSON.stringify({
          model,
          prompt: "ready",
          stream: false,
          ...(options.keepAlive ?? this.config.keepAlive ? { keep_alive: options.keepAlive ?? this.config.keepAlive } : {}),
          options: { num_ctx: options.contextSize ?? this.config.contextSize ?? 4096, num_predict: 1, temperature: 0 },
        }),
      });
      if (response.status === 404) return { ok: false, loadMs: null, detail: "missing" };
      if (!response.ok) return { ok: false, loadMs: null, detail: "unreachable" };
      const body = (await response.json()) as { load_duration?: number };
      const loadMs = typeof body.load_duration === "number" && body.load_duration > 0 ? Math.round(body.load_duration / 1e6) : null;
      return { ok: true, loadMs, detail: loadMs === null ? "already_resident" : "ok" };
    } catch {
      return { ok: false, loadMs: null, detail: "unreachable" };
    }
  }

  /** The `think` value to send: the caller's explicit control, else the boolean policy, else nothing for a model that cannot. */
  private thinkValue(options: StreamOptions, supported: boolean | null, values: readonly (boolean | string)[]): boolean | string | undefined {
    if (options.think !== undefined) return options.think;
    if (!supported) return undefined;
    // Default: do not think. A caller that wants it says so (the service's thinking policy does).
    if (options.reasoning !== true) return false;
    if (values.length && !values.includes(true)) {
      // A model that offers levels but not `true` gets one of its own levels.
      const level = values.find((v) => v === "medium") ?? values.find((v) => v === "high") ?? values.find((v) => typeof v === "string");
      return level;
    }
    return options.reasoning;
  }

  async *stream(messages: readonly ProviderMessage[], options: StreamOptions): AsyncGenerator<StreamChunk> {
    const model = this.modelFor(messages, options.model);
    const caps = await this.capabilities(model);
    if (hasImages(messages) && !caps.vision) throw new ProviderError("bad_request", this.id);
    const think = this.thinkValue(options, caps.thinking ?? null, caps.thinkingValues ?? []);

    const started = Date.now();
    const controller = new AbortController();
    const caller = options.signal;
    const onCaller = () => controller.abort("caller");
    if (caller?.aborted) throw new ProviderError("aborted", this.id);
    caller?.addEventListener("abort", onCaller, { once: true });
    let timedOut: "first" | "answer" | "idle" | "total" | null = null;
    const firstAnswerMs = options.firstAnswerTimeoutMs ?? options.firstTokenTimeoutMs;
    const idleMs = options.idleTimeoutMs ?? firstAnswerMs;
    let first: ReturnType<typeof setTimeout> | null = setTimeout(() => ((timedOut = "first"), controller.abort("timeout")), options.firstTokenTimeoutMs);
    let answer: ReturnType<typeof setTimeout> | null = setTimeout(() => ((timedOut = "answer"), controller.abort("timeout")), firstAnswerMs);
    let idle: ReturnType<typeof setTimeout> | null = null;
    const total = setTimeout(() => ((timedOut = "total"), controller.abort("timeout")), options.totalTimeoutMs);
    const armIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => ((timedOut = "idle"), controller.abort("timeout")), idleMs);
    };
    const activity = () => {
      if (first) clearTimeout(first);
      first = null;
      if (idle) clearTimeout(idle);
      idle = null;
      armIdle();
    };
    const answered = () => {
      if (answer) clearTimeout(answer);
      answer = null;
    };

    let response: Response;
    try {
      response = await this.doFetch(this.url("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          stream: true,
          ...(think !== undefined ? { think } : {}),
          ...(options.json ? { format: "json" } : {}),
          ...(options.keepAlive ?? this.config.keepAlive ? { keep_alive: options.keepAlive ?? this.config.keepAlive } : {}),
          ...(options.tools?.length ? { tools: options.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
            ...(m.images?.length ? { images: m.images } : {}),
            ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })) } : {}),
            ...(m.role === "tool" && m.toolName ? { tool_name: m.toolName } : {}),
          })),
          // Exactly these options on every request and on the warm-up: changing one reloads the model.
          options: { num_ctx: options.contextSize ?? this.config.contextSize ?? 4096, num_predict: options.maxTokens, temperature: options.temperature },
        }),
      });
    } catch {
      if (first) clearTimeout(first);
      if (answer) clearTimeout(answer);
      if (idle) clearTimeout(idle);
      clearTimeout(total);
      caller?.removeEventListener("abort", onCaller);
      throw new ProviderError(timedOut ? "timeout" : caller?.aborted ? "aborted" : "unavailable", this.id);
    }

    try {
      if (!response.ok || !response.body) {
        throw new ProviderError(response.status === 400 || response.status === 404 ? "bad_request" : response.status === 429 ? "rate_limited" : "unavailable", this.id);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let firstActivityMs: number | null = null;
      let firstAnswerAt: number | null = null;
      const calls: ProviderToolCall[] = [];
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
          let part: {
            message?: {
              content?: string;
              thinking?: string;
              tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }>;
            };
            done?: boolean;
            done_reason?: string;
            error?: string;
            prompt_eval_count?: number;
            eval_count?: number;
            load_duration?: number;
            prompt_eval_duration?: number;
            eval_duration?: number;
            total_duration?: number;
          };
          try {
            part = JSON.parse(line);
          } catch {
            throw new ProviderError("protocol", this.id);
          }
          if (part.error) throw new ProviderError("unavailable", this.id);

          // Hidden reasoning: activity, never the student's answer.
          if (part.message?.thinking) {
            if (firstActivityMs === null) firstActivityMs = Date.now() - started;
            activity();
            yield { type: "activity", kind: "thinking" };
          }
          // Tool calls: also activity. The service validates and runs them; this adapter never executes anything.
          for (const raw of part.message?.tool_calls ?? []) {
            const name = raw.function?.name;
            if (!name) continue;
            const args = typeof raw.function?.arguments === "string" ? safeJson(raw.function.arguments) : (raw.function?.arguments as Record<string, unknown> | undefined);
            const call: ProviderToolCall = { id: raw.id ?? `call-${calls.length + 1}`, name, arguments: args && typeof args === "object" && !Array.isArray(args) ? args : {} };
            calls.push(call);
            if (firstActivityMs === null) firstActivityMs = Date.now() - started;
            activity();
            yield { type: "activity", kind: "tool_call" };
            yield { type: "tool_call", call };
          }
          const text = part.message?.content ?? "";
          if (text) {
            if (firstActivityMs === null) firstActivityMs = Date.now() - started;
            if (firstAnswerAt === null) {
              firstAnswerAt = Date.now() - started;
              answered();
            }
            activity();
            yield { type: "text", text };
          }
          if (part.done) {
            const metrics: StreamMetrics = {
              loadMs: ms(part.load_duration),
              promptEvalMs: ms(part.prompt_eval_duration),
              promptEvalCount: Number.isFinite(part.prompt_eval_count) ? Number(part.prompt_eval_count) : null,
              evalMs: ms(part.eval_duration),
              evalCount: Number.isFinite(part.eval_count) ? Number(part.eval_count) : null,
              totalMs: ms(part.total_duration),
              tokensPerSecond: null,
            };
            const evalMs = ms(part.eval_duration);
            metrics.tokensPerSecond = evalMs && evalMs > 0 && Number.isFinite(part.eval_count) ? Math.round(((part.eval_count ?? 0) / evalMs) * 1000 * 10) / 10 : null;
            yield {
              type: "done",
              provider: this.id,
              model,
              usage: { promptTokens: part.prompt_eval_count ?? 0, completionTokens: part.eval_count ?? 0 },
              stats: { firstTokenMs: firstActivityMs ?? Date.now() - started, firstAnswerMs: firstAnswerAt, totalMs: Date.now() - started },
              metrics,
              cutOff: part.done_reason === "length",
            };
            return;
          }
        }
      }
      throw new ProviderError("protocol", this.id);
    } finally {
      if (first) clearTimeout(first);
      if (answer) clearTimeout(answer);
      if (idle) clearTimeout(idle);
      clearTimeout(total);
      caller?.removeEventListener("abort", onCaller);
      controller.abort("done");
    }
  }
}

const ms = (ns: number | undefined): number | null => (typeof ns === "number" && Number.isFinite(ns) && ns >= 0 ? Math.round(ns / 1e6) : null);

function safeJson(text: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
