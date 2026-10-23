import type { PaperQuestion, QuestionContext } from "./questions";
import { parseLabel } from "./questionTree";

/**
 * Carrying a question's context from one upload to the next, in the same chat.
 *
 * A student uploads 3(a), gets its answer, then uploads 3(b): the second picture holds only the part, not the shared words, the diagram or
 * what part (a) worked out. This links the new part to the earlier upload it belongs to, so the solver is given the shared question, the
 * original page with its diagram, and the earlier parts' results as claims to re-check.
 *
 * Linking is conservative, because a wrong link is worse than none. A part is linked only when:
 *   - it arrives WITHOUT its own shared words (a page that has them is its own question, even if its number matches another),
 *   - the earlier question is in the SAME chat and the same owner (the caller only supplies those jobs),
 *   - exactly ONE earlier group with that question number has shared words.
 * Several earlier groups with that number (two papers' Q3 in one chat) is ambiguous: nothing is merged and the student is asked. No earlier
 * group at all is "missing": nothing is invented, and the solver is told the facts were not provided.
 */
export interface EarlierQuestion {
  id: string;
  number: string;
  page: number;
  /** The shared words of its question, as read when it was uploaded. */
  stem?: string;
}

export interface EarlierJob {
  id: string;
  fileId: string;
  questions: readonly EarlierQuestion[];
  /** The finished results by question id (a solved question: its answer, status and steps). Unfinished jobs have none. */
  checkpoints: Readonly<Record<string, unknown>>;
}

export type Link = { kind: "linked"; context: QuestionContext } | { kind: "ambiguous"; groups: number } | { kind: "missing" } | { kind: "none" };

const wordsOf = (text: string): Set<string> => new Set(text.toLowerCase().replace(/[^a-z0-9.]+/g, " ").split(" ").filter(Boolean));

/** Are these two readings of a question's shared words the same words? A model reads the same page a little differently each time, so "the same" is a high overlap, not equality. */
export function sameWords(a: string, b: string): boolean {
  const x = wordsOf(a);
  const y = wordsOf(b);
  if (x.size === 0 || y.size === 0) return false;
  let both = 0;
  for (const word of x) if (y.has(word)) both += 1;
  return both / (x.size + y.size - both) >= 0.75;
}

/** A part that arrives without the words its question shares with its siblings. */
export function arrivesWithoutContext(q: PaperQuestion): boolean {
  const label = parseLabel(q.number);
  return Boolean(label && label.parts.length > 0 && !(q.stem ?? "").trim() && !(q.groupStem ?? "").trim());
}

interface SavedResult {
  finalAnswer?: string;
  status?: string;
  steps?: Array<{ say?: string; math?: string }>;
  conclusion?: string;
  comparison?: { have: string; need: string };
}

const asResult = (value: unknown): SavedResult | null => (value && typeof value === "object" ? (value as SavedResult) : null);

/** A result that is an answer: it has one, and it was not a failed or unsolved attempt. A later attempt that is not an answer does not replace an earlier one that was. */
const isAnswer = (result: SavedResult | null): result is SavedResult => Boolean(result && (result.finalAnswer ?? "").trim() && result.status !== "failed" && result.status !== "unsolved" && result.status !== "partial");

interface Member {
  job: EarlierJob;
  question: EarlierQuestion;
}

/**
 * The context of one group of earlier uploads of a question, oldest first. For each part the ACTIVE answer is its latest revision that is an answer, with the
 * upload and the revision number it came from; the revisions it replaced are kept in the history. Nothing is ever dropped, but only the active answers are
 * shown to the solver and used by the checks, so a correction cannot be overridden by the answer it corrected.
 */
function contextOf(base: string, members: readonly Member[]): QuestionContext {
  const byLabel = new Map<string, Array<{ member: Member; result: SavedResult | null; version: number }>>();
  for (const member of members) {
    const list = byLabel.get(member.question.number) ?? [];
    list.push({ member, result: asResult(member.job.checkpoints[member.question.id]), version: list.length + 1 });
    byLabel.set(member.question.number, list);
  }
  const earlier: QuestionContext["earlier"] = [];
  const history: QuestionContext["history"] = [];
  for (const [number, revisions] of byLabel) {
    const answers = revisions.filter((r) => isAnswer(r.result));
    const active = answers.at(-1);
    for (const r of answers) {
      if (r === active) continue;
      history.push({ number, version: r.version, answer: r.result!.finalAnswer ?? "", status: r.result!.status ?? "unchecked", source: { jobId: r.member.job.id, questionId: r.member.question.id } });
    }
    if (!active) continue;
    const result = active.result!;
    // Each line with the words that say what it is ("Floor area: 80 - 12 = 68 m^2"), so a figure can be found and reused by what it is.
    const lines = (result.steps ?? []).map((step) => [step.say, step.math].filter(Boolean).join(": ")).filter(Boolean);
    if (result.conclusion) lines.push(result.conclusion);
    earlier.push({ number, answer: result.finalAnswer ?? "", status: result.status ?? "unchecked", steps: lines.slice(0, 12), ...(result.comparison ? { comparison: result.comparison } : {}), version: active.version, source: { jobId: active.member.job.id, questionId: active.member.question.id } });
  }
  // The latest upload of the group is the source of the picture.
  const source = members[members.length - 1]!;
  return { fromJobId: source.job.id, fromFileId: source.job.fileId, page: source.question.page, group: base, stem: (source.question.stem ?? "").trim(), earlier, history };
}

/** The earlier uploads of one question (its number and shared words), grouped by those words, oldest first. */
function groupsFor(base: string, earlier: readonly EarlierJob[]): Member[][] {
  const groups: Array<{ stem: string; members: Member[] }> = [];
  for (const job of earlier) {
    for (const question of job.questions) {
      const label = parseLabel(question.number);
      const stem = (question.stem ?? "").trim();
      if (!label || label.number !== base || !stem) continue;
      const group = groups.find((g) => sameWords(g.stem, stem));
      if (group) group.members.push({ job, question });
      else groups.push({ stem, members: [{ job, question }] });
    }
  }
  return groups.map((g) => g.members);
}

/** How each new question relates to the earlier uploads of the chat. */
export function linkContext(questions: readonly PaperQuestion[], earlier: readonly EarlierJob[]): Map<string, Link> {
  const links = new Map<string, Link>();
  for (const q of questions) {
    if (!arrivesWithoutContext(q)) {
      links.set(q.id, { kind: "none" });
      continue;
    }
    const base = parseLabel(q.number)!.number;
    const groups = groupsFor(base, earlier);
    if (groups.length === 0) links.set(q.id, { kind: "missing" });
    else if (groups.length > 1) links.set(q.id, { kind: "ambiguous", groups: groups.length });
    else links.set(q.id, { kind: "linked", context: contextOf(base, groups[0]!) });
  }
  return links;
}

/**
 * A saved link, brought up to date: the same question, its answers as they stand NOW. A correction made after the link was saved (or while the part
 * waited to be solved, or in another process) replaces the answer it corrected. With nothing to refresh from, the saved link stands.
 */
export function refreshContext(context: QuestionContext, earlier: readonly EarlierJob[]): QuestionContext {
  const group = groupsFor(context.group, earlier).find((members) => sameWords(members[0]!.question.stem ?? "", context.stem));
  return group ? contextOf(context.group, group) : context;
}

/** Which answers a context rests on (upload, part and revision), so a result solved on an older answer can be told from one solved on the current one. */
export function contextKey(context: QuestionContext): string {
  return context.earlier.map((e) => `${e.source.jobId}:${e.source.questionId}:${e.version}`).sort().join("|");
}
