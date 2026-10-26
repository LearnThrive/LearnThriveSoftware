import { EFFORT_LEVELS, type EffortLevel, type HostedModelProfile, type ReasoningEffort } from "./models";
import { ProviderError, hasImages, type ChatProvider, type ProviderCapabilities, type ProviderHealth, type ProviderMessage, type ProviderToolCall, type StreamChunk, type StreamOptions } from "./types";

/**
 * An OpenAI-compatible chat endpoint (plan19 section 5.1): the shape NVIDIA's hosted catalogue (`nim`, DEVELOPMENT ONLY, synthetic
 * prompts only) and most hosted providers speak. The same class is the production slot (`custom`) once a provider has been chosen
 * under section 6 (a data processing agreement, no training on inputs, a suitable processing location): config.ts refuses `nim` in
 * production and refuses `custom` without `ASSISTANT_PRODUCTION_APPROVED`.
 *
 * The provider owns its model names. A caller may ask for one of THIS provider's models (its text or vision model); any other name
 * (an Ollama tag handed down a fallback chain, say) is ignored and the provider's own model is used, so a request can never reach an
 * endpoint with another provider's model identifier. The `done` chunk reports the model that was actually sent.
 *
 * A reasoning model's hidden reasoning (`reasoning_content` or `reasoning` on a delta) is ACTIVITY, never answer text: it is not
 * yielded, stored or shown. A stream that ends with reasoning and no answer (the allowance ran out while it was still thinking) is an
 * error (`empty`), never a success with nothing in it. Tool calls arrive in fragments and are assembled, then handed over whole.
 *
 * A 429 or 503 is retried with backoff (the server's Retry-After if it sends one, else a doubling wait with jitter), up to `maxRetries`
 * times and only BEFORE any token has been sent: once text is flowing a failure is a failure. A model profile may offer optional request
 * fields (reasoning controls); one the endpoint refuses with a 400 is dropped for the next set, and the set that worked is remembered.
 * The key is in a request header only; nothing the person typed or the model said is ever logged.
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
  /** A hosted model's own settings (models.ts): recommended sampling, reasoning controls, its reasoning allowance. */
  profile?: HostedModelProfile;
  /** Overrides the profile's reasoning allowance (ASSISTANT_NIM_REASONING_TOKENS). */
  reasoningTokens?: number;
  fetch?: typeof fetch;
  /** Where waits happen, so a test need not really wait. */
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
}

const MAX_WAIT_MS = 8_000;
/** Reasoning is reported as activity at most this often: it keeps the timers honest without flooding the page with status events. */
const ACTIVITY_EVERY_MS = 1_500;

/** Which of a profile's optional field sets each endpoint and model accepted, so a refusal is paid once per process, not once per turn. */
const accepted = new Map<string, number>();

/** For tests. */
export function resetAcceptedFields(): void {
  accepted.clear();
}

interface PartialCall {
  id: string;
  name: string;
  args: string;
}

type Delta = {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
};

