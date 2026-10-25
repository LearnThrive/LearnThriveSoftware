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
 */
export interface Issue {
  kind: "quotation" | "event" | "character";
  /** The exact words in the draft to repair or cut (a quotation, or the sentence of a claim). */
  span: string;
  /** The sentence of the draft that holds it. */
  sentence: string;
  /** Why, in plain words. */
  problem: string;
}

export interface GateResult {
  text: string;
  /** Rewrites asked of the model. */
  repairs: number;
  /** Sentences the server removed because they were still unsupported after the repairs. */
  removed: string[];
  /** Problems found in the first draft (what the student would have read without the gate). */
  firstDraft: Issue[];
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
  const issues: Issue[] = bad.map((c) => ({ kind: "event" as const, span: c.sentence, sentence: c.sentence, problem: claimProblem(c) }));
  for (const name of inventedCharacters(text, evidence, prep.question)) {
    const sentence = sentencesWithOffsets(text).find((s) => s.includes(name)) ?? name;
    issues.push({ kind: "character", span: sentence, sentence, problem: `no source mentions a character called ${name}` });
  }
  return issues;
}

export async function findIssues(prep: StudyPrep, text: string, deadline: number): Promise<Issue[]> {
  return [...(await checkQuotations(prep, text, deadline)), ...(await checkEvents(prep, text, deadline))];
}

export function repairInstruction(issues: readonly Issue[]): string {
  const lines = issues.slice(0, 8).map((i) => (i.kind === "quotation" ? `- The quotation "${i.span.slice(0, 160)}": ${i.problem}.` : `- "${i.sentence.slice(0, 220)}": ${i.problem}.`));
  return `Your draft contains statements the sources do not support:
${lines.join("\n")}
Rewrite the whole answer. Keep everything that is supported, with the same structure and about the same length. For each problem above, either remove it, or replace it with something that appears in the research excerpts you were given. Do not add any new quotation, event or character that is not in those excerpts. Do not mention this correction in the answer.`;
}

/** Cuts every sentence that holds a still-unsupported span. */
export function redact(text: string, issues: readonly Issue[]): { text: string; removed: string[] } {
  const removed: string[] = [];
  const parts = text.split(/(?<=[.!?])(\s+)/);
  const kept = parts.filter((part, index) => {
    if (index % 2 === 1) return true;
    const bad = issues.find((i) => part.includes(i.span) || (i.kind !== "quotation" && part.trim() === i.sentence.trim()));
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
  if (!issues.length) return { text, repairs, removed: [], firstDraft };
  const cut = redact(text, issues);
  // If nothing supported is left, the student gets an honest limit, never the unsupported draft.
  return { text: cut.text || NOTHING_LEFT, repairs, removed: cut.removed, firstDraft };
}
