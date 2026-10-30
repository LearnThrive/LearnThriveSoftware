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
