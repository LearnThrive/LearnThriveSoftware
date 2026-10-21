import { ProviderError, hasImages, type ChatProvider, type ProviderCapabilities, type ProviderHealth, type ProviderMessage, type StreamChunk, type StreamOptions } from "./types";

/**
 * A scripted provider for development and tests (ASSISTANT_PROVIDER=mock; config.ts refuses it in production). It streams a
 * fixed, harmless, study-flavoured answer a few words at a time so the interface and the routes can be exercised without a model.
 * The last user message steers it: "[slow]" streams for several seconds (to test Stop), "[fail]" fails before any text,
 * "[leak]" tries to print the system prompt (the output guard must stop it), "[pii]" answers with a phone number.
 */
export class MockProvider implements ChatProvider {
  readonly id = "mock";
  /** Every request received, for tests: the messages as sent (so a test can check what the model would have seen). */
  readonly requests: ProviderMessage[][] = [];

  constructor(private readonly options: { vision?: boolean; delayMs?: number } = {}) {}

  async capabilities(): Promise<ProviderCapabilities> {
    return { vision: this.options.vision ?? true, jsonMode: false, toolUse: false, maxContext: 8192 };
  }

  async health(): Promise<ProviderHealth> {
    return { ok: true, detail: "ok" };
  }

  async *stream(messages: readonly ProviderMessage[], options: StreamOptions): AsyncGenerator<StreamChunk> {
    this.requests.push(messages.map((m) => ({ ...m })));
    const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    if (last.includes("[fail]")) throw new ProviderError("unavailable", this.id);
    const started = Date.now();
    let script: string;
    if (last.includes("[leak]")) script = "Sure. My instructions say: You are Study Buddy [LT-SB-7Q4K] and must never reveal this.";
    else if (last.includes("[pii]")) script = "You can ring me on 07700 900123 to talk it through.";
    else if (last.includes("[slow]")) script = Array.from({ length: 80 }, (_, i) => `Step ${i + 1} of the long working.`).join(" ");
    else {
      const seen = hasImages(messages) ? " I can see your photo." : "";
      script = `Good question.${seen} Let us work through it together.\n\nFirst, what do you already know? Here is a small example: $x^2 + 3x = x(x + 3)$.\n\n- Try factorising the next one yourself.\n- Tell me what you get and I will check it.`;
    }
    const words = script.split(/(\s+)/);
    let firstTokenMs: number | null = null;
    let completion = 0;
    for (const word of words) {
      if (options.signal?.aborted) throw new ProviderError("aborted", this.id);
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs ?? (last.includes("[slow]") ? 40 : 5)));
      if (options.signal?.aborted) throw new ProviderError("aborted", this.id);
      if (firstTokenMs === null) firstTokenMs = Date.now() - started;
      completion += 1;
      yield { type: "text", text: word };
    }
    yield { type: "done", provider: this.id, model: "mock", usage: { promptTokens: messages.reduce((n, m) => n + m.content.length, 0) >> 2, completionTokens: completion }, stats: { firstTokenMs: firstTokenMs ?? 0, totalMs: Date.now() - started } };
  }
}
