import { PDFDocument } from "pdf-lib";
import { readPdfDocument, renderPdfPages, type PageReading } from "@/lib/assistant/documents";
import { annotatePaper, type OutputMode, type Placement, type SolvedQuestion } from "./annotate";
import type { Assessment } from "./assess";
import { markQuestion, pageMissing, type MarkedQuestion, type Outcome } from "./mark";
import { markPaper } from "./markPdf";
import { paperLimits, type PaperLimits } from "./limits";
import { placeFromLayout, proposeLayout } from "./layout";
import { classifyPage, findQuestions, refineAnswerSpace, type PageKind, type PaperQuestion } from "./questions";
import { identityOf, matchScheme, readScheme, type Scheme, type SchemeVerdict } from "./scheme";
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
      const fresh = listed.filter((q) => !questions.some((existing) => existing.page === q.page && existing.number === q.number));
      questions.push(...fresh);
      // Where each scanned question's answer space is: proposed by the vision model, accepted only if the drawing of the page agrees.
      if (limits.scanLayout && fresh.length) {
        const proposals = await proposeLayout(deps, b64(picture.jpeg()));
        if (proposals) placeFromLayout(fresh, proposals, page, picture);
      }
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

/** The mark scheme the student gave, read, and what the check of it concluded: only a confirmed match is applied to award marks. */
export interface OfficialScheme {
  scheme: Scheme;
  verdict: SchemeVerdict;
}

/** Reads a mark scheme PDF and checks it against the paper's identity and question parts. `paper` is the blank question paper when one was given, else the completed one. */
export async function checkScheme(schemeBytes: Uint8Array, paper: { pages: readonly PageReading[]; questions: readonly PaperQuestion[] }): Promise<OfficialScheme | null> {
  const scheme = await readScheme(schemeBytes);
  if (!scheme) return null;
  return { scheme, verdict: matchScheme({ identity: identityOf(paper.pages), questions: paper.questions }, scheme) };
}

const schemeInfo = (official: OfficialScheme | null | undefined, unreadable: boolean): Assessment["scheme"] => {
  if (!official) return unreadable ? { status: "unreadable", note: "The mark scheme could not be read (it needs to be a PDF with its text in it), so it was not used." } : { status: "none", note: "" };
  const v = official.verdict;
  if (v.status === "match") return { status: "match", note: `Confirmed as this paper's scheme (${v.checked.join(", ")}).` };
  if (v.status === "mismatch") return { status: "mismatch", note: `This does not look like the scheme for this paper (${v.reasons.join("; ")}), so it was not used.` };
  return { status: "ambiguous", note: `I could not confirm this is the scheme for this paper (${v.reasons.join("; ")}), so I did not award marks from it. It was used as a guide for feedback only.` };
};

/** Does the page hold the question as clean text, so it can be solved without looking at the picture (and so without seeing the student's writing)? */
const textOnly = (page: PageReading | undefined, q: PaperQuestion) => Boolean(page && q.fromText && page.textQuality === "good" && !page.hasPictures && !page.stackedMaths);

/**
 * Marks the chosen questions of a completed paper. Every page the questions sit on is pictured, because the student's writing is not in the text layer.
 * The reference solution comes from the question alone where it can: the blank paper if the student gave one, else the printed text, else the picture of
 * the student's page with the handwriting to be ignored. Cancellable through deps.signal; progress is reported after each question like solving.
 */
export async function markCompleted(
  deps: SolveDeps,
  document: PaperDocument,
  options: {
    questionIds?: string[];
    /** The scheme's text per question number (feedback context only). */
    scheme?: Map<string, string> | null;
    /** A scheme read and checked against this paper: applied only if it matched. */
    official?: OfficialScheme | null;
    /** The blank question paper, if given. */
    blank?: PaperDocument | null;
    /** Marks are shown to the student (the release flag): only changes the feedback pages, not what is recorded. */
    showMarks?: boolean;
    onProgress?: (progress: Progress[]) => void;
    prior?: ReadonlyMap<string, MarkedQuestion>;
    onResult?: (result: MarkedQuestion) => void | Promise<void>;
  },
): Promise<MarkResult> {
  const chosen = document.questions.filter((q) => !options.questionIds || options.questionIds.includes(q.id));
  const prior = options.prior ?? new Map<string, MarkedQuestion>();
  const progress: Progress[] = chosen.map((q) => ({ questionId: q.id, state: "waiting" }));
  const report = () => options.onProgress?.(progress.map((p) => ({ ...p })));
  report();
  const todo = chosen.filter((q) => !prior.has(q.id));
  const pages = [...new Set(todo.map((q) => q.page))];
  const renders = pages.length ? await renderPdfPages(document.bytes, { scale: 1.6, pages }) : [];
  const pictures = new Map(renders.map((r) => [r.number, b64(r.jpeg())]));
  // The blank paper's pages that a reference needs a picture of (its question is not clean text), drawn once.
  const blankFor = (q: PaperQuestion) => options.blank?.questions.find((b) => b.number === q.number);
  const blankPages = [...new Set(todo.flatMap((q) => { const b = blankFor(q); const p = b && options.blank?.pages.find((x) => x.number === b.page); return b && !textOnly(p, b) ? [b.page] : []; }))];
  const blankPictures = new Map((options.blank && blankPages.length ? await renderPdfPages(options.blank.bytes, { scale: 1.6, pages: blankPages }) : []).map((r) => [r.number, b64(r.jpeg())]));
  const official = options.official ?? null;
  const info = schemeInfo(official, Boolean(options.scheme === null && !official));
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
    let result: MarkedQuestion;
    if (!picture) result = pageMissing(q, deps.model);
    else {
      const blank = blankFor(q);
      const page = document.pages.find((p) => p.number === q.page);
      const reference: NonNullable<Parameters<typeof markQuestion>[4]>["reference"] = blank
        ? { question: { ...blank, id: q.id, marks: q.marks ?? blank.marks }, picture: textOnly(options.blank?.pages.find((p) => p.number === blank.page), blank) ? null : (blankPictures.get(blank.page) ?? null), source: "blank_paper" }
        : textOnly(page, q)
          ? { picture: null, source: "printed_text" }
          : { picture, source: "marked_page" };
      const part = official?.verdict.status === "match" ? (official.scheme.parts.get(q.number.toLowerCase()) ?? null) : null;
      const guide = official?.scheme.parts.get(q.number.toLowerCase())?.text ?? options.scheme?.get(q.number) ?? null;
      result = await markQuestion(deps, q, picture, guide, { part, scheme: info, reference, model: deps.model });
    }
    marked.push(result);
    progress[i] = { questionId: q.id, state: "done", status: result.reference.status, outcome: result.outcome };
    await options.onResult?.(result);
    report();
  }
  const out = await markPaper(document.bytes, marked, { withScheme: official?.verdict.status === "match", showMarks: options.showMarks ?? true });
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
