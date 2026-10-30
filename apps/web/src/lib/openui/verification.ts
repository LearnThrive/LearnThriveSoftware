import { publicHost, safeSource } from "@/lib/assistant/activity";
import type { QuoteStatus, QuoteVerdict, ResearchSession } from "@/lib/assistant/research/verify";
import { QUOTE_STATUS_LABEL, quoteKey, type QuoteCheck, type QuoteVerification, type SourceNote } from "./format";
import type { QuoteRequest } from "./validate";

/**
 * What the server found out about the quotations in an interface, in the five states a student is shown. This REUSES the research layer's own quotation
 * checker (research/verify.ts: it reads the text of the work and matches the words, the speaker and the place); nothing here judges a quotation itself.
 *
 *   VERIFIED_EXACT         the exact words were found in a primary text or an exam board's own page that was read
 *   VERIFIED_VARIANT       very close to a primary text (spelling, punctuation or a small variation), not word for word
 *   INCORRECT_ATTRIBUTION  the words are in the text, spoken by someone else or somewhere else than the interface says
 *   PARAPHRASE             something close is in the sources, but not these words: a paraphrase or a misquotation
 *   UNVERIFIED             everything else: only a secondary site had it, no source had it, or nothing could be read. NOT a claim that it is wrong
 *
 * "Verified" is never the model's word. A quotation that was not checked, or could not be, is shown as unverified, with the reason.
 */
export const STATUS_LABEL = QUOTE_STATUS_LABEL;

const MAX_QUOTES = 6;
const quote = (s: string) => `“${s.replace(/\s+/g, " ").trim().slice(0, 200)}”`;

const STATUS: Record<QuoteStatus, QuoteVerification> = {
  verified_exact: "VERIFIED_EXACT",
  verified_variant: "VERIFIED_VARIANT",
  incorrect_attribution: "INCORRECT_ATTRIBUTION",
  paraphrase_or_misquote: "PARAPHRASE",
  supported_secondary: "UNVERIFIED",
  unsupported: "UNVERIFIED",
  unverifiable: "UNVERIFIED",
};

/** One verdict of the research layer as what the page shows. */
export function toCheck(verdict: QuoteVerdict): QuoteCheck {
  const status = STATUS[verdict.status];
  const where = [verdict.speaker, verdict.location].filter(Boolean).join(", ");
  const read = verdict.evidence.find((e) => e.read);
  const link = read ? safeSource({ url: read.url, title: read.title, tier: read.tier }) : null;
  let detail: string;
  switch (verdict.status) {
    case "verified_exact":
      detail = `These exact words are in the text${where ? ` (${where})` : ""}.`;
      break;
    case "verified_variant":
      detail = `Very close to the text${where ? ` (${where})` : ""}, but not word for word.${verdict.sourceWording ? ` The text reads: ${quote(verdict.sourceWording)}` : ""}`;
      break;
    case "incorrect_attribution":
      detail = verdict.note;
      break;
    case "paraphrase_or_misquote":
      detail = `Something close is in the sources, but not these exact words. It may be a paraphrase or a misquotation.${read?.extract ? ` The closest passage: ${quote(read.extract)}` : ""}`;
      break;
    case "supported_secondary":
      detail = "Seen only on a revision or general website, not in the text itself, so it is not confirmed.";
      break;
    case "unsupported":
      detail = "These words were not found in the sources that were read. That does not prove they are wrong: check the text itself.";
      break;
    default:
      detail = verdict.note || "This could not be checked here.";
  }
  return {
    key: quoteKey(verdict.quotation),
    status,
    detail: detail.slice(0, 300),
    ...(verdict.location ? { location: verdict.location } : {}),
    ...(verdict.speaker ? { speaker: verdict.speaker } : {}),
    ...(verdict.sourceWording ? { sourceWording: verdict.sourceWording.slice(0, 300) } : {}),
    ...(link && (verdict.status === "verified_exact" || verdict.status === "verified_variant" || verdict.status === "incorrect_attribution") ? { source: { title: link.title, host: link.host, url: link.url } } : {}),
  };
}

const unchecked = (q: QuoteRequest, why: string): QuoteCheck => ({ key: quoteKey(q.quote), status: "UNVERIFIED", detail: why });

/**
 * Checks each quotation (a handful at most, so the search budget is not spent on a long list) and returns what to store with the interface. With no
 * research available, or none left, a quotation is reported as not verified, with that reason: it is never passed off as checked.
 */
export async function verifyQuotes(session: ResearchSession | null, quotes: readonly QuoteRequest[], extracts: readonly string[] = []): Promise<QuoteCheck[]> {
  const out: QuoteCheck[] = [];
  const seen = new Set<string>();
  for (const q of quotes) {
    const key = quoteKey(q.quote);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (out.length >= MAX_QUOTES) {
      out.push(unchecked(q, "Not checked: only the first few quotations are checked."));
      continue;
    }
    if (!session) {
      out.push(unchecked(q, "This could not be checked here: web research is not available."));
      continue;
    }
    try {
      const scene = q.location ? /scene\s*(\d+)/i.exec(q.location) : null;
      const act = q.location ? /act\s*(\d+)/i.exec(q.location) : null;
      const verdict = await session.verifyQuotation({ quotation: q.quote, work: q.work, claimedSpeaker: q.speaker, claimedAct: act ? Number(act[1]) : null, claimedScene: scene ? Number(scene[1]) : null, extracts });
      out.push(toCheck(verdict));
    } catch {
      out.push(unchecked(q, "This could not be checked: the check did not finish."));
    }
  }
  return out;
}

/** The pages that were really read this turn (never a search result that was only listed), as links the page may show. */
export function sourcesRead(session: ResearchSession | null): SourceNote[] {
  if (!session) return [];
  const notes: SourceNote[] = [];
  const seen = new Set<string>();
  for (const e of session.ledger) {
    if (!e.read || e.url.startsWith("user:")) continue;
    const safe = safeSource({ url: e.url, title: e.title, tier: e.tier });
    if (!safe || seen.has(safe.url)) continue;
    seen.add(safe.url);
    notes.push({ title: safe.title, host: safe.host || publicHost(e.url) || "", url: safe.url, tier: safe.tier });
    if (notes.length >= 6) break;
  }
  return notes;
}
