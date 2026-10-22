import { PDFDocument } from "pdf-lib";
import { readPdfDocument, renderPdfPages, type PageReading } from "@/lib/assistant/documents";
import { annotatePaper, type OutputMode, type Placement, type SolvedQuestion } from "./annotate";
import { markQuestion, type MarkedQuestion, type Outcome } from "./mark";
import { markPaper } from "./markPdf";
import { paperLimits, type PaperLimits } from "./limits";
import { classifyPage, findQuestions, refineAnswerSpace, type PageKind, type PaperQuestion } from "./questions";
import { listQuestionsFromPicture, solveQuestion, type SolveDeps } from "./solve";

/**
 * The Paper Tutor pipeline, start to finish: read the document (the same reader Study Buddy uses), find the questions and their
 * answer space, solve and check each question, write the answers onto the paper, and check the result renders.
 *
 *   extract  a list of the questions found, so the student can choose which to solve (and see what was read)
 *   solve    the chosen questions (or all), one at a time through the shared generation queue, with progress after each
 *
 * A photo of a worksheet is wrapped in a one-page PDF first, so every document goes the same way. Pages without a text layer
 * (scans, photos) have their questions read by the vision model; their answers go on the worked-solution pages, never guessed onto
 * the picture.
 */
export interface PaperDocument {
  bytes: Uint8Array;
  pages: PageReading[];
  questions: PaperQuestion[];
  /** What a configured limit left out, said exactly (never silent). Null when everything was kept. */
  omitted: { questions: number; firstOmitted: string; limit: number } | null;
  /** Pages that hold no questions (the cover, a formulae sheet, a blank page): not searched, and said so. */
  skipped?: Array<{ page: number; kind: Exclude<PageKind, "questions"> }>;
}

