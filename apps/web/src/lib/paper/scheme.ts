import type { PageReading } from "@/lib/assistant/documents";
import { readPdfDocument } from "@/lib/assistant/documents";
import { findQuestions, type PaperQuestion } from "./questions";

/**
 * An official mark scheme, read carefully or not at all. Two jobs:
 *
 *   1. Is it THIS paper's scheme? Paper code, tier, session and the question labels are compared. A contradiction ("1MA1/1H" against "1MA1/2H",
 *      Foundation against Higher, June against November) refuses the scheme; a scheme whose identity cannot be confirmed is "ambiguous" and
 *      is NOT used to award marks (the student is told, and may confirm it). Only a confirmed match is applied.
 *   2. What does it say? The marking criteria per question part: method (M), accuracy (A), independent (B), communication (C), process (P)
 *      marks, with their notes, dependencies ("dep"), follow-through ("ft") and "cao" (correct answer only). Every criterion keeps where it
 *      came from. A part whose criteria cannot be read is "unsupported" and goes to review: criteria are never invented to fill it.
 *
 * The layouts of the boards differ and pdf text is messy, so this reads defensively and says what it could not read.
 */
export interface PaperIdentity {
  /** "1MA1/1H" */
  code: string | null;
  tier: "foundation" | "higher" | null;
  /** "june 2023" */
  session: string | null;
}

const CODE = /\b(\d[A-Z]{2}\d|\d{4}|[A-Z]\d{3})\s*[/-]\s*(\d{1,2}[FH]?)\b/;
const SESSION = /\b(january|june|may|november|summer|autumn|winter|specimen|sample)\s*(?:series\s*)?(20\d\d)?\b/i;

/** Who a paper (or a scheme) says it is, from the words of its first pages. */
export function identityOf(pages: readonly Pick<PageReading, "text">[]): PaperIdentity {
  const text = pages.slice(0, 2).map((p) => p.text).join("\n");
  const code = CODE.exec(text);
  const upper = code ? `${code[1]}/${code[2]}`.toUpperCase().replace(/\s+/g, "") : null;
  const tierWord = /\bfoundation\b/i.test(text) ? "foundation" : /\bhigher\b/i.test(text) ? "higher" : null;
  const tierCode = upper ? (/[F]$/.test(upper) ? "foundation" : /H$/.test(upper) ? "higher" : null) : null;
  const tier = tierCode ?? tierWord;
  const session = SESSION.exec(text);
  // The paper says "2 June 2023" and its scheme "Summer 2023": the same series. Months are reduced to the season they sit in.
  const season: Record<string, string> = { january: "winter", winter: "winter", may: "summer", june: "summer", summer: "summer", november: "autumn", autumn: "autumn", specimen: "specimen", sample: "specimen" };
  return { code: upper, tier, session: session ? `${season[session[1]!.toLowerCase()]}${session[2] ? ` ${session[2]}` : ""}` : null };
}

export interface SchemeCriterion {
  /** "M1", "A1", "B2" ... */
  mark: string;
  kind: "M" | "A" | "B" | "C" | "P";
  marks: number;
  /** The scheme's own words for it. */
  text: string;
  dependent: boolean;
  followThrough: boolean;
  /** "correct answer only": decided by calculation, not by reading the working. */
  cao: boolean;
}

export interface SchemePart {
  label: string;
  criteria: SchemeCriterion[];
  /** The part's text as the scheme prints it (untrusted: it shapes feedback and criteria, nothing else). */
  text: string;
  /** Where it was read from, for traceability. */
  page: number;
  /** The scheme's total for the part. */
  total: number;
}

export interface Scheme {
  identity: PaperIdentity;
  parts: Map<string, SchemePart>;
  pages: number;
  /** Parts present in the scheme whose criteria could not be read. */
  unsupported: string[];
}

