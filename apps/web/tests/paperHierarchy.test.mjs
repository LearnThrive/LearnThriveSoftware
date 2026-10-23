import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { loadTsFrom } from "./_tsLoader.mjs";

// One rule for what a task is, whatever read the page: a question with parts is the shared context of its parts, never a task of its own.
// The owner's screenshot (3 with a diagram, then (a)) must offer ONE task, 3(a), with the shared facts and the printed marks.

const { normaliseQuestions, parseLabel, resolveLabel } = loadTsFrom(import.meta.url, "../src/lib/paper/questionTree.ts");
const { entriesFromListing, assignMarks, taskCount } = loadTsFrom(import.meta.url, "../src/lib/paper/listing.ts");
const { findQuestions } = loadTsFrom(import.meta.url, "../src/lib/paper/questions.ts");
const { extractQuestions, photoToPdf } = loadTsFrom(import.meta.url, "../src/lib/paper/paper.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");

const q = (number, text, page = 1, extra = {}) => ({ id: `x${number}${page}`, number, page, text, marks: null, box: null, answer: null, bands: [], answerLine: null, fromText: false, ...extra });
const FLOOR = "The diagram shows a plan of a floor.\nPetra has 3 tins of paint.\nThere are 2.5 litres of paint in each tin.\nPetra thinks 1 litre of paint will cover 10 m² of floor.";
const PART_A = "Assuming Petra is correct, does she have enough paint to cover the floor?\nYou must show all your working.";

test("labels: printed forms are read, a bare part is completed with the number last seen", () => {
  assert.deepEqual(parseLabel("3(a)(ii)"), { number: "3", parts: ["a", "ii"] });
  assert.deepEqual(parseLabel("Question 3 (a)"), { number: "3", parts: ["a"] });
  assert.deepEqual(parseLabel("3a"), { number: "3", parts: ["a"] });
  assert.equal(parseLabel("hello"), null);
  assert.equal(resolveLabel("(b)", "3"), "3(b)");
  assert.equal(resolveLabel("b", "3"), "3(b)");
  assert.equal(resolveLabel("3(b)", "7"), "3(b)", "a full label is never overridden by the carried number");
});

test("a question and its part are ONE task: the parent is dropped and its words become the part's stem", () => {
  const tasks = normaliseQuestions([q("3", FLOOR), q("3(a)", PART_A)]);
  assert.deepEqual(tasks.map((t) => t.number), ["3(a)"]);
  assert.equal(tasks[0].group, "3");
  assert.equal(tasks[0].partLabel, "(a)");
  assert.equal(tasks[0].stem, FLOOR);
  assert.equal(tasks[0].ownText, PART_A);
  assert.ok(tasks[0].text.includes("Petra has 3 tins of paint") && tasks[0].text.includes("does she have enough paint"), "the part carries the shared facts");
  assert.equal(taskCount([q("3", FLOOR), q("3(a)", PART_A)]), 1);
});

test("several parts each carry the shared words; nested parts carry the words of every level above them", () => {
  const tasks = normaliseQuestions([q("3", "Shared words."), q("3(a)", "Part a words."), q("3(b)", "Part b words."), q("3(b)(i)", "Numeral i."), q("3(b)(ii)", "Numeral ii.")]);
  assert.deepEqual(tasks.map((t) => t.number), ["3(a)", "3(b)(i)", "3(b)(ii)"], "3(b) has parts of its own, so it is context too");
  assert.equal(tasks[0].text, "Shared words.\nPart a words.");
  assert.equal(tasks[1].text, "Shared words.\nPart b words.\nNumeral i.");
  assert.equal(tasks[2].partLabel, "(ii)");
  assert.ok(tasks.every((t) => t.group === "3"));
});

test("genuine independent parent tasks are kept", () => {
  const tasks = normaliseQuestions([q("1", "Work out 3 + 4."), q("2", "Work out 5 x 6."), q("3", "Shared."), q("3(a)", "A.")]);
  assert.deepEqual(tasks.map((t) => t.number), ["1", "2", "3(a)"]);
  assert.equal(tasks[0].stem, undefined);
});

