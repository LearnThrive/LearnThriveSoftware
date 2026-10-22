import { PDFDocument, StandardFonts } from "pdf-lib";
import type { ChatProvider, ProviderCapabilities, ProviderHealth, ProviderMessage, StreamChunk } from "@/lib/assistant/types";
import { solvePaper, extractQuestions } from "./paper";
import type { PaperLimits } from "./limits";
import { scoreAnswers, scoreExtraction, scorePlacement, scoreTranscription, type BenchCase, type CaseReport, type ExpectedQuestion } from "./bench";
import type { SolveDeps } from "./solve";

/**
 * Running the benchmark: synthetic cases that need no copyrighted paper, and the runner that takes any case (synthetic or a real paper the
 * owner has downloaded) through the real pipeline and scores it with bench.ts. The synthetic cases are NOT evidence about real papers: they
 * prove the harness works and pin the checker's known failure modes (a half solution set, a rounded decimal) so a change that lets one through
 * is caught. Real numbers come from external cases (docs/PAPER_BENCHMARK.md).
 */

interface Block {
  /** A line of printing. */
  line?: string;
  /** A question or part: its printed label, own text and marks; `answer` is the annotator's, `model` is what the stand-in model will say. */
  q?: { label: string; text: string; marks?: number; answer?: string; model?: string };
  /** Start a new page. */
  page?: true;
  /** Vertical space under this block, in points. */
  gap?: number;
}

export interface SyntheticCase {
  case: BenchCase;
  bytes: Uint8Array;
  /** What the stand-in model says to each question's own text. */
  model: Map<string, string>;
}

async function build(id: string, title: string, split: "dev" | "heldout", blocks: Block[], skippedPages: number[] = []): Promise<SyntheticCase> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]);
  let y = 790;
  const expected: ExpectedQuestion[] = [];
  const model = new Map<string, string>();
  for (const block of blocks) {
    if (block.page) {
      page = pdf.addPage([595, 842]);
      y = 790;
      continue;
    }
    const printed = block.line ?? (block.q ? `${/^\d+$/.test(block.q.label) ? `${block.q.label} ` : `${/\([a-z]+\)$/.exec(block.q.label)![0]} `}${block.q.text}${block.q.marks ? ` (${block.q.marks})` : ""}` : "");
    const gap = block.gap ?? (block.q ? 110 : 24);
    if (y - gap < 60) {
      page = pdf.addPage([595, 842]);
      y = 790;
    }
    page.drawText(printed, { x: 72, y, size: 12, font });
    if (block.q) {
      expected.push({ label: block.q.label, text: block.q.text, answer: block.q.answer, marks: block.q.marks ?? null });
      if (block.q.model !== undefined) model.set(block.q.text, block.q.model);
    }
    y -= gap;
  }
  const bytes = await pdf.save();
  return { case: { id, title, split, source: { kind: "synthetic" }, file: null, sha256: null, expected: { pages: pdf.getPageCount(), skippedPages, questions: expected } }, bytes, model };
}

