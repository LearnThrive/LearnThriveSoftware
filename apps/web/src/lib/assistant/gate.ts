import { checkEquations } from "./checks/chemistry";
import { claimEvidence, quoteEvidence, type EvidenceStatus } from "./checks/evidence";
import { checkWorkingLines } from "./checks/maths";
import { quoteKey } from "./exam/qa";
import { checkEventClaims, inventedCharacters, type EventClaim } from "./research/claims";
import { claimedSpeaker } from "./research/playText";
import { extractQuotations } from "./research/quotations";
import type { QuoteVerdict } from "./research/verify";
import type { StudyPrep } from "./study";

/**
 * The gate between a draft answer and the student. For answers where a wrong quotation or a made-up event does real harm (an essay to learn from, a
 * model answer, a quotation check), the draft is held, every quotation and checkable event in it is verified against what was read, and anything the
 * sources contradict or cannot support is repaired by the model (a bounded number of times) and then, if it is still there, cut out by the server.
 * The student reads the approved text, never the draft.
 *
 * A quotation or event that is merely unchecked because the evidence could not be fetched is NOT cut: it stays, and the "Check" under the answer says
 * it is unverified. What is removed is what the sources show to be wrong, or what they were searched for and did not contain.
 *
 * The same gate holds a hard maths or science answer while its working is checked by calculation (checks/maths.ts) and its chemical equations are
 * balanced (checks/chemistry.ts). A wrong step is sent back for repair like a wrong quotation, and checked again; one still wrong after the repairs
 * is FLAGGED under the answer, never cut, because removing a step of working would leave a solution that silently skips it.
 */
export interface Issue {
  kind: "quotation" | "event" | "character" | "calculation" | "equation";
  /** The exact words in the draft to repair or cut (a quotation, the sentence of a claim, or the line of working). */
  span: string;
  /** The sentence of the draft that holds it. */
  sentence: string;
  /** Why, in plain words. */
  problem: string;
  /** What the evidence says about it (checks/evidence.ts). Only CONTRADICTED or UNSUPPORTED reach the gate. */
  status: EvidenceStatus;
}

/** A sentence holding this may be cut if a repair does not fix it. A line of working is flagged instead. */
const cuttable = (issue: Issue): boolean => issue.kind === "quotation" || issue.kind === "event" || issue.kind === "character";

export interface GateResult {
  text: string;
  /** Rewrites asked of the model. */
  repairs: number;
  /** Sentences the server removed because they were still unsupported after the repairs. */
  removed: string[];
  /** Problems found in the first draft (what the student would have read without the gate). */
  firstDraft: Issue[];
  /** Lines of working or equations still wrong after the repairs: left in place and named under the answer. */
  flagged: Issue[];
  /** Lines of working and equations in the approved text that a calculation checked. */
  checked: number;
}

const BAD_QUOTE = new Set(["paraphrase_or_misquote", "unsupported", "incorrect_attribution"]);

export const sentencesWithOffsets = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

async function checkQuotations(prep: StudyPrep, text: string, deadline: number): Promise<Issue[]> {
  const session = prep.session;
  if (!session) return [];
  const issues: Issue[] = [];
  const sentences = sentencesWithOffsets(text);
  let looked = 0;
  for (const quotation of extractQuotations(text).slice(0, 8)) {
    const sentence = sentences.find((s) => s.includes(quotation)) ?? quotation;
    const speaker = claimedSpeaker(sentence, quotation);
    const key = `${quoteKey(quotation)}|${speaker ?? ""}`;
    let verdict: QuoteVerdict | undefined = prep.quoteChecks.get(key);
    if (!verdict) {
      if (Date.now() > deadline || looked >= 6) continue;
      looked += 1;
      try {
        verdict = await session.verifyQuotation({ quotation, work: prep.ctx.work, claimedSpeaker: speaker, extracts: prep.extracts });
      } catch {
        continue;
      }
      prep.quoteChecks.set(key, verdict);
    }
    prep.verdicts.set(quoteKey(quotation), verdict.status);
    if (BAD_QUOTE.has(verdict.status))
      issues.push({
        kind: "quotation",
        span: quotation,
        sentence,
        status: quoteEvidence(verdict.status),
        problem:
          verdict.status === "incorrect_attribution"
            ? verdict.note
            : verdict.status === "paraphrase_or_misquote"
              ? "something close is in the sources, but not these words, so it may be a misquotation or a paraphrase"
              : "these words were not found in the sources that were read",
      });
  }
  return issues;
}

const claimProblem = (c: EventClaim): string =>
  c.status === "contradicted" ? `the sources read say ${c.event} happens to ${c.actuallyBy.join(" or ")}, not to ${c.subject}` : `none of the sources read mention ${c.event} for ${c.subject}`;