test("unrelated repeated numbering is never merged: the same label again is a new group", () => {
  const tasks = normaliseQuestions([q("1", "Section A one."), q("2", "Section A two."), q("3", "Paper one shared."), q("3(a)", "Paper one part."), q("1", "Section B one."), q("3", "Paper two shared."), q("3(a)", "Paper two part.")]);
  const threes = tasks.filter((t) => t.number === "3(a)");
  assert.equal(threes.length, 2);
  assert.notEqual(threes[0].group, threes[1].group, "two separate groups");
  assert.ok(threes[0].text.includes("Paper one shared") && !threes[0].text.includes("Paper two"));
  assert.ok(threes[1].text.includes("Paper two shared") && !threes[1].text.includes("Paper one"));
});

test("a part listed on a later page without its question takes the shared words from the same group, and only the same group", () => {
  const first = normaliseQuestions([q("3", FLOOR, 1), q("3(a)", PART_A, 1)]);
  const all = normaliseQuestions([...first, q("3(b)", "Petra's paint actually covers 11 m² per litre.", 2)]);
  assert.deepEqual(all.map((t) => t.number), ["3(a)", "3(b)"]);
  assert.equal(all[1].stem, FLOOR, "the continuation inherits its question's shared words");
  // A part with no question anywhere in the list does not invent a stem.
  const orphan = normaliseQuestions([q("5(b)", "Work out the area.", 2)]);
  assert.equal(orphan[0].stem, undefined);
  // And a different question's words are never lent to it.
  const mixed = normaliseQuestions([...first, q("4(b)", "Another part.", 2)]);
  assert.equal(mixed[1].stem, undefined);
});

test("normalising twice changes nothing, and a text layer's parts pass through unchanged", () => {
  const once = normaliseQuestions([q("3", FLOOR), q("3(a)", PART_A)]);
  assert.deepEqual(normaliseQuestions(once).map((t) => [t.number, t.text, t.stem, t.group]), once.map((t) => [t.number, t.text, t.stem, t.group]));
  const page = (rows) => ({ number: 1, text: rows.map((r) => r[0]).join("\n"), textQuality: "good", hasPictures: false, stackedMaths: false, image: null, lines: rows.map(([text, y]) => ({ text, x: 72, y, w: 400, h: 12 })), width: 595, height: 842, rotation: 0, originX: 0, originY: 0 });
  const found = findQuestions([page([["3 The diagram shows a plan of a floor.", 780], ["Petra has 3 tins of paint.", 760], ["(a) Does she have enough paint? (4)", 700]])]);
  assert.deepEqual(found.map((t) => t.number), ["3(a)"], "the text layer already offers one task");
  assert.deepEqual(normaliseQuestions(found).map((t) => [t.number, t.text, t.marks]), found.map((t) => [t.number, t.text, t.marks]));
  assert.equal(found[0].marks, 4, "printed marks come from the text layer");
});

test("a vision reading as a tree, as a flat list, and a page that shows only a later part all end in the same tasks", () => {
  const tree = entriesFromListing({ questions: [{ number: "3", text: FLOOR, parts: [{ label: "(a)", text: PART_A, parts: [] }] }] }, 1);
  const flat = entriesFromListing({ questions: [{ number: "3", text: FLOOR }, { number: "3(a)", text: PART_A }] }, 1);
  for (const entries of [tree, flat]) {
    const tasks = normaliseQuestions(entries);
    assert.deepEqual(tasks.map((t) => t.number), ["3(a)"]);
    assert.equal(tasks[0].stem, FLOOR);
  }
  const later = entriesFromListing({ questions: [{ number: "", text: "", parts: [{ label: "(b)", text: "Part b words.", parts: [] }] }] }, 2, "3");
  assert.deepEqual(later.map((e) => e.number), ["3(b)"], "the number is carried over from the page before");
  const nested = entriesFromListing({ questions: [{ number: "4", text: "S", parts: [{ label: "(a)", text: "A", parts: [{ label: "(i)", text: "I" }, { label: "(ii)", text: "II" }] }] }] }, 1);
  assert.deepEqual(normaliseQuestions(nested).map((t) => t.number), ["4(a)(i)", "4(a)(ii)"]);
});

