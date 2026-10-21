import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The Paper Tutor: finding the questions and their answer spaces, the checker that decides "verified" (never the model's word),
// the annotated PDF (inside the answer spaces, never over the paper's printing, never tiny, always labelled), and the background
// jobs (one family's paper is never another's, a daily cap, cancelling). The mock model answers "6" to everything.

const docs = loadTsFrom(import.meta.url, "../src/lib/assistant/documents.ts");
const { findQuestions } = loadTsFrom(import.meta.url, "../src/lib/paper/questions.ts");
const { verify, printedChecks, tidyStep } = loadTsFrom(import.meta.url, "../src/lib/paper/solve.ts");
const { annotatePaper } = loadTsFrom(import.meta.url, "../src/lib/paper/annotate.ts");
const { extractQuestions } = loadTsFrom(import.meta.url, "../src/lib/paper/paper.ts");
const { PaperJobs, JOBS_PER_DAY } = loadTsFrom(import.meta.url, "../src/lib/paper/jobs.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

const fixture = (name) => new Uint8Array(readFileSync(new URL(`./fixtures/documents/${name}`, import.meta.url)));
const WORKSHEET = fixture("text-native.pdf");
const GCSE = fixture("gcse-multipage.pdf");

async function questionsOf(bytes) {
  const reading = await docs.readPdfDocument(bytes, { render: false, maxPages: 20 });
  const renders = await docs.renderPdfPages(bytes, { scale: 1.5 });
  return { reading, questions: findQuestions(reading.pages, renders) };
}

const solution = (over = {}) => ({ transcription: "", final_answer: "6", steps: [], explanation: "", assumptions: [], confidence: "medium", check: { kind: "none" }, ...over });
const question = (text, over = {}) => ({ id: "q1", number: "1", page: 1, text, marks: null, box: null, answer: null, bands: [], answerLine: null, fromText: true, ...over });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("finds the numbered questions, their text and marks, and empty answer space below each", async () => {
  const sheet = await questionsOf(WORKSHEET);
  assert.deepEqual(sheet.questions.map((q) => q.number), ["1", "2"]);
  assert.match(sheet.questions[0].text, /Solve 2x \+ 7 = 19/);
  assert.match(sheet.questions[1].text, /Expand 3\(x \+ 4\)/);
  for (const q of sheet.questions) {
    assert.ok(q.bands.length > 0, `question ${q.number} has somewhere to write`);
    const lines = sheet.reading.pages.find((p) => p.number === q.page).lines;
    for (const band of q.bands) for (const line of lines) assert.ok(!overlaps(band, line) || /^[\s.…_]*$/.test(line.text), `a band of question ${q.number} covers "${line.text}"`);
  }

  const gcse = await questionsOf(GCSE);
  assert.ok(gcse.questions.length >= 4, "every question across three pages");
  assert.deepEqual(gcse.questions.map((q) => q.number), gcse.questions.map((_, i) => String(i + 1)), "numbered in order, none twice");
  assert.equal(gcse.questions.find((q) => q.number === "2").marks, 3);
  assert.doesNotMatch(gcse.questions.find((q) => q.number === "2").text, /marks/, "the marks heading is not part of the question");
  assert.ok(new Set(gcse.questions.map((q) => q.page)).size >= 2, "questions on later pages keep their page");
});

test("the checker tests answers against the printed question, and the model's own check only as a fallback", () => {
  const solve = question("Solve 2x + 7 = 19. Give the value of x.");
  assert.deepEqual(printedChecks(solve.text).equations, ["2x + 7 = 19"]);
  assert.equal(verify(solve, solution({ final_answer: "6" })).status, "verified");
  assert.equal(verify(solve, solution({ final_answer: "x = 6" })).status, "verified");
  const wrong = verify(solve, solution({ final_answer: "5" }));
  assert.equal(wrong.status, "failed");
  assert.match(wrong.detail, /left side is 17/, "says what the wrong answer comes to, for the second attempt");
  // The model saying it is sure changes nothing; saying it is not, does.
  assert.equal(verify(solve, solution({ final_answer: "5", confidence: "high" })).status, "failed");
  assert.equal(verify(solve, solution({ confidence: "low" })).status, "unsolved");
  assert.equal(verify(solve, solution({ final_answer: "" })).status, "unsolved");

  const simultaneous = question("Solve the simultaneous equations 2x + y = 11 and x − y = 1.");
  assert.equal(verify(simultaneous, solution({ final_answer: "x = 4, y = 3" })).status, "verified");
  assert.equal(verify(simultaneous, solution({ final_answer: "x = 3, y = 5" })).status, "failed");

  const expand = question("Expand 3(x + 4).");
  assert.equal(verify(expand, solution({ final_answer: "3x + 12" })).status, "verified");
  assert.equal(verify(expand, solution({ final_answer: "3x + 4" })).status, "failed");

  const calc = question("Work out 3/4 + 1/8.");
  assert.equal(verify(calc, solution({ final_answer: "\\frac{7}{8}" })).status, "verified");
  assert.equal(verify(calc, solution({ final_answer: "4/12" })).status, "failed");

  // Nothing to calculate in the question: a word problem relies on the model's check, and says whose reading it checked.
  const words = question("Sam has 24 sweets and gives away three quarters. How many are left?");
  assert.equal(verify(words, solution({ final_answer: "6" })).status, "unchecked");
  assert.equal(verify(words, solution({ final_answer: "6", check: { kind: "evaluate", expression: "24 - 3/4 * 24", answer: "6" } })).status, "checked_reading");
  assert.equal(verify(words, solution({ final_answer: "6", check: { kind: "evaluate", expression: "24 - 3/4 * 24", answer: "7" } })).status, "unchecked", "a check about another number says nothing about this answer");
  assert.equal(verify(words, solution({ final_answer: "7", check: { kind: "evaluate", expression: "24 - 3/4 * 24", answer: "7" } })).status, "failed");

  // Standard form, printed with a digit-group space (once read as 0 x 52).
  const standard = question("Write 0.000 52 in standard form.");
  assert.equal(verify(standard, solution({ final_answer: "5.2 \\times 10^{-4}", check: { kind: "evaluate", expression: "0.000 52", answer: "5.2 \\times 10^{-4}" } })).status, "verified", "the check is of the number as printed");
  assert.equal(verify(standard, solution({ final_answer: "52 \\times 10^{-4}", check: { kind: "evaluate", expression: "0.000 52", answer: "52 \\times 10^{-4}" } })).status, "failed");

  // A sentence in the maths field is written as words; real maths, even with \text, stays maths.
  assert.deepEqual(tidyStep({ say: "Count the places.", math: "$The decimal point moves 4 places.$" }), { say: "Count the places. The decimal point moves 4 places." });
  assert.deepEqual(tidyStep({ math: "15\\% \\text{ of } 80 = 12" }), { say: undefined, math: "15\\% \\text{ of } 80 = 12" });
  assert.deepEqual(tidyStep({ say: "Add", math: "3x = 12" }), { say: "Add", math: "3x = 12" });

  // A question read from a picture: its text is the AI's own reading, so a pass is never "verified".
  const pictured = question("Solve 2x + 7 = 19.", { fromText: false });
  assert.equal(verify(pictured, solution({ final_answer: "6", check: { kind: "solve", equations: ["2x + 7 = 19"], answer: "6" } })).status, "checked_reading");
});

test("the annotated paper keeps answers inside the answer spaces, never under 11 pt, labelled, with worked pages as asked", async () => {
  const doc = await extractQuestions(null, WORKSHEET);
  const solved = doc.questions.map((q, i) => ({
    ...q,
    transcription: q.text,
    finalAnswer: i === 0 ? "x = 6" : "3x + 12",
    steps: [{ say: "Take 7 from both sides", math: "2x = 12" }, { say: "Divide by 2", math: "x = 6" }],
    explanation: "",
    status: i === 0 ? "verified" : "failed",
    statusNote: "",
  }));
  const original = await docs.readPdfDocument(WORKSHEET, { render: false, maxPages: 5 });
  for (const mode of ["hybrid", "filled", "worked"]) {
    const out = await annotatePaper(WORKSHEET, solved, mode);
    const read = await docs.readPdfDocument(out.pdf, { render: false, maxPages: 10 });
    assert.ok(read.ok, `${mode}: the output opens`);
    assert.equal(read.pageCount, original.pageCount + out.workedPages.length, `${mode}: the paper's pages, then the worked ones`);
    // Filled adds pages only for working that did not fit in the answer space; the other two always have them.
    if (mode !== "filled") assert.ok(out.workedPages.length >= 1, `${mode}: has worked pages`);
    const text = read.pages.map((p) => p.text).join("\n");
    assert.match(text, /AI-generated worked solutions/, `${mode}: labelled`);
    for (const p of out.placements) {
      assert.ok(p.size >= 11, `${mode}: ${p.questionId} written at ${p.size} pt`);
      const printed = original.pages.find((x) => x.number === p.page).lines;
      for (const line of printed) assert.ok(!overlaps(p.rect, line), `${mode}: the answer to ${p.questionId} covers "${line.text}"`);
    }
    if (mode !== "worked") assert.equal(out.placements.filter((p) => p.kind === "answer").length, 2, `${mode}: both answers on the paper`);
    if (mode === "hybrid") assert.match(text, /not confidently solved/i, "a failed check is said on the paper");
  }
});

async function jobWorld() {
  const store = new InMemoryLibraryStore();
  const a = await store.accounts.ensureClient(store.seedProfile({ email: "a@example.com" }));
  const b = await store.accounts.ensureClient(store.seedProfile({ email: "b@example.com" }));
  const uploads = new MemoryLibraryStorage();
  const now = new Date("2026-10-21T10:00:00Z");
  const deps = { store, uploads, solve: { provider: new MockProvider({ delayMs: 0 }), queue: new GenerationQueue(2, 10), model: "mock" }, now: () => now };
  const session = await store.chat.createSession(a, {}, now);
  await uploads.put(`${session.id}/w.pdf`, WORKSHEET, "application/pdf");
  const file = await store.chat.addFile(a, session.id, { storagePath: `${session.id}/w.pdf`, bytes: WORKSHEET.length, contentType: "application/pdf" }, now);
  return { store, uploads, deps, a, b, session, file, jobs: new PaperJobs() };
}

async function until(jobs, client, id, states) {
  for (let i = 0; i < 400; i += 1) {
    const job = jobs.get(client, id);
    if (states.includes(job?.state)) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job never reached ${states}`);
}

test("a job reads the paper, solves the chosen questions, stores the PDF and posts the summary into the chat", async () => {
  const w = await jobWorld();
  const started = await w.jobs.start(w.deps, { clientId: w.a, sessionId: w.session.id, fileId: w.file.id });
  assert.equal(started.ok, true);
  assert.equal(w.jobs.get(w.b, started.job.id), null, "another family cannot see it");
  assert.equal((await w.jobs.start(w.deps, { clientId: w.a, sessionId: w.session.id, fileId: w.file.id })).code, "busy", "one at a time");
  const ready = await until(w.jobs, w.a, started.job.id, ["ready", "failed"]);
  assert.equal(ready.state, "ready");
  assert.deepEqual(ready.questions.map((q) => q.number), ["1", "2"]);
  assert.equal(w.jobs.solve(w.deps, w.b, started.job.id, { mode: "hybrid" }).code, "not_found", "nor solve it");

  assert.equal(w.jobs.solve(w.deps, w.a, started.job.id, { mode: "hybrid", questionIds: ["q1"] }).ok, true);
  const done = await until(w.jobs, w.a, started.job.id, ["done", "failed"]);
  assert.equal(done.state, "done", done.message ?? "");
  assert.deepEqual(done.progress, [{ questionId: "q1", state: "done", status: "verified" }], "only the chosen question, checked by calculation");
  const stored = await w.store.chat.getFile(w.a, done.resultFileId);
  assert.equal(stored.contentType, "application/pdf");
  assert.equal(await w.store.chat.getFile(w.b, done.resultFileId), null);
  const bytes = await w.uploads.read(stored.storagePath);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");

  const messages = await w.store.chat.listMessages(w.a, w.session.id);
  const summary = messages.at(-1);
  assert.equal(summary.role, "assistant");
  assert.match(summary.content, /AI-generated/);
  assert.match(summary.content, /\*\*Question 1\*\* \(checked by calculation\): \$6\$/);
  assert.equal((await w.store.chat.getFile(w.a, w.file.id)).messageId, summary.id, "the paper itself travels with the summary, for follow-up questions");
});

test("jobs can be cancelled, are refused for another family's file, and stop at the daily cap", async () => {
  const w = await jobWorld();
  assert.equal((await w.jobs.start(w.deps, { clientId: w.b, sessionId: w.session.id, fileId: w.file.id })).code, "not_found");
  const first = await w.jobs.start(w.deps, { clientId: w.a, sessionId: w.session.id, fileId: w.file.id });
  assert.equal(w.jobs.cancel(w.b, first.job.id), false);
  assert.equal(w.jobs.cancel(w.a, first.job.id), true);
  assert.equal(w.jobs.get(w.a, first.job.id).state, "cancelled");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(w.jobs.get(w.a, first.job.id).state, "cancelled", "the reading finishing later does not revive it");
  for (let i = 1; i < JOBS_PER_DAY; i += 1) {
    const s = await w.jobs.start(w.deps, { clientId: w.a, sessionId: w.session.id, fileId: w.file.id });
    assert.equal(s.ok, true, `paper ${i + 1}`);
    w.jobs.cancel(w.a, s.job.id);
  }
  assert.equal((await w.jobs.start(w.deps, { clientId: w.a, sessionId: w.session.id, fileId: w.file.id })).code, "limit");
});

test("the Paper Tutor is off in production unless switched on exactly, and on in development unless switched off", () => {
  const { paperTutorEnabled } = loadTsFrom(import.meta.url, "../src/lib/assistant/config.ts");
  assert.equal(paperTutorEnabled({ NODE_ENV: "production" }), false);
  assert.equal(paperTutorEnabled({ NODE_ENV: "production", PAPER_TUTOR_ENABLED: "1" }), false);
  assert.equal(paperTutorEnabled({ NODE_ENV: "production", PAPER_TUTOR_ENABLED: "true" }), true);
  assert.equal(paperTutorEnabled({ NODE_ENV: "development" }), true);
  assert.equal(paperTutorEnabled({ NODE_ENV: "development", PAPER_TUTOR_ENABLED: "false" }), false);
});
