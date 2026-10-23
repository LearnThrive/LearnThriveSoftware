import type { EmbeddingConfig } from "./config";

/**
 * The embedding role (brief sections 4 and 9): `POST /api/embed` on the CPU helper server, with batching and validation.
 *
 * EmbeddingGemma 2 expects an instructional prefix on TEXT. Its modelfile (checked with `/api/show`) adds none, and its model card
 * gives: queries `task: search result | query: ` and documents `title: none | text: `. Ollama's own community package says the
 * same. The prefix is applied here, never in the caller, so a chunk and a query cannot be embedded with the same prefix by
 * accident. Documents we index have no title of their own beyond the file; the page/question label is the title when there is one.
 *
 * Validation is deliberately strict: an embedding that is not a finite vector of the expected dimension is a failure, never a
 * zero vector, because a zero vector silently matches everything. Input that is too large is REFUSED, not truncated: losing half a
 * question is worse than saying so.
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

export const EMBEDDING_PREFIXES = {
  query: "task: search result | query: ",
  /** `title: none | text: ...` — the model card's prefix for a document without a title. */
  document: (title?: string) => `title: ${title?.trim() ? title.trim().slice(0, 120) : "none"} | text: `,
} as const;

export interface OllamaEmbeddingOptions extends EmbeddingConfig {
  dimension?: number;
  /** The most characters of one input. Sized for short chunks (a few hundred tokens), not a whole document. */
  maxChars?: number;
  fetch?: typeof fetch;
}

interface EmbedReply {
  embeddings?: unknown;
  embedding?: unknown;
  error?: string;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id = "ollama-embed";
  readonly model: string;
  private readonly doFetch: typeof fetch;
  private readonly maxChars: number;
  private learned: number;

  constructor(private readonly config: OllamaEmbeddingOptions) {
    this.model = config.model;
    this.doFetch = config.fetch ?? fetch;
    this.maxChars = config.maxChars ?? 4000;
    this.learned = config.dimension ?? 0;
  }

  get dimension(): number {
    return this.learned;
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private prepare(input: string, kind: EmbeddingKind, title?: string): string {
    const text = input.replace(/\s+/g, " ").trim();
    if (!text) throw new EmbeddingError("bad_input", this.id);
    if (text.length > this.maxChars) throw new EmbeddingError("too_long", this.id);
    return (kind === "query" ? EMBEDDING_PREFIXES.query : EMBEDDING_PREFIXES.document(title)) + text;
  }

  async embed(inputs: readonly string[], options: { kind?: EmbeddingKind; title?: string; signal?: AbortSignal } = {}): Promise<number[][]> {
    if (!inputs.length) return [];
    if (inputs.length > 64) throw new EmbeddingError("bad_input", this.id);
    const kind = options.kind ?? "document";
    const prepared = inputs.map((text) => this.prepare(text, kind, options.title));
    const out: number[][] = [];
    for (let at = 0; at < prepared.length; at += this.config.batch) {
      out.push(...(await this.batch(prepared.slice(at, at + this.config.batch), options.signal)));
    }
    return out;
  }

  private async batch(prepared: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    let response: Response;
    try {
      response = await this.doFetch(this.url("/api/embed"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: signal ?? AbortSignal.timeout(60_000),
        body: JSON.stringify({ model: this.model, input: prepared, keep_alive: this.config.keepAlive, truncate: false }),
      });
    } catch {
      throw new EmbeddingError(signal?.aborted ? "aborted" : "unavailable", this.id);
    }
    if (!response.ok) {
      // `truncate: false` makes an over-long input a 4xx instead of a silently cut chunk.
      throw new EmbeddingError(response.status === 400 || response.status === 413 ? "too_long" : "unavailable", this.id);
    }
    let body: EmbedReply;
    try {
      body = (await response.json()) as EmbedReply;
    } catch {
      throw new EmbeddingError("protocol", this.id);
    }
    if (body.error) throw new EmbeddingError("unavailable", this.id);
    const vectors = Array.isArray(body.embeddings) ? body.embeddings : Array.isArray(body.embedding) ? [body.embedding] : null;
    if (!vectors || vectors.length !== prepared.length) throw new EmbeddingError("protocol", this.id);
    const checked: number[][] = [];
    for (const raw of vectors) {
      if (!Array.isArray(raw) || raw.length === 0) throw new EmbeddingError("protocol", this.id);
      const vector: number[] = [];
      for (const value of raw) {
        if (typeof value !== "number" || !Number.isFinite(value)) throw new EmbeddingError("protocol", this.id);
        vector.push(value);
      }
      if (this.learned && vector.length !== this.learned) throw new EmbeddingError("protocol", this.id);
      if (!this.learned) this.learned = vector.length;
      checked.push(vector);
    }
    return checked;
  }

  async health(signal?: AbortSignal): Promise<{ ok: boolean; detail: string }> {
    try {
      const response = await this.doFetch(this.url("/api/tags"), { signal: signal ?? AbortSignal.timeout(5_000) });
      if (!response.ok) return { ok: false, detail: "unreachable" };
      const body = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
      const names = new Set((body.models ?? []).flatMap((m) => [m.name, m.model]).filter(Boolean));
      return names.has(this.model) || names.has(`${this.model}:latest`) ? { ok: true, detail: "ok" } : { ok: false, detail: "model_missing" };
    } catch {
      return { ok: false, detail: "unreachable" };
    }
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