async function checkEvents(prep: StudyPrep, text: string, deadline: number): Promise<Issue[]> {
  const session = prep.session;
  if (!session) return [];
  let evidence = [...session.pageTexts(), ...prep.extracts];
  // Without any page read there is nothing to check events against: that is "unverified", reported elsewhere, not "wrong".
  if (!evidence.length) return [];
  let claims = checkEventClaims(text, evidence, prep.question);
  let bad = claims.filter((c) => c.status !== "supported");
  // One targeted look for what the first pages did not cover, before anything is called unsupported.
  if (bad.length && Date.now() < deadline) {
    for (const c of bad.slice(0, 2)) {
      if (Date.now() > deadline) break;
      const found = await session.searchWeb(`${prep.ctx.work ?? prep.ctx.subjectLabel ?? ""} ${c.subject} ${c.event}`, "fact").catch(() => null);
      const top = found?.ranked.find((r) => r.tier !== "low" && !session.wasRead(r.url));
      if (top) await session.fetchPage(top.url).catch(() => null);
    }
    evidence = [...session.pageTexts(), ...prep.extracts];
    claims = checkEventClaims(text, evidence, prep.question);
    bad = claims.filter((c) => c.status !== "supported");
  }
  const issues: Issue[] = bad.map((c) => ({ kind: "event" as const, span: c.sentence, sentence: c.sentence, problem: claimProblem(c), status: claimEvidence(c.status) }));
  for (const name of inventedCharacters(text, evidence, prep.question)) {
    const sentence = sentencesWithOffsets(text).find((s) => s.includes(name)) ?? name;
    issues.push({ kind: "character", span: sentence, sentence, problem: `no source mentions a character called ${name}`, status: "UNSUPPORTED" });
  }
  return issues;
}

/** Working and equations, checked by calculation: no source and no model needed, so this runs whether or not research is available. */
export function checkCalculations(text: string): { issues: Issue[]; checked: number } {
  const working = checkWorkingLines(text);
  const equations = checkEquations(text);
  const issues: Issue[] = [
    ...working.findings.map((f) => ({ kind: "calculation" as const, span: f.line, sentence: f.line, problem: f.problem, status: f.status })),
    ...equations.findings.map((f) => ({ kind: "equation" as const, span: f.line, sentence: f.line, problem: f.problem, status: f.status })),
  ];
  return { issues, checked: working.checked + equations.checked };
}

export async function findIssues(prep: StudyPrep, text: string, deadline: number): Promise<Issue[]> {
  return [...(await checkQuotations(prep, text, deadline)), ...(await checkEvents(prep, text, deadline)), ...checkCalculations(text).issues];
}

export function repairInstruction(issues: readonly Issue[]): string {
  const lines = issues.slice(0, 8).map((i) =>
    i.kind === "quotation"
      ? `- The quotation "${i.span.slice(0, 160)}": ${i.problem}.`
      : i.kind === "calculation"
        ? `- The line of working "${i.span.slice(0, 160)}": ${i.problem}.`
        : i.kind === "equation"
          ? `- The equation "${i.span.slice(0, 160)}": ${i.problem}.`
          : `- "${i.sentence.slice(0, 220)}": ${i.problem}.`,
  );
  const sourced = issues.some((i) => cuttable(i));
  const worked = issues.some((i) => !cuttable(i));
  const what = sourced && worked ? "statements the sources do not support, and working that a calculation shows is wrong" : sourced ? "statements the sources do not support" : "working that a calculation shows is wrong";
  return `Your draft contains ${what}:
${lines.join("\n")}
Rewrite the whole answer. Keep everything that is correct, with the same structure and about the same length.${sourced ? " For each unsupported statement, either remove it, or replace it with something that appears in the research excerpts you were given. Do not add any new quotation, event or character that is not in those excerpts." : ""}${worked ? " For each wrong line of working or equation, correct it and every later step that depends on it, and make sure the final answer follows from the corrected working." : ""} Do not mention this correction in the answer.`;
}

/** Cuts every sentence that holds a still-unsupported span. Lines of working are never cut (they are flagged instead). */
export function redact(text: string, issues: readonly Issue[]): { text: string; removed: string[] } {
  const removed: string[] = [];
  const cut = issues.filter(cuttable);
  const parts = text.split(/(?<=[.!?])(\s+)/);
  const kept = parts.filter((part, index) => {
    if (index % 2 === 1) return true;
    const bad = cut.find((i) => part.includes(i.span) || (i.kind !== "quotation" && part.trim() === i.sentence.trim()));
    if (bad) removed.push(part.trim());
    return !bad;
  });
  return { text: kept.join("").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

export const NOTHING_LEFT = "I could not write an answer that I was able to check against the sources, so I would rather not give one. Please check the text yourself, or ask again with the passage or extract you are working from.";

export interface ReviewOptions {
  /** Asks the model for a corrected rewrite of the draft. Returns the draft unchanged if it cannot. */
  rewrite: (instruction: string, draft: string) => Promise<string>;
  maxRepairs?: number;
  deadlineMs?: number;
}

export async function reviewAnswer(prep: StudyPrep, draft: string, options: ReviewOptions): Promise<GateResult> {
  const deadline = Date.now() + (options.deadlineMs ?? 60_000);
  const maxRepairs = options.maxRepairs ?? 2;
  let text = draft;
  let repairs = 0;
  let issues: Issue[] = [];
  let firstDraft: Issue[] = [];
  for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
    issues = await findIssues(prep, text, deadline);
    if (attempt === 0) firstDraft = issues;
    if (!issues.length || attempt === maxRepairs || Date.now() > deadline) break;
    const rewritten = await options.rewrite(repairInstruction(issues), text);
    repairs += 1;
    if (!rewritten.trim() || rewritten === text) break;
    text = rewritten;
  }
  const checked = checkCalculations(text).checked;
  if (!issues.length) return { text, repairs, removed: [], firstDraft, flagged: [], checked };
  const flagged = issues.filter((i) => !cuttable(i));
  if (!issues.some(cuttable)) return { text, repairs, removed: [], firstDraft, flagged, checked };
  const cut = redact(text, issues);
  // If nothing supported is left, the student gets an honest limit, never the unsupported draft.
  return { text: cut.text || NOTHING_LEFT, repairs, removed: cut.removed, firstDraft, flagged, checked };
}
