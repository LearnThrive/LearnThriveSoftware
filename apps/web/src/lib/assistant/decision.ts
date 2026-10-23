import type { DecisionConfig } from "./config";

/**
 * The decision role (brief section 10): Laya's typed-decision endpoint, `POST /v1/systemone`, over direct HTTP (no SDK).
 *
 * This is NOT a chat model: it returns one typed answer per question (choice / noul / score), never text. Its job here is only to
 * choose a workflow when the explicit UI action and the file metadata do not already decide one. It never decides
 * authentication, entitlement, consent, file ownership, tool permission or correctness — the server has already done those before
 * this is called, and does them again whatever it says.
 *
 * Measured shapes on Ollama 0.40.9 (2026-10-23, laya:421m-typed-decisions-bf16):
 *   choice -> { type, choice, probabilities: {option: p}, confidence }
 *   noul   -> { type, noul: p }              (probability of "yes"; no confidence field)
 *   score  -> { type, score, legend, probabilities, confidence }
 * The tag pins `num_ctx 1024`, so the state sent here is compact (a short excerpt of the message plus what is attached). A
 * timeout, an unavailable helper, a low probability or an unexpected shape all return null: the caller then uses deterministic
 * routing, and the student's question is answered by the ordinary tutor path.
 */
export const ROUTE_INTENTS = ["general_chat", "explain_question", "search_material", "solve_paper", "clarify"] as const;
export type RouteIntent = (typeof ROUTE_INTENTS)[number];

export type DecisionSource = "explicit" | "model" | "fallback";

export interface RouteDecision {
  intent: RouteIntent;
  /** The model's own probability for the choice it made (0 when deterministic). Not a probability of being right. */
  confidence: number;
  source: DecisionSource;
}

interface ChoiceAnswer {
  type?: string;
  choice?: unknown;
  probabilities?: unknown;
  confidence?: unknown;
}

const MAX_STATE_CHARS = 1200;

export class SystemOneClient {
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: DecisionConfig, fetchImpl?: typeof fetch) {
    this.doFetch = fetchImpl ?? fetch;
  }

  get id(): string {
    return `systemone:${this.config.model}`;
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  /** Whether the helper answers and has the model. Never throws. */
  async health(signal?: AbortSignal): Promise<{ ok: boolean; detail: string }> {
    try {
      const response = await this.doFetch(this.url("/api/tags"), { signal: signal ?? AbortSignal.timeout(3_000) });
      if (!response.ok) return { ok: false, detail: "unreachable" };
      const body = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
      const names = new Set((body.models ?? []).flatMap((m) => [m.name, m.model]).filter(Boolean));
      return names.has(this.config.model) || names.has(`${this.config.model}:latest`) ? { ok: true, detail: "ok" } : { ok: false, detail: "model_missing" };
    } catch {
      return { ok: false, detail: "unreachable" };
    }
  }

  /**
   * One compact routing decision. `state` is a short, already-sanitised description (never a transcript, never a file path).
   * Returns null on timeout, failure, a low-probability answer or an answer this client cannot validate.
   */
  async route(state: string, options: { signal?: AbortSignal } = {}): Promise<RouteDecision | null> {
    const compact = state.replace(/\s+/g, " ").trim().slice(0, MAX_STATE_CHARS);
    if (!compact) return null;
    const body = {
      model: this.config.model,
      state: compact,
      questions: {
        intent: {
          type: "choice",
          instructions: "Choose the workflow for this student message.",
          criteria: {
            general_chat: "A greeting, a definition or a short question that needs no attached material.",
            explain_question: "Asks for help understanding or checking a specific question in attached or earlier material.",
            search_material: "Asks to find something in their own notes, uploads or Library resources.",
            solve_paper: "Asks for a whole paper or a list of questions to be solved.",
            clarify: "The request cannot be understood without asking the student a question.",
          },
        },
        needs_working: {
          type: "noul",
          instructions: "Would step-by-step working be useful in the answer?",
          criteria: { true: "It is a maths, science or reasoning problem.", false: "It is a greeting, a definition or a fact." },
        },
      },
      keep_alive: this.config.keepAlive,
    };
    let response: Response;
    try {
      response = await this.doFetch(this.url("/v1/systemone"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal ?? AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    let reply: { answers?: { intent?: ChoiceAnswer }; error?: unknown };
    try {
      reply = (await response.json()) as typeof reply;
    } catch {
      return null;
    }
    if (reply.error) return null;
    const answer = reply.answers?.intent;
    if (!answer || answer.type !== "choice" || typeof answer.choice !== "string") return null;
    if (!(ROUTE_INTENTS as readonly string[]).includes(answer.choice)) return null;
    const probabilities = answer.probabilities && typeof answer.probabilities === "object" ? (answer.probabilities as Record<string, unknown>) : {};
    const values = Object.entries(probabilities);
    const numbers = values.filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]));
    // A malformed distribution is not a decision: every option must be a number and the probabilities must sum to one.
    if (values.length && (numbers.length !== values.length || Math.abs(numbers.reduce((s, [, v]) => s + v, 0) - 1) > 0.05)) return null;
    const ranked = numbers.map(([, v]) => v).sort((a, b) => b - a);
    const confidence = typeof probabilities[answer.choice] === "number" ? (probabilities[answer.choice] as number) : typeof answer.confidence === "number" && Number.isFinite(answer.confidence) ? answer.confidence : 0;
    if (confidence < this.config.minConfidence) return null;
    // A five-way tie (a greeting, say) is not a route: the margin over the next option must also be clear.
    if (ranked.length > 1 && ranked[0]! - ranked[1]! < this.config.minMargin) return null;
    // The named choice must be the most probable one: anything else is an inconsistent answer, not a route.
    if (ranked.length && confidence !== ranked[0]) return null;
    return { intent: answer.choice as RouteIntent, confidence, source: "model" };
  }
}

