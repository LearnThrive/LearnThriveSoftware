import type { RecallConfig } from "../config";
import { characterNames, sameCharacter } from "./claims";
import { words } from "./quotations";

/**
 * The entailment-for-recall stage: finding the passage of a source that bears on a statement, by MEANING rather than by shared words.
 *
 * The gate's event check (research/claims.ts) reads the pages with a short list of twelve event patterns and compares WHO did what. That is exact but
 * narrow, and it fails in one direction that matters: when a page says the same thing in other words ("Eric is dismissed from the works" for the claim
 * "Eric is sent to prison"), the page produces no pattern at all, so the claim is judged UNSUPPORTED — which the gate acts on, cutting or repairing a
 * sentence the sources do in fact support. The wording, not the facts, decided it.
 *
 * So a model is asked to FIND the passage: for each unsupported claim, it proposes a span copied from one of the pages that were read and says whether
 * that span supports the claim or shows it happened to somebody else. It is a RECALL stage, and it is allowed to be one, because everything it
 * proposes is then checked in code before it counts:
 *
 *   - the span must really be in the page it names, word for word (locateWords), so a model cannot invent support out of nothing;
 *   - it must be at least four words, because a two-word "support" proves nothing;
 *   - a "supports" span must NAME the claim's own character (the discipline the event check exists for: the name proves nothing, but a span that
 *     supports "Eric is sent to prison" without mentioning Eric is not evidence about Eric);
 *   - a "contradicts" span must name somebody else, and it is that other person that is reported;
 *   - anything else — an unknown page id, an unknown claim, a relation it did not offer, an unreachable or slow helper, a malformed answer — is
 *     dropped, and the caller keeps exactly the result the exact check produced.
 *
 * The stage can therefore only ADD evidence it can point at. It can never make a claim verified (that needs the words of a text, research/verify.ts),
 * and it cannot suppress a problem: a claim it contradicts was already actionable.
 */
export type RecallRelation = "supports" | "contradicts" | "unrelated";

export interface RecallClaim {
  id: string;
  /** The claim's own character, as the reply named them. */
  subject: string;
  /** The event the reply attributed to them (one of the event-check's own labels). */
  event: string;
  /** The sentence as the reply wrote it. */
  sentence: string;
}

export interface RecallPassage {
  id: string;
  /** Where the passage came from, for the note under the answer: a page title or address, never a query. */
  label: string;
  text: string;
}

export interface RecallProposal {
  claim: string;
  relation: RecallRelation;
  passage: string | null;
  span: string;
}

export interface AcceptedSupport {
  claim: string;
  relation: "supports" | "contradicts";
  /** The words the model copied, shown to occur in that page in that order (locateWords). Nothing is displayed from it: it decides, it does not quote. */
  span: string;
  label: string;
  /** For a contradiction: who the source says did it. */
  others: string[];
}

export interface ClaimRecall {
  readonly id: string;
  findSupport(input: { claims: readonly RecallClaim[]; passages: readonly RecallPassage[]; signal?: AbortSignal }): Promise<RecallProposal[]>;
}

/** A span of fewer words than this proves nothing about a claim, whatever the model says about it. */
export const MIN_SPAN_WORDS = 4;

/**
 * The span as it stands, when those words really occur in that passage, in that order; null when they do not. The comparison is on the WORDS (case,
 * punctuation, line breaks, curly quotes and accents are not differences — the rule `matchQuotation` uses), and what is returned is what the model
 * copied, because that is what has just been shown to be on the page: the caller keeps the model's own capitalisation to read the names in it.
 */
export function locateWords(span: string, passage: string): string | null {
  const needle = words(span);
  const hay = words(passage);
  if (needle.length < MIN_SPAN_WORDS || hay.length < needle.length) return null;
  outer: for (let i = 0; i + needle.length <= hay.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (hay[i + j] !== needle[j]) continue outer;
    return span.replace(/\s+/g, " ").trim();
  }
  return null;
}

