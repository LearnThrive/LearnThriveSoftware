import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { loadTsFrom } from "./_tsLoader.mjs";

// Two scenarios of the Paper Tutor that need a document built for them: a paper whose answer spaces are far too small, and a
// question the model cannot read. Built in memory with pdf-lib so the fixtures are visible here, not binary files.

const docs = loadTsFrom(import.meta.url, "../src/lib/assistant/documents.ts");
const { extractQuestions } = loadTsFrom(import.meta.url, "../src/lib/paper/paper.ts");
const { annotatePaper } = loadTsFrom(import.meta.url, "../src/lib/paper/annotate.ts");
const { solveQuestion } = loadTsFrom(import.meta.url, "../src/lib/paper/solve.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");

async function paper(lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  for (const [text, y] of lines) page.drawText(text, { x: 56, y, size: 13, font });
  return doc.save();
}

const solved = (q, over = {}) => ({ ...q, transcription: q.text, finalAnswer: "x = 6", steps: [{ say: "Take 7 from both sides", math: "2x = 12" }, { say: "Divide by 2", math: "x = 6" }], explanation: "", status: "verified", statusNote: "", ...over });

test("very small answer spaces: nothing is squeezed below 11 pt or written over the questions; the working goes on added pages", async () => {
  // Three questions only 17 points apart: no empty band of the 18 points an answer needs.
  const bytes = await paper([["1. Solve 2x + 7 = 19", 780], ["2. Expand 3(x + 4)", 763], ["3. Work out 7 x 8", 746]]);
  const document = await extractQuestions(null, bytes);
  assert.deepEqual(document.questions.map((q) => q.number), ["1", "2", "3"]);
  assert.ok(document.questions.slice(0, 2).every((q) => q.bands.length === 0), "no usable space under the first two");
  const out = await annotatePaper(bytes, document.questions.map((q) => solved(q)), "hybrid");
  assert.ok(out.workedPages.length >= 1, "the answers are on added pages");
  assert.ok(out.placements.every((p) => p.size >= 11), "nothing under 11 pt");
  const original = await docs.readPdfDocument(bytes, { render: false, maxPages: 3 });
  const read = await docs.readPdfDocument(out.pdf, { render: false, maxPages: 10 });
  assert.ok(read.ok);
  assert.deepEqual(out.placements.filter((p) => p.kind === "answer").map((p) => p.questionId), ["q3"], "only the last question, which has the page's foot below it, is written on the paper");
  const after = read.pages[0].lines.map((l) => l.text);
  for (const line of original.pages[0].lines) assert.ok(after.includes(line.text), `the printed line "${line.text}" is still there`);
  const worked = read.pages.slice(1).map((p) => p.text).join("\n");
  for (const n of ["1", "2", "3"]) assert.match(worked, new RegExp(`Question ${n}`), `question ${n} is on the worked pages`);
});

/** A provider that cannot make out the question: it says so, as the solver prompt tells it to. */
const unreadable = { id: "unreadable", async health() { return { ok: true, detail: "ok" }; }, async *stream() { yield { type: "text", text: JSON.stringify({ transcription: "?", final_answer: "", steps: [], explanation: "", assumptions: [], confidence: "low", check: { kind: "none" } }) }; } };

test("a question the model cannot read is flagged as not confidently solved, with no answer made up, on the paper and in the pages", async () => {
  const bytes = await paper([["1. Solve 2x + 7 = 19", 700]]);
  const document = await extractQuestions(null, bytes);
  const result = await solveQuestion({ provider: unreadable, queue: new GenerationQueue(1, 4), model: "m" }, document.questions[0], null);
  assert.equal(result.status, "unsolved");
  assert.equal(result.finalAnswer, "");
  assert.deepEqual(result.steps, []);
  const out = await annotatePaper(bytes, [result], "hybrid");
  const read = await docs.readPdfDocument(out.pdf, { render: false, maxPages: 10 });
  const text = read.pages.map((p) => p.text).join("\n");
  assert.match(text, /not confidently solved/i);
  assert.doesNotMatch(text, /Answer:/, "no answer is shown anywhere");
});
