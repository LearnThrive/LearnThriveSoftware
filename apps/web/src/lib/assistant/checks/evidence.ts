import type { ClaimStatus } from "../research/claims";
import type { QuoteStatus } from "../research/verify";

/**
 * One vocabulary for what the server found out about a statement, whatever the subject and whatever did the checking (docs/RESEARCH.md,
 * "Evidence statuses"). Each checker (quotations, events, calculations, chemical equations) keeps its own detailed result; this is the shared
 * judgement the gate and the notes under an answer work from.
 *
 *   VERIFIED      checked against the primary evidence and it holds: the words are in the text, the calculation is right
 *   SUPPORTED     a reliable source says so, but not the primary text, or the wording differs slightly
 *   INFERRED      an interpretation or a reasonable conclusion, not a fact a source could confirm (analysis, judgement)
 *   CONTESTED     sources disagree
 *   UNSUPPORTED   looked for and not found in what was read
 *   CONTRADICTED  the evidence says otherwise: a wrong speaker, a misquotation, a wrong step of working, an equation that does not balance
 *   UNVERIFIABLE  could not be checked (nothing to check it against, a service down, a form the checker cannot read)
 *
 * A search snippet, a revision site, or another model agreeing is never VERIFIED. UNVERIFIABLE is never treated as wrong: it is said, not cut.
 */
export type EvidenceStatus = "VERIFIED" | "SUPPORTED" | "INFERRED" | "CONTESTED" | "UNSUPPORTED" | "CONTRADICTED" | "UNVERIFIABLE";

export function quoteEvidence(status: QuoteStatus): EvidenceStatus {
  switch (status) {
    case "verified_exact":
      return "VERIFIED";
    case "verified_variant":
    case "supported_secondary":
      return "SUPPORTED";
    case "incorrect_attribution":
    case "paraphrase_or_misquote":
      return "CONTRADICTED";
    case "unsupported":
      return "UNSUPPORTED";
    default:
      return "UNVERIFIABLE";
  }
}

export function claimEvidence(status: ClaimStatus): EvidenceStatus {
  return status === "supported" ? "SUPPORTED" : status === "contradicted" ? "CONTRADICTED" : "UNSUPPORTED";
}

/** Statuses the gate acts on: shown to be wrong, or searched for and absent. Everything else is reported, never repaired or cut. */
export const actionable = (status: EvidenceStatus): boolean => status === "CONTRADICTED" || status === "UNSUPPORTED";