/** What the stage proposed, kept only where the code above can stand behind it. */
export function acceptSupports(proposals: readonly RecallProposal[], claims: readonly RecallClaim[], passages: readonly RecallPassage[]): AcceptedSupport[] {
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const passageById = new Map(passages.map((p) => [p.id, p]));
  const out: AcceptedSupport[] = [];
  const seen = new Set<string>();
  for (const proposal of proposals) {
    const claim = claimById.get(proposal.claim);
    if (!claim || proposal.relation === "unrelated") continue;
    const passage = proposal.passage ? passageById.get(proposal.passage) : undefined;
    if (!passage) continue;
    const key = `${proposal.claim}|${proposal.relation}`;
    if (seen.has(key)) continue;
    const span = locateWords(proposal.span, passage.text);
    if (!span) continue;
    const names = characterNames(span);
    if (proposal.relation === "supports") {
      // The span must be about the character the claim is about. It is the same rule the exact check applies, in the other direction.
      if (!names.some((name) => sameCharacter(name, claim.subject))) continue;
      seen.add(key);
      out.push({ claim: claim.id, relation: "supports", span, label: passage.label, others: [] });
      continue;
    }
    const others = [...new Set(names.filter((name) => !sameCharacter(name, claim.subject)).map((name) => name.replace(/['’]s$/, "")))].slice(0, 3);
    if (!others.length) continue;
    seen.add(key);
    out.push({ claim: claim.id, relation: "contradicts", span, label: passage.label, others });
  }
  return out;
}

const INSTRUCTIONS = `You find where a source settles a statement about a story or a period of history.
You are given CLAIMS and PASSAGES. For each claim, decide what the passages say about it.
Answer with one JSON object and nothing else:
{"matches":[{"claim":"c1","relation":"supports","passage":"p1","span":"words copied from the passage"}]}
relation is "supports" if a passage says the claim is so; "contradicts" if a passage says it happened to somebody else; "unrelated" if no passage is about it.
The span must be copied word for word from the passage, at least four words long. Never write a span in your own words. If you cannot copy such a span, answer "unrelated".`;

interface ChatReply {
  message?: { content?: unknown };
  error?: unknown;
}

export class LocalClaimRecall implements ClaimRecall {
  readonly id: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly config: RecallConfig, fetchImpl?: typeof fetch) {
    this.doFetch = fetchImpl ?? fetch;
    this.id = `recall:${config.model}`;
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  health(signal?: AbortSignal): Promise<{ ok: boolean; detail: string }> {
    return (async () => {
      try {
        const response = await this.doFetch(this.url("/api/tags"), { signal: signal ?? AbortSignal.timeout(3_000) });
        if (!response.ok) return { ok: false, detail: "unreachable" };
        const body = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
        const names = new Set((body.models ?? []).flatMap((m) => [m.name, m.model]).filter(Boolean));
        return names.has(this.config.model) || names.has(`${this.config.model}:latest`) ? { ok: true, detail: "ok" } : { ok: false, detail: "model_missing" };
      } catch {
        return { ok: false, detail: "unreachable" };
      }
    })();
  }

  /**
   * One bounded call: a few claims, the pages that were read (each shortened), one JSON answer. Every failure is an empty result, which leaves the
   * caller with exactly what the exact check found.
   */
  async findSupport(input: { claims: readonly RecallClaim[]; passages: readonly RecallPassage[]; signal?: AbortSignal }): Promise<RecallProposal[]> {
    const claims = input.claims.slice(0, this.config.maxClaims);
    if (!claims.length || !input.passages.length) return [];
    const passages = input.passages.map((p) => ({ id: p.id, text: p.text.replace(/\s+/g, " ").trim().slice(0, this.config.passageChars) }));
    const payload = JSON.stringify({
      claims: claims.map((c) => ({ id: c.id, statement: c.sentence.replace(/\s+/g, " ").trim().slice(0, 300) })),
      passages: passages.filter((p) => p.text.length > 40),
    });
    let response: Response;
    try {
      response = await this.doFetch(this.url("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: input.signal ?? AbortSignal.timeout(this.config.timeoutMs),
        body: JSON.stringify({
          model: this.config.model,
          stream: false,
          keep_alive: this.config.keepAlive,
          // A small local model answers in the shape it is asked for far more reliably when the runtime constrains it to JSON.
          format: "json",
          options: { temperature: 0 },
          messages: [
            { role: "system", content: INSTRUCTIONS },
            { role: "user", content: payload },
          ],
        }),
      });
    } catch {
      return [];
    }
    if (!response.ok) return [];
    let body: ChatReply;
    try {
      body = (await response.json()) as ChatReply;
    } catch {
      return [];
    }
    if (body.error) return [];
    const content = body.message?.content;
    if (typeof content !== "string") return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return [];
    }
    const matches = (parsed as { matches?: unknown })?.matches;
    if (!Array.isArray(matches)) return [];
    const out: RecallProposal[] = [];
    for (const raw of matches.slice(0, this.config.maxClaims * 2)) {
      if (!raw || typeof raw !== "object") continue;
      const m = raw as { claim?: unknown; relation?: unknown; passage?: unknown; span?: unknown };
      if (typeof m.claim !== "string" || typeof m.span !== "string") continue;
      if (m.relation !== "supports" && m.relation !== "contradicts" && m.relation !== "unrelated") continue;
      out.push({ claim: m.claim, relation: m.relation, passage: typeof m.passage === "string" ? m.passage : null, span: m.span });
    }
    return out;
  }
}
