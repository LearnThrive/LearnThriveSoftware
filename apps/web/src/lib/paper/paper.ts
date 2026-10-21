import { PDFDocument } from "pdf-lib";
import { readPdfDocument, renderPdfPages, type PageReading } from "@/lib/assistant/documents";
import { annotatePaper, type OutputMode, type Placement, type SolvedQuestion } from "./annotate";
import { findQuestions, type PaperQuestion } from "./questions";
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
}

const MAX_QUESTIONS = 30;

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
export async function extractQuestions(deps: SolveDeps | null, bytes: Uint8Array): Promise<PaperDocument | { problem: string }> {
  const reading = await readPdfDocument(bytes, { render: false, maxPages: 20 });
  if (!reading.ok) return { problem: reading.problem.message };
  const renders = await renderPdfPages(bytes, { scale: 1.5 });
  const questions = findQuestions(reading.pages, renders);
  if (deps) {
    for (const page of reading.pages) {
      if (page.textQuality === "good") continue;
      const picture = renders.find((r) => r.number === page.number);
      if (!picture) continue;
      const listed = await listQuestionsFromPicture(deps, page.number, b64(picture.jpeg()));
      for (const q of listed) if (!questions.some((existing) => existing.id === q.id)) questions.push(q);
    }
  }
  questions.sort((a, b) => a.page - b.page || Number(a.number) - Number(b.number));
  return { bytes, pages: reading.pages, questions: questions.slice(0, MAX_QUESTIONS) };
}

export type Progress = { questionId: string; state: "waiting" | "solving" | "done"; status?: SolvedQuestion["status"] };

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
  options: { mode: OutputMode; questionIds?: string[]; onProgress?: (progress: Progress[]) => void },
): Promise<PaperResult> {
  const chosen = document.questions.filter((q) => !options.questionIds || options.questionIds.includes(q.id));
  const progress: Progress[] = chosen.map((q) => ({ questionId: q.id, state: "waiting" }));
  const report = () => options.onProgress?.(progress.map((p) => ({ ...p })));
  report();
  // A picture of the page goes with a question when its text cannot be trusted alone: a scan, a diagram, stacked maths.
  const pictureNeeded = new Set(document.pages.filter((p) => p.textQuality !== "good" || p.hasPictures || p.stackedMaths).map((p) => p.number));
  const renders = pictureNeeded.size ? await renderPdfPages(document.bytes, { scale: 1.6, pages: [...pictureNeeded] }) : [];
  const pictures = new Map(renders.map((r) => [r.number, b64(r.jpeg())]));
  const solved: SolvedQuestion[] = [];
  for (const [i, q] of chosen.entries()) {
    if (deps.signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "aborted" });
    progress[i]!.state = "solving";
    report();
    const result = await solveQuestion(deps, q, pictures.get(q.page) ?? null);
    solved.push(result);
    progress[i] = { questionId: q.id, state: "done", status: result.status };
    report();
  }
  const out = await annotatePaper(document.bytes, solved, options.mode);
  // The output must open and render, with the pages it should have: the paper's pages and then the worked ones.
  const check = await readPdfDocument(out.pdf, { render: false, maxPages: 60 });
  if (!check.ok) throw new Error("the annotated PDF does not open");
  return { pdf: out.pdf, solved, placements: out.placements, workedPages: out.workedPages, pageCount: check.pageCount };
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