/**
 * Routing that does not need a model, and the fallback when the model abstains. The explicit action and the file metadata come
 * first: an uploaded paper or photo is already evidence that the question path is wanted, so no separate classifier call is spent
 * rediscovering it (brief section 10).
 */
export function deterministicRoute(input: { text: string; hasFreshFiles: boolean; hasHistory: boolean; explicit?: RouteIntent }): RouteDecision | null {
  if (input.explicit) return { intent: input.explicit, confidence: 1, source: "explicit" };
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) return input.hasFreshFiles ? { intent: "explain_question", confidence: 1, source: "explicit" } : null;
  if (/\b(solve|work through|do)\b.{0,40}\b(paper|whole|all (of )?(the )?questions)\b/i.test(text)) return { intent: "solve_paper", confidence: 0.9, source: "fallback" };
  if (/\b(search|find|look(ing)? (for|through)|in my|from my|my notes|my (own )?upload)\b/i.test(text)) return { intent: "search_material", confidence: 0.8, source: "fallback" };
  if (/\b(question|q\.?|part|page)\s*\d{1,2}\b/i.test(text) || /\bthis (question|one|photo|page)\b/i.test(text)) return { intent: "explain_question", confidence: 0.85, source: "fallback" };
  if (input.hasFreshFiles) return { intent: "explain_question", confidence: 0.9, source: "explicit" };
  if (/\b(exercise|problem|equation|prove|show that|calculate|simultaneous|fraction)\b/i.test(text)) return { intent: "explain_question", confidence: 0.6, source: "fallback" };
  const words = text.split(/\s+/).length;
  if (words <= 4 && !/[?]$/.test(text)) return { intent: "clarify", confidence: 0.5, source: "fallback" };
  return null;
}

/**
 * Whether a route is worth asking the model about. Short greetings and messages whose route is already obvious stay out (three
 * roles must not mean three serial inference calls on every message), as does anything with a fresh upload.
 */
export function needsDecision(text: string, hasFreshFiles: boolean, hasHistory: boolean): boolean {
  const stripped = text.replace(/\s+/g, " ").trim();
  if (!stripped || hasFreshFiles) return false;
  const words = stripped.split(" ").length;
  if (words < 4) return false;
  if (deterministicRoute({ text: stripped, hasFreshFiles, hasHistory })?.confidence === 1) return false;
  // Only a question that could plausibly be a search or an explanation is ambiguous enough to be worth a helper call.
  return hasHistory || /\b(can you|could you|help|explain|what|why|how|find|look|question|paper|notes|stuck|check)\b/i.test(stripped);
}