test("marks are never taken from the question reading, and are kept only when there are exactly as many as tasks", () => {
  const entries = entriesFromListing({ questions: [{ number: "3", text: FLOOR, marks: 2, parts: [{ label: "(a)", text: PART_A, marks: 2 }] }] }, 1);
  assert.ok(entries.every((e) => e.marks === null), "a misread '2' in the listing cannot become the marks");
  const tasks = normaliseQuestions(entries);
  assignMarks(tasks, [4]);
  assert.equal(tasks[0].marks, 4);
  const two = normaliseQuestions([q("1", "A."), q("2", "B.")]);
  assignMarks(two, [3]);
  assert.deepEqual(two.map((t) => t.marks), [null, null], "one number for two tasks is unknown, not a guess");
  assignMarks(two, null);
  assert.deepEqual(two.map((t) => t.marks), [null, null]);
});

/** A model that sees a picture of the owner's page: the tree it would give, a wrong mark in it, and the right one when asked about marks only. */
class Pictured extends MockProvider {
  constructor(marks) {
    super({ delayMs: 0 });
    this.marks = marks;
  }
  async *stream(messages, options) {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    if (options.json && system.startsWith("List the questions on this exam")) {
      this.requests.push(messages);
      yield { type: "text", text: JSON.stringify({ questions: [{ number: "3", text: FLOOR, marks: 2, parts: [{ label: "(a)", text: PART_A, marks: 2, parts: [] }] }] }) };
      yield { type: "done" };
      return;
    }
    if (options.json && system.startsWith("This is an exam page, or part of one")) {
      this.requests.push(messages);
      yield { type: "text", text: JSON.stringify({ marks: this.marks }) };
      yield { type: "done" };
      return;
    }
    yield* super.stream(messages, options);
  }
}

async function screenshot() {
  const canvas = createCanvas(800, 1074);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 800, 1074);
  ctx.fillStyle = "#000000";
  ctx.font = "24px sans-serif";
  ctx.fillText("3  The diagram shows a plan of a floor.", 60, 60);
  return photoToPdf(new Uint8Array(canvas.toBuffer("image/png")), "image/png");
}

test("end to end through the reader: a picture offers one task, 3(a), with the shared facts, four marks, and the part's own layout", async () => {
  const provider = new Pictured([4]);
  const doc = await extractQuestions({ provider, queue: new GenerationQueue(1, 5), model: "mock" }, await screenshot(), { maxPages: 60, maxQuestions: 150, renderBatch: 6, scanLayout: false });
  assert.ok(!("problem" in doc));
  assert.deepEqual(doc.questions.map((x) => [x.id, x.number, x.marks, x.group, x.partLabel]), [["q1", "3(a)", 4, "3", "(a)"]]);
  assert.ok(doc.questions[0].text.includes("Petra has 3 tins of paint") && doc.questions[0].text.includes("does she have enough paint"));
  assert.equal(doc.questions[0].fromText, false);
  // Unknown stays unknown: nothing readable.
  const none = await extractQuestions({ provider: new Pictured([]), queue: new GenerationQueue(1, 5), model: "mock" }, await screenshot(), { maxPages: 60, maxQuestions: 150, renderBatch: 6, scanLayout: false });
  assert.equal(none.questions[0].marks, null);
});

test("the same rule for a text PDF: the question and its part are one task there too", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  for (const [text, y] of [["3 The diagram shows a plan of a floor.", 780], ["Petra has 3 tins of paint.", 762], ["(a) Does she have enough paint? (4)", 700], ["4 Work out 3 + 4. (1)", 500]]) page.drawText(text, { x: 72, y, size: 11, font });
  const doc = await extractQuestions(null, new Uint8Array(await pdf.save()));
  assert.ok(!("problem" in doc));
  assert.deepEqual(doc.questions.map((x) => [x.number, x.marks]), [["3(a)", 4], ["4", 1]]);
  assert.match(doc.questions[0].text, /Petra has 3 tins/);
});
