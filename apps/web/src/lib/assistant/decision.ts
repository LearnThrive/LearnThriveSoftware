/**
 * Routing for a turn (brief section 10). It is deterministic: the explicit UI action and the file metadata decide, and anything ambiguous is answered by the
 * ordinary tutor path. There used to be a small local "decision" model for the ambiguous cases; it was removed with the rest of the local helper models, and
 * nothing it decided ever bypassed the server's own checks (authentication, entitlement, consent, file ownership, tool permission, correctness).
 */
export const ROUTE_INTENTS = ["general_chat", "explain_question", "search_material", "solve_paper", "clarify"] as const;
export type RouteIntent = (typeof ROUTE_INTENTS)[number];

export type DecisionSource = "explicit" | "model" | "fallback";

export interface RouteDecision {
  intent: RouteIntent;
  /** 1 for an explicit action or file metadata, lower for a pattern match. Not a probability of being right. */
  confidence: number;
  source: DecisionSource;
}

/**
 * The explicit action and the file metadata come first: an uploaded paper or photo is already evidence that the question path is wanted, so no separate
 * classification is spent rediscovering it. Null means "no particular route": an ordinary chat turn.
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
