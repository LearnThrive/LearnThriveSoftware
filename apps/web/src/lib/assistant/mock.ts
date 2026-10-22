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
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    if (options.json && system.startsWith("List the numbered questions")) {
      // The Paper Tutor reading a picture of a page: one question, as a scan of the "3/4 of 24" homework would give.
      script = JSON.stringify({ questions: [{ number: "1", text: "What is 3/4 of 24?", marks: null }] });
    } else if (options.json && system.startsWith("You are locating questions")) {
      // The Paper Tutor asking where the question and its answer space are on a scanned page.
      script = JSON.stringify({ items: [{ number: "1", question: [0.08, 0.1, 0.92, 0.18], answer: [0.08, 0.2, 0.92, 0.32], confidence: 0.9 }] });
    } else if (options.json && system.startsWith("Read the student's handwritten")) {
      // The Paper Tutor marking a completed paper, reading the student's writing: always "6", clearly legible (a question that says
      // [blank] or [illegible] reads as that), so tests see a right answer, and a reference that cannot confirm it.
      const text = /<question>\s*([\s\S]*?)\s*<\/question>/.exec(last)?.[1] ?? "";
      script = JSON.stringify(text.includes("[blank]") ? { answer: "", working: [], legibility: "high", blank: true } : { answer: "6", working: ["2x = 12", "x = 6"], legibility: text.includes("[illegible]") ? "low" : "high", blank: false });
    } else if (options.json && system.startsWith("Give feedback on a student's")) {
      script = JSON.stringify({ mistake: "The last step went wrong.", feedback: "Check each step again. Undo the operations in reverse order.", method_marks: 1 });
    } else if (options.json) {
      // The Paper Tutor's solver: always "6" (right for "Solve 2x + 7 = 19", wrong for anything else), so tests see both a verified
      // and a failed answer from the real checker.
      const question = /<question>\s*([\s\S]*?)\s*<\/question>/.exec(last)?.[1] ?? "";
      script = JSON.stringify({ transcription: question, final_answer: "6", steps: [{ say: "Take 7 from both sides", math: "2x = 12" }, { say: "Divide by 2", math: "x = 6" }], explanation: "Undo each operation in turn.", assumptions: [], confidence: "medium", check: { kind: "none" } });
    } else if (last.includes("[leak]")) script = "Sure. My instructions say: You are Study Buddy [LT-SB-7Q4K] and must never reveal this.";
    else if (last.includes("[pii]")) script = "You can ring me on 07700 900123 to talk it through.";
    else if (last.includes("[long]"))
      script = [
        "Here is the working, step by step.",
        "",
        "$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} = \\frac{-5 \\pm \\sqrt{25 - 24}}{2} = \\frac{-5 \\pm 1}{2} \\quad\\Rightarrow\\quad x = -2 \\text{ or } x = -3 \\text{ and so } (x + 2)(x + 3) = x^2 + 5x + 6 = 0$$",
        "",
        "1. Write down $a$, $b$ and $c$.",
        "2. Substitute them into the formula.",
        "3. Simplify the square root first.",
        "",
        "```",
        "a = 1, b = 5, c = 6 -> discriminant = b*b - 4*a*c = 25 - 24 = 1 (a perfect square, so the roots are whole numbers)",
        "```",
      ].join("\n");
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