type Part = {
  choices?: Array<{ delta?: Delta; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: unknown;
};

export class OpenAiCompatibleProvider implements ChatProvider {
  readonly id: string;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly config: OpenAiCompatibleConfig) {
    this.id = config.id;
    this.doFetch = config.fetch ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** The text model this provider sends (its own, never a caller's). */
  get model(): string {
    return this.config.model;
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  /** The model for a request: the caller's choice only if it is one of this provider's own, else the provider's text or vision model. */
  private modelFor(messages: readonly ProviderMessage[], asked: string | undefined): string {
    const own = this.config.visionModel && hasImages(messages) ? this.config.visionModel : this.config.model;
    if (asked && (asked === this.config.model || asked === this.config.visionModel)) return asked;
    return own;
  }

  async capabilities(): Promise<ProviderCapabilities> {
    return { vision: Boolean(this.config.vision || this.config.visionModel), jsonMode: true, toolUse: true, maxContext: this.config.maxContext ?? 0, thinking: this.config.profile ? true : null };
  }

  /** Reachable, the key accepted, and (when the server lists its models) this provider's model among them. Costs no generation. */
  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    try {
      const response = await this.doFetch(this.url("/models"), { headers: { Authorization: `Bearer ${this.config.apiKey}` }, signal: signal ?? AbortSignal.timeout(8_000) });
      if (response.status === 401 || response.status === 403) return { ok: false, detail: "unauthorised" };
      if (!response.ok) return { ok: false, detail: "unreachable" };
      const listed = await response
        .json()
        .then((body: { data?: Array<{ id?: unknown }> }) => (Array.isArray(body?.data) ? body.data.map((m) => m?.id).filter((id): id is string => typeof id === "string") : null))
        .catch(() => null);
      if (listed && listed.length > 0 && !listed.includes(this.config.model)) return { ok: false, detail: "model_missing" };
      return { ok: true, detail: "ok" };
    } catch {
      return { ok: false, detail: "unreachable" };
    }
  }

  private wireMessages(messages: readonly ProviderMessage[]) {
    return messages.map((m, at) => {
      if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId ?? `call_${at}`, content: m.content };
      if (m.role === "assistant" && m.toolCalls?.length)
        return { role: "assistant", content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } })) };
      return m.images?.length
        ? { role: m.role, content: [{ type: "text", text: m.content }, ...m.images.map((b64) => ({ type: "image_url", image_url: { url: `data:${b64.startsWith("/9j/") ? "image/jpeg" : "image/png"};base64,${b64}` } }))] }
        : { role: m.role, content: m.content };
    });
  }

  /** The effort the caller asked for, in the profile's terms: no reasoning, one of the levels the endpoints name, or the caller's boolean. */
  private effort(options: StreamOptions): ReasoningEffort {
    if (options.think === false) return "off";
    if (options.think === true) return "high";
    if (typeof options.think === "string" && EFFORT_LEVELS.includes(options.think as EffortLevel)) return options.think as EffortLevel;
    return options.reasoning ? "medium" : "off";
  }

  async *stream(messages: readonly ProviderMessage[], options: StreamOptions): AsyncGenerator<StreamChunk> {
    const model = this.modelFor(messages, options.model);
    const profile = this.config.profile && this.config.profile.model === model ? this.config.profile : undefined;
    const started = Date.now();
    const caller = options.signal;
    if (caller?.aborted) throw new ProviderError("aborted", this.id);
    const maxRetries = this.config.maxRetries ?? 2;

    // Reasoning controls, best first, starting from the set this endpoint already accepted.
    const effort = this.effort(options);
    const variants = profile ? profile.reasoningFields(effort) : [{}];
    const memo = `${this.config.baseUrl}|${model}|${effort}`;
    let variant = Math.min(accepted.get(memo) ?? 0, variants.length - 1);
    // A model that always reasons spends part of every request thinking: give it its allowance even when the caller did not ask it to think.
    const reasoningAllowance = this.config.reasoningTokens ?? profile?.reasoningTokens ?? 0;
    const maxTokens = options.maxTokens + (profile?.alwaysReasons && effort === "off" ? reasoningAllowance : 0);
    const firstAnswerMs = options.firstAnswerTimeoutMs ?? options.firstTokenTimeoutMs;
    const idleMs = options.idleTimeoutMs ?? firstAnswerMs;
    const tools = options.tools?.length ? options.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) : undefined;

    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const onCaller = () => controller.abort("caller");
      caller?.addEventListener("abort", onCaller, { once: true });
      let timedOut = false;
      const stop = () => ((timedOut = true), controller.abort("timeout"));
      let first: ReturnType<typeof setTimeout> | null = setTimeout(stop, options.firstTokenTimeoutMs);
      let answer: ReturnType<typeof setTimeout> | null = setTimeout(stop, firstAnswerMs);
      let idle: ReturnType<typeof setTimeout> | null = null;
      const total = setTimeout(stop, options.totalTimeoutMs);
      const activity = () => {
        if (first) clearTimeout(first);
        first = null;
        if (idle) clearTimeout(idle);
        idle = setTimeout(stop, idleMs);
      };
      const answered = () => {
        if (answer) clearTimeout(answer);
        answer = null;
      };
      const cleanup = () => {
        for (const t of [first, answer, idle, total]) if (t) clearTimeout(t);
        caller?.removeEventListener("abort", onCaller);
      };
      try {
        let response: Response;
        try {
          response = await this.doFetch(this.url("/chat/completions"), {
            method: "POST",
            headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" },
            signal: controller.signal,
            body: JSON.stringify({
              model,
              stream: true,
              stream_options: { include_usage: true },
              max_tokens: maxTokens,
              // A hosted model's own recommended sampling (its model card); otherwise what the caller asked for.
              temperature: profile ? profile.temperature : options.temperature,
              ...(profile ? { top_p: profile.topP } : {}),
              ...(options.json ? { response_format: { type: "json_object" } } : {}),
              ...(tools ? { tools, tool_choice: "auto" } : {}),
              ...variants[variant],
              messages: this.wireMessages(messages),
            }),
          });
        } catch {
          throw new ProviderError(timedOut ? "timeout" : caller?.aborted ? "aborted" : "unavailable", this.id, undefined, timedOut ? "timeout" : "unreachable");
        }
        if (response.status === 429 || response.status === 503) {
          const header = Number(response.headers.get("retry-after"));
          const wait = Math.min(Number.isFinite(header) && header > 0 ? header * 1000 : 500 * 2 ** attempt + (this.config.jitter?.() ?? Math.random() * 250), MAX_WAIT_MS);
          if (attempt < maxRetries && !caller?.aborted) {
            cleanup();
            await this.sleep(wait);
            continue;
          }
          throw new ProviderError(response.status === 429 ? "rate_limited" : "unavailable", this.id, wait, response.status === 429 ? "rate_limited" : "http_503");
        }
        if (response.status === 400 || response.status === 422) {
          // An optional field this endpoint does not take: ask again without it (nothing has been shown yet), and remember.
          if (variant + 1 < variants.length && !caller?.aborted) {
            variant += 1;
            accepted.set(memo, variant);
            cleanup();
            continue;
          }
          throw new ProviderError("bad_request", this.id, undefined, `http_${response.status}`);
        }
        if (response.status === 413) throw new ProviderError("bad_request", this.id, undefined, "too_large");
        if (response.status === 401 || response.status === 403) throw new ProviderError("unavailable", this.id, undefined, "unauthorised");
        if (response.status === 404) throw new ProviderError("unavailable", this.id, undefined, "model_missing");
        if (!response.ok || !response.body) throw new ProviderError("unavailable", this.id, undefined, `http_${response.status}`);
        if (variants.length > 1) accepted.set(memo, variant);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let firstTokenMs: number | null = null;
        let firstAnswerAt: number | null = null;
        let lastActivity = 0;
        let reasoned = false;
        let finish: string | null = null;
        let usage = { promptTokens: 0, completionTokens: 0 };
        const calls = new Map<number, PartialCall>();
        let finished = false;
        const sawActivity = () => {
          if (firstTokenMs === null) firstTokenMs = Date.now() - started;
          activity();
        };

        while (!finished) {
          let read: ReadableStreamReadResult<Uint8Array>;
          try {
            read = await reader.read();
          } catch {
            throw new ProviderError(timedOut ? "timeout" : caller?.aborted ? "aborted" : "unavailable", this.id, undefined, timedOut ? "timeout" : "stream_broken");
          }
          if (read.done) break;
          buffer += decoder.decode(read.value, { stream: true });
          for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
            const line = buffer.slice(0, at).trim();
            buffer = buffer.slice(at + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") {
              finished = true;
              break;
            }
            let part: Part;
            try {
              part = JSON.parse(data) as Part;
            } catch {
              throw new ProviderError("protocol", this.id, undefined, "bad_chunk");
            }
            if (part.error) throw new ProviderError("unavailable", this.id, undefined, "stream_error");
            if (part.usage) usage = { promptTokens: part.usage.prompt_tokens ?? 0, completionTokens: part.usage.completion_tokens ?? 0 };
            const choice = part.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finish = choice.finish_reason;
            const d = choice.delta ?? {};
            const thought = (typeof d.reasoning_content === "string" ? d.reasoning_content : "") || (typeof d.reasoning === "string" ? d.reasoning : "");
            if (thought) {
              // Hidden reasoning: evidence of work, never the answer. Reported now and then, never yielded as text.
              reasoned = true;
              sawActivity();
              if (Date.now() - lastActivity >= ACTIVITY_EVERY_MS) {
                lastActivity = Date.now();
                yield { type: "activity", kind: "thinking" };
              }
            }
            for (const raw of d.tool_calls ?? []) {
              sawActivity();
              answered();
              const index = typeof raw.index === "number" ? raw.index : calls.size;
              const call = calls.get(index) ?? { id: "", name: "", args: "" };
              if (raw.id) call.id = raw.id;
              if (raw.function?.name) call.name += raw.function.name;
              if (typeof raw.function?.arguments === "string") call.args += raw.function.arguments;
              if (!calls.has(index)) {
                calls.set(index, call);
                yield { type: "activity", kind: "tool_call" };
              }
            }
            const text = typeof d.content === "string" ? d.content : "";
            if (text) {
              sawActivity();
              if (firstAnswerAt === null) {
                firstAnswerAt = Date.now() - started;
                answered();
              }
              yield { type: "text", text };
            }
          }
        }

        // Tool calls are handed over whole, once the stream has said all of them. Arguments that are not a JSON object are an empty object:
        // the caller validates every argument before a tool runs.
        let index = 0;
        for (const call of calls.values()) {
          index += 1;
          if (!call.name) continue;
          let args: Record<string, unknown> = {};
          try {
            const parsed = call.args.trim() ? (JSON.parse(call.args) as unknown) : {};
            args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
          } catch {
            args = {};
          }
          const toolCall: ProviderToolCall = { id: call.id || `call_${index}`, name: call.name, arguments: args };
          yield { type: "tool_call", call: toolCall };
        }

        if (firstAnswerAt === null && calls.size === 0) {
          // Nothing the student could read. Reasoning alone is not an answer, and an empty reply is not a success.
          if (firstTokenMs === null && !finished) throw new ProviderError("protocol", this.id, undefined, "no_events");
          throw new ProviderError("empty", this.id, undefined, reasoned && finish === "length" ? "reasoning_exhausted" : reasoned ? "reasoning_only" : "no_content");
        }
        yield {
          type: "done",
          provider: this.id,
          model,
          usage,
          stats: { firstTokenMs: firstTokenMs ?? Date.now() - started, firstAnswerMs: firstAnswerAt, totalMs: Date.now() - started },
          cutOff: finish === "length",
        };
        return;
      } finally {
        cleanup();
        controller.abort("done");
      }
    }
  }
}

export const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";