export async function syntheticCases(): Promise<SyntheticCase[]> {
  const worksheet = await build("syn-worksheet", "A worksheet of whole questions the checker can decide", "dev", [
    { line: "Maths worksheet: number and algebra", gap: 36 },
    { q: { label: "1", text: "Solve 2x + 7 = 19", marks: 2, answer: "x = 6", model: "x = 6" } },
    { q: { label: "2", text: "Expand 3(x + 4)", marks: 2, answer: "3x + 12", model: "3x + 12" } },
    { q: { label: "3", text: "Work out 12 x 7", marks: 1, answer: "84", model: "84" } },
    { q: { label: "4", text: "Solve x^2 - 5x + 6 = 0", marks: 3, answer: "x = 2 or x = 3", model: "x = 3 or x = 2" } },
    { q: { label: "5", text: "Work out 5/6 + 1/6", marks: 1, answer: "1", model: "1" } },
    { q: { label: "6", text: "Find the size of angle ABC in the diagram", marks: 2, answer: "52", model: "52" } },
  ]);

  const gcse = await build(
    "syn-gcse-parts",
    "A GCSE-shaped paper: cover, parts, numerals, a stem, a question across a page, a formulae page and a blank page",
    "dev",
    [
      { line: "Pearson Edexcel GCSE Mathematics", gap: 30 },
      { line: "Candidate surname", gap: 20 },
      { line: "Centre number    Candidate number", gap: 20 },
      { line: "Time allowed: 1 hour 30 minutes", gap: 20 },
      { line: "Total marks 80", gap: 20 },
      { line: "Instructions", gap: 20 },
      { line: "Answer all questions.", gap: 20 },
      { page: true },
      { line: "Formulae", gap: 24 },
      { line: "Area of a trapezium = 1/2 (a + b) h", gap: 24 },
      { page: true },
      { line: "1 Sam buys 3 pens at 2 pounds each.", gap: 24 },
      { q: { label: "1(a)", text: "Work out the total cost.", marks: 2, answer: "6", model: "6" } },
      { q: { label: "1(b)", text: "Sam pays with a 10 pound note. Work out his change.", marks: 2, answer: "4", model: "4" } },
      { line: "2 Answer the following.", gap: 24 },
      { q: { label: "2(a)", text: "Solve 2x + 7 = 19", marks: 2, answer: "x = 6", model: "x = 6" } },
      { line: "(b) Expand each expression.", gap: 24 },
      { q: { label: "2(b)(i)", text: "Expand 3(x + 4)", marks: 1, answer: "3x + 12", model: "3x + 12" } },
      { q: { label: "2(b)(ii)", text: "Expand 2(x - 5)", marks: 1, answer: "2x - 10", model: "2x - 10" } },
      { q: { label: "3", text: "Work out 15 x 4", marks: 1, answer: "60", model: "60" } },
      { page: true },
      { line: "This page is intentionally left blank" },
    ],
    [1, 2, 4],
  );
  // The blank page is the last one; fix its number now the layout is known.
  gcse.case.expected.skippedPages = [1, 2, gcse.case.expected.pages ?? 0].filter((n) => n > 0);

  const long: Block[] = [];
  const expected: Array<{ label: string; a: number; b: number }> = [];
  for (let n = 1; n <= 120; n += 1) expected.push({ label: String(n), a: n + 10, b: (n % 9) + 2 });
  for (const e of expected) long.push({ q: { label: e.label, text: `Work out ${e.a} + ${e.b}`, marks: 1, answer: String(e.a + e.b), model: String(e.a + e.b) }, gap: 56 });
  const big = await build("syn-long-120", "A 120-question paper over many pages (capacity, order and memory)", "dev", long);

  const pitfalls = await build("syn-pitfalls", "Answers that satisfy a substitution check but are not the answer", "heldout", [
    { q: { label: "1", text: "Solve x^2 = 4", marks: 2, answer: "x = 2 or x = -2", model: "x = 2" } },
    { q: { label: "2", text: "Work out 5/6", marks: 1, answer: "5/6", model: "0.8333333333" } },
    { q: { label: "3", text: "Work out 2/3. Give your answer to 2 decimal places.", marks: 1, answer: "0.67", model: "0.66" } },
    { q: { label: "4", text: "Solve 2x + 7 = 19", marks: 2, answer: "x = 6", model: "x = 5" } },
    { q: { label: "5", text: "Solve x^2 - 5x + 6 = 0", marks: 3, answer: "x = 2 or x = 3", model: "x = 2" } },
    { q: { label: "6", text: "Expand 3(x + 4)", marks: 2, answer: "3x + 12", model: "3x + 4" } },
    { q: { label: "7", text: "Find the size of angle PQR in the diagram", marks: 2, answer: "40", model: "50" } },
  ]);

  return [worksheet, gcse, big, pitfalls];
}

/** A stand-in model that answers each question as the case says it should (including wrongly, on purpose): it tests the pipeline and the checker, not any real model. */
export function standInModel(says: ReadonlyMap<string, string>): ChatProvider {
  return {
    id: "stand-in",
    async capabilities(): Promise<ProviderCapabilities> {
      return { vision: false, jsonMode: true, toolUse: false, maxContext: 8192 };
    },
    async health(): Promise<ProviderHealth> {
      return { ok: true, detail: "ok" };
    },
    async *stream(messages: readonly ProviderMessage[]): AsyncGenerator<StreamChunk> {
      const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const asked = /<question>\s*([\s\S]*?)\s*<\/question>/.exec(last)?.[1] ?? "";
      const key = [...says.keys()].filter((own) => asked.includes(own)).sort((a, b) => b.length - a.length)[0];
      const answer = key === undefined ? "" : says.get(key)!;
      yield { type: "text", text: JSON.stringify({ transcription: asked, final_answer: answer, steps: [{ say: "Work it out", math: answer }], explanation: "", assumptions: [], confidence: "high", check: { kind: "none" } }) } as StreamChunk;
    },
  } as ChatProvider;
}

/** Takes one case through the real pipeline and scores it. `deps` null: extraction only (nothing is asked of a model). */
export async function runCase(c: BenchCase, bytes: Uint8Array, deps: SolveDeps | null, options: { solve: boolean; limits?: PaperLimits } = { solve: true }): Promise<CaseReport> {
  const started = Date.now();
  const document = await extractQuestions(deps, bytes, options.limits);
  if ("problem" in document) return { id: c.id, split: c.split, status: "not_run", reason: `the paper could not be read: ${document.problem}` };
  const report: CaseReport = { id: c.id, split: c.split, status: "run" };
  report.extraction = scoreExtraction(c.expected.questions, document.questions);
  report.transcription = scoreTranscription(c.expected.questions, document.questions);
  if (options.solve && deps) {
    const solved = await solvePaper(deps, document, { mode: "hybrid" });
    report.answers = scoreAnswers(c.expected.questions, solved.solved);
    report.placement = scorePlacement(solved.placements, document.pages);
  }
  report.seconds = (Date.now() - started) / 1000;
  return report;
}
