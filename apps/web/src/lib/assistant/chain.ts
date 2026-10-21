import { ProviderError, type ChatProvider, type ProviderCapabilities, type ProviderHealth, type ProviderMessage, type StreamChunk, type StreamOptions } from "./types";

/**
 * An ordered fallback chain (plan19 section 5.1), for development: for example Ollama first and NIM second. Each step has its
 * own first-token and total timeouts (the caller passes them; a step can narrow them). A step that fails BEFORE it has produced a
 * token, because it is unreachable, too slow or rate limited, hands the request to the next one. Once text has started to flow
 * there is no fallback: switching model mid-answer would stitch two answers together. A bad request is not retried elsewhere
 * (the next provider would refuse it too), and a caller's abort stops everything.
 */
export interface ChainStep {
  provider: ChatProvider;
  /** Narrower timeouts for this step. */
  firstTokenTimeoutMs?: number;
  totalTimeoutMs?: number;
}

const FALLBACK_ON = new Set(["unavailable", "timeout", "rate_limited", "protocol"]);

export class FallbackProvider implements ChatProvider {
  readonly id: string;

  constructor(private readonly steps: readonly ChainStep[]) {
    if (steps.length === 0) throw new Error("a fallback chain needs at least one provider");
    this.id = steps.map((s) => s.provider.id).join("+");
  }

  async capabilities(model?: string): Promise<ProviderCapabilities> {
    return this.steps[0]!.provider.capabilities(model);
  }

  async health(signal?: AbortSignal): Promise<ProviderHealth> {
    const results = await Promise.all(this.steps.map((s) => s.provider.health(signal)));
    const ok = results.find((r) => r.ok);
    return ok ?? results[0]!;
  }

  async *stream(messages: readonly ProviderMessage[], options: StreamOptions): AsyncGenerator<StreamChunk> {
    let last: ProviderError | null = null;
    for (const step of this.steps) {
      if (options.signal?.aborted) throw new ProviderError("aborted", this.id);
      let started = false;
      try {
        const narrowed: StreamOptions = {
          ...options,
          firstTokenTimeoutMs: Math.min(options.firstTokenTimeoutMs, step.firstTokenTimeoutMs ?? options.firstTokenTimeoutMs),
          totalTimeoutMs: Math.min(options.totalTimeoutMs, step.totalTimeoutMs ?? options.totalTimeoutMs),
        };
        for await (const chunk of step.provider.stream(messages, narrowed)) {
          if (chunk.type === "text") started = true;
          yield chunk;
        }
        return;
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        if (started || !FALLBACK_ON.has(error.code)) throw error;
        last = error;
      }
    }
    throw last ?? new ProviderError("unavailable", this.id);
  }
}
