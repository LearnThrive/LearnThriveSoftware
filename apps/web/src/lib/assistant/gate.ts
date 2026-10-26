import type { ActivityLog } from "./activity";
import { checkEquations } from "./checks/chemistry";
import { claimEvidence, quoteEvidence, type EvidenceStatus } from "./checks/evidence";
import { checkWorkingLines } from "./checks/maths";
import { quoteKey } from "./exam/qa";
import { parseCitations, type ParsedCitation } from "./research/citations";
import { checkEventClaims, inventedCharacters, type EventClaim } from "./research/claims";
import { acceptSupports, type RecallClaim, type RecallPassage } from "./research/entail";
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

/** Why a quotation failed, in plain words. One wording for every route to the same verdict (searched for, or checked against a cited source). */
const quoteProblem = (verdict: QuoteVerdict): string =>
  verdict.status === "incorrect_attribution" ? verdict.note : verdict.status === "paraphrase_or_misquote" ? "something close is in the sources, but not these words, so it may be a misquotation or a paraphrase" : "these words were not found in the sources that were read";

export const sentencesWithOffsets = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

async function checkQuotations(prep: StudyPrep, text: string, deadline: number, citations: readonly ParsedCitation[] = []): Promise<Issue[]> {
  const session = prep.session;
  if (!session) return [];
  const issues: Issue[] = [];
  const sentences = sentencesWithOffsets(text);
  const handled = new Set<string>();
  let looked = 0;

  // The reply's own citations go first. A marker names the source, so those words are checked against THAT page (already read this turn) and usually need no
  // search at all — which is what makes a long answer's later quotations checkable within the same budget. The number is the model's claim about where the
  // words came from; a number the server never listed is reported rather than followed.
  for (const citation of citations) {
    const quotation = citation.quotation;
    if (!quotation) continue;
    const sentence = sentences.find((s) => s.includes(quotation)) ?? citation.sentence;
    const source = prep.grounding?.sources[citation.number - 1] ?? null;
    if (!source) {
      handled.add(quotation);
      issues.push({ kind: "quotation", span: quotation, sentence, status: "UNSUPPORTED", problem: `it is attributed to source ${citation.number}, which was not one of the sources given` });
      continue;
    }
    const speaker = claimedSpeaker(sentence, quotation);
    const key = `${quoteKey(quotation)}|${speaker ?? ""}|${source.url}`;
    let verdict: QuoteVerdict | undefined = prep.quoteChecks.get(key);
    if (!verdict) {
      if (Date.now() > deadline || looked >= 6) continue;
      looked += 1;
      try {
        verdict = await session.verifyQuotation({ quotation, work: prep.ctx.work, claimedSpeaker: speaker, extracts: prep.extracts, sourceUrl: source.url });
      } catch {
        continue;
      }
      prep.quoteChecks.set(key, verdict);
    }
    handled.add(quotation);
    prep.verdicts.set(quoteKey(quotation), verdict.status);
    if (BAD_QUOTE.has(verdict.status)) issues.push({ kind: "quotation", span: quotation, sentence, status: quoteEvidence(verdict.status), problem: quoteProblem(verdict!) });
  }

  // Quotations without a marker: unchanged. The words are looked for in the pages already read, then on the web, and judged by what was found there.
  for (const quotation of extractQuotations(text).slice(0, 8)) {
    if (handled.has(quotation)) continue;
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
    if (BAD_QUOTE.has(verdict.status)) issues.push({ kind: "quotation", span: quotation, sentence, status: quoteEvidence(verdict.status), problem: quoteProblem(verdict) });
  }
  return issues;
}

/**
 * Asks the recall stage where in the pages read a claim IS settled (research/entail.ts), and keeps only what the code can stand behind: a span that really
 * appears in the page it names, about the claim's own character. Only "supports" is acted on here — a claim the sources contradict is already an issue, and
 * a claim that was supported must not become a problem because a model read the pages differently. Returns the promoted claims, keyed as the check keys them.
 */
