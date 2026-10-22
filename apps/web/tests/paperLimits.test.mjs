import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { loadTsFrom } from "./_tsLoader.mjs";

// The limit chain of the Paper Tutor: one configurable limit, a paper beyond the old 20 pages and 30 questions read completely, drawn a few
// pages at a time, and anything a limit leaves out NAMED, never dropped silently.

const { paperLimits } = loadTsFrom(import.meta.url, "../src/lib/paper/limits.ts");
const { extractQuestions } = loadTsFrom(import.meta.url, "../src/lib/paper/paper.ts");
const docs = loadTsFrom(import.meta.url, "../src/lib/assistant/documents.ts");
const { findQuestions } = loadTsFrom(import.meta.url, "../src/lib/paper/questions.ts");
const { PaperJobs } = loadTsFrom(import.meta.url, "../src/lib/paper/jobs.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

/** A paper of `pages` pages with `perPage` numbered questions each, an empty space under every one. */
async function longPaper(pages, perPage) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let n = 0;
  for (let p = 0; p < pages; p += 1) {
    const page = doc.addPage([595.28, 841.89]);
    for (let i = 0; i < perPage; i += 1) {
      n += 1;
      page.drawText(`${n}. Work out ${n} + ${n}. [1 mark]`, { x: 56, y: 790 - i * 190, size: 12, font });
    }
  }
  return { bytes: await doc.save(), questions: n };
}

test("the limits come from the environment, with defaults beyond the old 20 pages and 30 questions, and nonsense falls back", () => {
  assert.deepEqual(paperLimits({}), { maxPages: 60, maxQuestions: 150, renderBatch: 6, scanLayout: true });
  assert.equal(paperLimits({ PAPER_SCAN_LAYOUT: "false" }).scanLayout, false);
  assert.deepEqual(paperLimits({ PAPER_MAX_PAGES: "100", PAPER_MAX_QUESTIONS: "300", PAPER_RENDER_BATCH: "2" }), { maxPages: 100, maxQuestions: 300, renderBatch: 2, scanLayout: true });
  assert.deepEqual(paperLimits({ PAPER_MAX_PAGES: "0", PAPER_MAX_QUESTIONS: "many", PAPER_RENDER_BATCH: "-1" }), { maxPages: 60, maxQuestions: 150, renderBatch: 6, scanLayout: true });
  assert.equal(paperLimits({ PAPER_MAX_PAGES: "9999" }).maxPages, 60, "out of range falls back rather than being clamped to something unintended");
});

test("a 30-page paper with 120 questions is read completely: every question, in order, none dropped", async () => {
  const { bytes, questions } = await longPaper(30, 4);
  const doc = await extractQuestions(null, bytes);
  assert.ok(!("problem" in doc), "problem" in doc ? doc.problem : "");
  assert.equal(doc.omitted, null);
  assert.equal(doc.questions.length, questions);
  assert.deepEqual(doc.questions.map((q) => q.number), Array.from({ length: questions }, (_, i) => String(i + 1)));
  assert.equal(new Set(doc.questions.map((q) => q.page)).size, 30);
  assert.ok(doc.questions.every((q) => q.marks === 1 && q.bands.length > 0), "marks and answer space on every one");
}, { timeout: 120_000 });

test("drawing the pages a few at a time measures exactly what drawing them all at once did", async () => {
  const gcse = new Uint8Array(readFileSync(new URL("./fixtures/documents/gcse-multipage.pdf", import.meta.url)));
  const reading = await docs.readPdfDocument(gcse, { render: false, maxPages: 20 });
  const all = findQuestions(reading.pages, await docs.renderPdfPages(gcse, { scale: 1.5 }));
  for (const renderBatch of [1, 2, 6]) {
    const batched = await extractQuestions(null, gcse, { maxPages: 20, maxQuestions: 150, renderBatch });
    assert.deepEqual(batched.questions.map((q) => [q.id, q.page, q.bands, q.answer]), all.map((q) => [q.id, q.page, q.bands, q.answer]), `batch of ${renderBatch}`);
  }
});

test("a paper longer than the page limit is refused with the number; more questions than the limit are kept up to it and the rest are NAMED", async () => {
  const { bytes } = await longPaper(8, 4);
  const tooLong = await extractQuestions(null, bytes, { maxPages: 5, maxQuestions: 150, renderBatch: 6 });
  assert.match(tooLong.problem, /8 pages; the limit is 5/);
  const capped = await extractQuestions(null, bytes, { maxPages: 60, maxQuestions: 10, renderBatch: 6 });
  assert.equal(capped.questions.length, 10);
  assert.deepEqual(capped.omitted, { questions: 22, firstOmitted: "11", limit: 10 });

  // The job tells the student exactly what was left out instead of reporting a complete paper.
  const store = new InMemoryLibraryStore();
  const owner = { clientId: await store.accounts.ensureClient(store.seedProfile({ email: "a@example.com" })), studentId: null };
  const uploads = new MemoryLibraryStorage();
  const session = await store.chat.createSession(owner, {}, new Date());
  await uploads.put(`${session.id}/long.pdf`, bytes, "application/pdf");
  const file = await store.chat.addFile(owner, session.id, { storagePath: `${session.id}/long.pdf`, bytes: bytes.length, contentType: "application/pdf" }, new Date());
  const previous = process.env.PAPER_MAX_QUESTIONS;
  process.env.PAPER_MAX_QUESTIONS = "10";
  try {
    const jobs = new PaperJobs();
    const deps = { store, uploads, solve: { provider: new MockProvider({ delayMs: 0 }), queue: new GenerationQueue(2, 10), model: "mock" } };
    const started = await jobs.start(deps, { owner, sessionId: session.id, fileId: file.id });
    let view = await jobs.get(deps, owner, started.job.id);
    for (let i = 0; i < 400 && view.state === "extracting"; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      view = await jobs.get(deps, owner, started.job.id);
    }
    assert.equal(view.state, "ready");
    assert.equal(view.questions.length, 10);
    assert.match(view.message, /32 questions\. Only the first 10 are listed.*question 11 onwards are NOT included.*not be a complete paper/);
  } finally {
    if (previous === undefined) delete process.env.PAPER_MAX_QUESTIONS;
    else process.env.PAPER_MAX_QUESTIONS = previous;
  }
}, { timeout: 120_000 });