/** A photo as a one-page PDF, the page the size of the photo at 72 dpi (scaled to fit A4 width at most). */
export async function photoToPdf(bytes: Uint8Array, contentType: "image/jpeg" | "image/png"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const image = contentType === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const scale = Math.min(1, 595.28 / image.width);
  const page = doc.addPage([image.width * scale, image.height * scale]);
  page.drawImage(image, { x: 0, y: 0, width: image.width * scale, height: image.height * scale });
  return doc.save();
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

/** Reads the document and finds its questions (asking the vision model about pages that have no text layer). */
export async function extractQuestions(deps: SolveDeps | null, bytes: Uint8Array, limits: PaperLimits = paperLimits()): Promise<PaperDocument | { problem: string }> {
  const reading = await readPdfDocument(bytes, { render: false, maxPages: limits.maxPages });
  if (!reading.ok) return { problem: reading.problem.message };
  const questions = findQuestions(reading.pages);
  const kinds = new Map(reading.pages.map((p, i) => [p.number, classifyPage(p, i === 0)] as const));
  // Pages are drawn a few at a time: each drawing measures the answer space of its questions (and, for a page with no text layer, is
  // shown to the vision model), then is dropped. Memory stays flat however long the paper is.
  const numbers = reading.pages.map((p) => p.number);
  for (let i = 0; i < numbers.length; i += limits.renderBatch) {
    const batch = await renderPdfPages(bytes, { scale: 1.5, pages: numbers.slice(i, i + limits.renderBatch) });
    for (const picture of batch) {
      const page = reading.pages.find((p) => p.number === picture.number)!;
      refineAnswerSpace(questions, reading.pages, picture);
      if (!deps || page.textQuality === "good" || kinds.get(page.number) !== "questions") continue;
      const listed = await listQuestionsFromPicture(deps, page.number, b64(picture.jpeg()));
      for (const q of listed) if (!questions.some((existing) => existing.page === q.page && existing.number === q.number)) questions.push(q);
    }
  }
  // Paper order: by page (a stable sort keeps the order found within a page). The ids are opaque and follow that order; the printed label is `number`.
  questions.sort((a, b) => a.page - b.page);
  questions.forEach((q, i) => {
    q.id = `q${i + 1}`;
  });
  const kept = questions.slice(0, limits.maxQuestions);
  const skipped = reading.pages.flatMap((p) => {
    const kind = kinds.get(p.number);
    return kind && kind !== "questions" ? [{ page: p.number, kind }] : [];
  });
  const dropped = questions.slice(limits.maxQuestions);
  return { bytes, pages: reading.pages, questions: kept, skipped, omitted: dropped.length ? { questions: dropped.length, firstOmitted: dropped[0]!.number, limit: limits.maxQuestions } : null };
}

export type Progress = { questionId: string; state: "waiting" | "solving" | "done"; status?: SolvedQuestion["status"]; outcome?: Outcome };

export interface PaperResult {
  pdf: Uint8Array;
  solved: SolvedQuestion[];
  placements: Placement[];
  workedPages: number[];
  pageCount: number;
}

/** Solves the chosen questions and writes the annotated PDF. Cancellable through deps.signal. */
export async function solvePaper(
  deps: SolveDeps,
  document: PaperDocument,
  options: { mode: OutputMode; questionIds?: string[]; onProgress?: (progress: Progress[]) => void; prior?: ReadonlyMap<string, SolvedQuestion>; onResult?: (result: SolvedQuestion) => void | Promise<void> },
): Promise<PaperResult> {
  const chosen = document.questions.filter((q) => !options.questionIds || options.questionIds.includes(q.id));
  // Questions finished by an earlier run of this job (its checkpoints) are kept, not redone.
  const prior = options.prior ?? new Map<string, SolvedQuestion>();
  const todo = chosen.filter((q) => !prior.has(q.id));
  const progress: Progress[] = chosen.map((q) => ({ questionId: q.id, state: "waiting" }));
  const report = () => options.onProgress?.(progress.map((p) => ({ ...p })));
  report();
  // A picture of the page goes with a question when its text cannot be trusted alone: a scan, a diagram, stacked maths.
  const todoPages = new Set(todo.map((q) => q.page));
  const pictureNeeded = new Set(document.pages.filter((p) => todoPages.has(p.number) && (p.textQuality !== "good" || p.hasPictures || p.stackedMaths)).map((p) => p.number));
  const renders = pictureNeeded.size ? await renderPdfPages(document.bytes, { scale: 1.6, pages: [...pictureNeeded] }) : [];
  const pictures = new Map(renders.map((r) => [r.number, b64(r.jpeg())]));
  const solved: SolvedQuestion[] = [];
  for (const [i, q] of chosen.entries()) {
    if (deps.signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "aborted" });
    const earlier = prior.get(q.id);
    if (earlier) {
      solved.push(earlier);
      progress[i] = { questionId: q.id, state: "done", status: earlier.status };
      continue;
    }
    progress[i]!.state = "solving";
    report();
    const result = await solveQuestion(deps, q, pictures.get(q.page) ?? null);
    solved.push(result);
    progress[i] = { questionId: q.id, state: "done", status: result.status };
    await options.onResult?.(result);
    report();
  }
  const out = await annotatePaper(document.bytes, solved, options.mode);
  // The output must open and render, with the pages it should have: the paper's pages and then the worked ones.
  const check = await readPdfDocument(out.pdf, { render: false, maxPages: 60 });
  if (!check.ok) throw new Error("the annotated PDF does not open");
  return { pdf: out.pdf, solved, placements: out.placements, workedPages: out.workedPages, pageCount: check.pageCount };
}

export interface MarkResult {
  pdf: Uint8Array;
  marked: MarkedQuestion[];
  feedbackPages: number[];
  pageCount: number;
}

/** The text of a mark scheme PDF, split by question number (untrusted: it only ever shapes feedback). Null if it cannot be read. */
export async function readMarkScheme(bytes: Uint8Array): Promise<Map<string, string> | null> {
  const reading = await readPdfDocument(bytes, { render: false, maxPages: 20 });
  if (!reading.ok) return null;
  const parts = findQuestions(reading.pages);
  return parts.length ? new Map(parts.map((q) => [q.number, q.text])) : null;
}