async function recallSupports(prep: StudyPrep, claims: readonly EventClaim[]): Promise<Set<string>> {
  const session = prep.session;
  const recall = session?.recall ?? null;
  if (!session || !recall || !claims.length) return new Set();
  const pages = session.pagesRead().slice(0, 3);
  if (!pages.length) return new Set();
  const passages: RecallPassage[] = pages.map((page, i) => ({ id: `p${i + 1}`, label: page.title, text: page.text }));
  const wanted: RecallClaim[] = claims.slice(0, 4).map((claim, i) => ({ id: `c${i + 1}`, subject: claim.subject, event: claim.event, sentence: claim.sentence }));
  let proposals;
  try {
    proposals = await recall.findSupport({ claims: wanted, passages });
  } catch {
    return new Set();
  }
  const accepted = acceptSupports(proposals, wanted, passages);
  const byId = new Map(wanted.map((claim) => [claim.id, claim]));
  const promoted = new Set<string>();
  for (const support of accepted) {
    const claim = byId.get(support.claim);
    if (claim && support.relation === "supports") promoted.add(`${claim.subject}|${claim.event}`);
  }
  return promoted;
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
  // Then the recall stage (research/entail.ts). The exact check reads the pages with a short list of event patterns, and cannot see "Eric is dismissed from
  // the works" as the claim "Eric is sent to prison": a page that says it in other words leaves the claim looking unsupported, which is actionable, so the
  // gate would repair or cut a sentence the sources do support. The stage is asked where the statement IS settled, by meaning.
  const unsupported = bad.filter((c) => c.status === "unsupported");
  if (unsupported.length && Date.now() < deadline) {
    const promoted = await recallSupports(prep, unsupported);
    if (promoted.size) bad = bad.filter((c) => !promoted.has(`${c.subject}|${c.event}`));
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

/**
 * The events-and-characters check reads a draft as a story ("X marries Y", "a woman called Z"). It is run where that is what the answer is about: a set
 * text, or a period of history. A held answer in another subject (a biology explanation, a geography case study) is checked for its quotations and its
 * working, and its names against the pages read (finishStudy), but no sentence of it is cut by a check written for narratives.
 */
const NARRATIVE: ReadonlySet<string> = new Set(["english_literature", "history"]);
export const isNarrative = (subject: string | null | undefined): boolean => NARRATIVE.has(subject ?? "");

export async function findIssues(prep: StudyPrep, text: string, deadline: number, citations: readonly ParsedCitation[] = []): Promise<Issue[]> {
  const events = isNarrative(prep.ctx.subject) ? await checkEvents(prep, text, deadline) : [];
  return [...(await checkQuotations(prep, text, deadline, citations)), ...events, ...checkCalculations(text).issues];
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

/** What a student sees when the checking of a held draft could not finish: never the draft. */
export const UNCHECKED_WITHHELD = "I could not finish checking this answer against the sources, so I am not showing it rather than risk giving you something wrong. Please ask again in a moment.";

export interface ReviewOptions {
  /** Asks the model for a corrected rewrite of the draft. Returns the draft unchanged if it cannot. */
  rewrite: (instruction: string, draft: string) => Promise<string>;
  maxRepairs?: number;
  deadlineMs?: number;
  /** The turn's activity log: the checks and repairs below are recorded in it as they happen. */
  activity?: ActivityLog;
}

export async function reviewAnswer(prep: StudyPrep, draft: string, options: ReviewOptions): Promise<GateResult> {
  const deadline = Date.now() + (options.deadlineMs ?? 60_000);
  const maxRepairs = options.maxRepairs ?? 2;
  let text = draft;
  let repairs = 0;
  let issues: Issue[] = [];
  let firstDraft: Issue[] = [];
  const log = options.activity;
  // What the draft contains decides which checks are real work for this answer: only those are shown.
  const hasQuotes = extractQuotations(draft).length > 0;
  const hasWorking = checkCalculations(draft).checked > 0;
  // The label names the checks that really run: facts (events and characters) only for a set text or history, quotations wherever there are any.
  const factsChecked = Boolean(prep.session && prep.willGround && isNarrative(prep.ctx.subject));
  const verifying = log && (hasQuotes || factsChecked) ? log.start("verify", factsChecked ? "Checking quotations and facts against the sources" : "Checking the quotations against the sources") : null;
  const calculating = log && hasWorking ? log.start("calculate", "Checking the working by calculation") : null;
  let repairStep: string | null = null;
  for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
    // The reply's citation markers (research/citations.ts) are read and removed in the same step: the checks below need to know WHICH source a quotation was
    // attributed to, and the student never sees a marker. A repair that writes them again is handled the same way on the next pass.
    const parsed = parseCitations(text);
    text = parsed.text;
    issues = await findIssues(prep, text, deadline, parsed.citations);
    if (attempt === 0) {
      firstDraft = issues;
      const unsupported = issues.filter(cuttable).length;
      if (verifying) {
        // "Supported" is only said when there was something to be supported BY. With no page read, or a quotation that could not be looked up,
        // the step says so instead of reporting a clean check.
        const nothingRead = Boolean(prep.willGround) && (prep.session?.pageTexts().length ?? 0) === 0;
        const unchecked = [...prep.quoteChecks.values()].filter((v) => v.status === "unverifiable").length;
        if (nothingRead) log?.fail(verifying, "no sources could be read, so nothing could be confirmed");
        else log?.done(verifying, { detail: unsupported ? `${unsupported} statement${unsupported === 1 ? "" : "s"} not supported by the sources` : unchecked ? `${unchecked} quotation${unchecked === 1 ? "" : "s"} could not be looked up; the rest was supported` : "everything checked was supported" });
      }
      if (calculating) log?.done(calculating, { detail: issues.some((i) => !cuttable(i)) ? "a step did not add up" : "every step checked out" });
    }
    if (!issues.length || attempt === maxRepairs || Date.now() > deadline) {
      if (repairStep) log?.done(repairStep, { detail: issues.length ? "some statements could not be fixed" : "checked again and correct" });
      break;
    }
    if (!repairStep && log) repairStep = log.start("repair", "Correcting the draft before showing it");
    const rewritten = await options.rewrite(repairInstruction(issues), text);
    repairs += 1;
    if (!rewritten.trim() || rewritten === text) {
      if (repairStep) log?.done(repairStep, { detail: "the correction did not change anything" });
      break;
    }
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
