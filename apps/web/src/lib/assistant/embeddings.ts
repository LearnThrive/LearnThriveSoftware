/**
 * The embedding role's contract (brief sections 4 and 9). There is no embedding provider configured now: the local one (EmbeddingGemma on a CPU helper) was
 * removed with the other local models, so retrieval over a student's own uploads is off (config.ts, `ASSISTANT_RETRIEVAL`). The interface stays because
 * retrieval.ts is written against it, and a hosted embedder can be plugged in later without touching the retrieval code.
 *
 * Validation, when one exists, must stay strict: an embedding that is not a finite vector of the expected dimension is a failure, never a zero vector,
 * because a zero vector silently matches everything. Input that is too large is REFUSED, not truncated.
 */

export type EmbeddingKind = "query" | "document";

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  /** The vector size, when known up front (from the model's own metadata). 0: learned from the first valid response. */
  readonly dimension: number;
  embed(inputs: readonly string[], options?: { kind?: EmbeddingKind; title?: string; signal?: AbortSignal }): Promise<number[][]>;
  health(signal?: AbortSignal): Promise<{ ok: boolean; detail: string }>;
}

export class EmbeddingError extends Error {
  constructor(readonly code: "too_long" | "bad_input" | "unavailable" | "protocol" | "aborted", readonly provider: string) {
    super(`${provider}: ${code}`);
  }
}

/** Cosine similarity over two equal-length vectors. Null for anything that cannot be compared (never a made-up score). */
export function cosine(a: readonly number[], b: readonly number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let an = 0;
  let bn = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    an += a[i]! * a[i]!;
    bn += b[i]! * b[i]!;
  }
  if (an === 0 || bn === 0) return null;
  const value = dot / (Math.sqrt(an) * Math.sqrt(bn));
  return Number.isFinite(value) ? value : null;
}