const TOKEN = /(?:^|[\s(,;])(dep\s+|ft\s+|sc\s*)?([MABCP])\s*([0-9])\b/g;

/** Criteria from the text of one question part of a scheme. */
export function criteriaOf(text: string): SchemeCriterion[] {
  const flat = text.replace(/\s+/g, " ");
  const found: Array<{ at: number; end: number; match: RegExpMatchArray }> = [];
  for (const m of flat.matchAll(TOKEN)) {
    // "SC1" (special case) is not a criterion this applies.
    if (/^sc/i.test(m[1] ?? "")) continue;
    found.push({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length, match: m });
  }
  return found.map((f, i) => {
    const following = flat.slice(f.end, found[i + 1]?.at ?? flat.length).trim().replace(/^for\s+/i, "for ").slice(0, 160);
    const lead = f.match[1]?.trim().toLowerCase() ?? "";
    const kind = f.match[2]!.toUpperCase() as SchemeCriterion["kind"];
    const marks = Number(f.match[3]);
    return {
      mark: `${kind}${marks}`,
      kind,
      marks,
      text: following,
      dependent: lead === "dep" || /\bdep\b/i.test(flat.slice(Math.max(0, f.at - 6), f.at + 6)),
      followThrough: lead === "ft" || /\bft\b|follow through|follow-through|ecf/i.test(following),
      cao: /\bcao\b|correct answer only/i.test(following),
    };
  });
}

/** Reads a mark scheme PDF into parts. Null when it cannot be opened or has no recognisable parts. */
export async function readScheme(bytes: Uint8Array): Promise<Scheme | null> {
  const reading = await readPdfDocument(bytes, { render: false, maxPages: 60 });
  if (!reading.ok) return null;
  const parts = findQuestions(reading.pages, [], { rows: true });
  if (parts.length === 0) return null;
  const out = new Map<string, SchemePart>();
  const unsupported: string[] = [];
  for (const p of parts) {
    const criteria = criteriaOf(p.text);
    if (criteria.length === 0) {
      unsupported.push(p.number);
      out.set(p.number, { label: p.number, criteria: [], text: p.text, page: p.page, total: 0 });
      continue;
    }
    out.set(p.number, { label: p.number, criteria, text: p.text, page: p.page, total: criteria.reduce((t, c) => t + c.marks, 0) });
  }
  return { identity: identityOf(reading.pages), parts: out, pages: reading.pageCount, unsupported };
}

export type SchemeVerdict =
  | { status: "match"; checked: string[] }
  | { status: "mismatch"; reasons: string[] }
  /** Nothing contradicts it, but it could not be confirmed as this paper's: not used to award marks. */
  | { status: "ambiguous"; reasons: string[] };

/**
 * Is this scheme for this paper? `paper` is the question paper's own identity and parts (the completed paper, or the blank one if it was given).
 * A contradiction refuses the scheme; a match needs the code, the tier and the session to agree AND the question parts to line up.
 */
export function matchScheme(paper: { identity: PaperIdentity; questions: readonly Pick<PaperQuestion, "number" | "marks">[] }, scheme: Scheme): SchemeVerdict {
  const contradictions: string[] = [];
  const unconfirmed: string[] = [];
  const checked: string[] = [];
  const compare = (name: string, a: string | null, b: string | null) => {
    if (a && b) {
      if (a === b) checked.push(name);
      else contradictions.push(`the ${name} differs (paper ${a}, scheme ${b})`);
    } else unconfirmed.push(`the ${name} could not be read from ${a ? "the scheme" : b ? "the paper" : "either"}`);
  };
  compare("paper code", paper.identity.code, scheme.identity.code);
  compare("tier", paper.identity.tier, scheme.identity.tier);
  compare("session", paper.identity.session, scheme.identity.session);

  const paperLabels = paper.questions.map((q) => q.number.toLowerCase());
  const inScheme = paperLabels.filter((l) => scheme.parts.has(l) || scheme.parts.has(l.replace(/\(([a-z]+)\)$/, "")));
  const coverage = paperLabels.length ? inScheme.length / paperLabels.length : 0;
  if (coverage < 0.6) contradictions.push(`the scheme covers only ${Math.round(coverage * 100)}% of this paper's questions`);
  else if (coverage < 0.95) unconfirmed.push(`the scheme covers ${Math.round(coverage * 100)}% of this paper's questions`);
  else checked.push("question labels");

  // Marks the paper prints against marks the scheme adds up to: a different allocation is a different paper.
  let compared = 0;
  let differing = 0;
  for (const q of paper.questions) {
    const part = scheme.parts.get(q.number.toLowerCase());
    if (!part || part.total === 0 || q.marks === null) continue;
    compared += 1;
    if (part.total !== q.marks) differing += 1;
  }
  if (compared >= 3) {
    if (differing / compared > 0.4) contradictions.push(`the marks differ on ${differing} of ${compared} questions`);
    else if (differing > 0) unconfirmed.push(`the marks differ on ${differing} of ${compared} questions`);
    else checked.push("marks");
  }
  if (contradictions.length) return { status: "mismatch", reasons: contradictions };
  const identityConfirmed = checked.includes("paper code") && checked.includes("tier") && checked.includes("session");
  if (identityConfirmed && unconfirmed.length === 0) return { status: "match", checked };
  return { status: "ambiguous", reasons: unconfirmed.length ? unconfirmed : ["its identity could not be confirmed"] };
}