/**
 * Marks the chosen questions of a completed paper. Every page the questions sit on is pictured, because the student's writing is
 * not in the text layer. Cancellable through deps.signal; progress is reported after each question like solving.
 */
export async function markCompleted(
  deps: SolveDeps,
  document: PaperDocument,
  options: { questionIds?: string[]; scheme?: Map<string, string> | null; onProgress?: (progress: Progress[]) => void; prior?: ReadonlyMap<string, MarkedQuestion>; onResult?: (result: MarkedQuestion) => void | Promise<void> },
): Promise<MarkResult> {
  const chosen = document.questions.filter((q) => !options.questionIds || options.questionIds.includes(q.id));
  const prior = options.prior ?? new Map<string, MarkedQuestion>();
  const progress: Progress[] = chosen.map((q) => ({ questionId: q.id, state: "waiting" }));
  const report = () => options.onProgress?.(progress.map((p) => ({ ...p })));
  report();
  const pages = [...new Set(chosen.filter((q) => !prior.has(q.id)).map((q) => q.page))];
  const renders = pages.length ? await renderPdfPages(document.bytes, { scale: 1.6, pages }) : [];
  const pictures = new Map(renders.map((r) => [r.number, b64(r.jpeg())]));
  const marked: MarkedQuestion[] = [];
  for (const [i, q] of chosen.entries()) {
    if (deps.signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "aborted" });
    const earlier = prior.get(q.id);
    if (earlier) {
      marked.push(earlier);
      progress[i] = { questionId: q.id, state: "done", status: earlier.reference.status, outcome: earlier.outcome };
      continue;
    }
    progress[i]!.state = "solving";
    report();
    const picture = pictures.get(q.page);
    // No picture of the page (rendering failed): nothing to read, so the question is left for the student to check, never marked.
    const result: MarkedQuestion = picture
      ? await markQuestion(deps, q, picture, options.scheme?.get(q.number) ?? null)
      : { ...q, student: { answer: "", working: [], legibility: "low", blank: false }, reference: { finalAnswer: "", steps: [], status: "unsolved", statusNote: "", explanation: "" }, outcome: "needs_checking", reason: "I could not look at this page, so I have not marked it.", feedback: "", estimate: null, outOf: q.marks, usedScheme: false };
    marked.push(result);
    progress[i] = { questionId: q.id, state: "done", status: result.reference.status, outcome: result.outcome };
    await options.onResult?.(result);
    report();
  }
  const out = await markPaper(document.bytes, marked, { withScheme: Boolean(options.scheme) });
  const check = await readPdfDocument(out.pdf, { render: false, maxPages: 60 });
  if (!check.ok) throw new Error("the marked PDF does not open");
  return { pdf: out.pdf, marked, feedbackPages: out.feedbackPages, pageCount: check.pageCount };
}

/** The solutions as Markdown for the chat, so the student can ask about any question afterwards without solving the paper again. */
export function solutionsMarkdown(solved: SolvedQuestion[]): string {
  const label: Record<SolvedQuestion["status"], string> = {
    verified: "checked by calculation",
    checked_reading: "checked by calculation, against my reading of the question",
    unchecked: "not checked by calculation",
    failed: "not confidently solved: the check did not agree",
    unsolved: "not confidently solved",
  };
  const lines = ["I have worked through the paper. The annotated PDF has the working; here is a summary. These are AI-generated and may contain mistakes, so check any marked as not confidently solved.", ""];
  for (const q of solved) {
    lines.push(`**Question ${q.number}** (${label[q.status]})${q.finalAnswer ? `: $${q.finalAnswer}$` : ""}`);
    for (const step of q.steps.slice(0, 6)) lines.push(`- ${step.say ?? ""}${step.math ? ` $${step.math}$` : ""}`.trim());
    lines.push("");
  }
  lines.push("Ask me about any question for a hint, a different method or a similar one to practise.");
  return lines.join("\n");
}
