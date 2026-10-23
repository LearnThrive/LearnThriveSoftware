import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { loadTsFrom } from "./_tsLoader.mjs";

// The structure of a real paper: parts (a), (b), (i), (ii) with the words they share, a question that runs onto the next page, and pages that hold
// no questions (the cover, a formulae sheet, a blank page). What is solved is each part; the id is opaque and the printed label is kept.

const { findQuestions, classifyPage } = loadTsFrom(import.meta.url, "../src/lib/paper/questions.ts");
const { extractQuestions } = loadTsFrom(import.meta.url, "../src/lib/paper/paper.ts");
const { printedLabel } = loadTsFrom(import.meta.url, "../src/lib/paper/solve.ts");

/** A page as the reader would give it: lines from the top down at the given heights. */
function page(number, rows, over = {}) {
  const lines = rows.map(([text, y]) => ({ text, x: 72, y, w: 400, h: 12 }));
  return { number, text: rows.map((r) => r[0]).join("\n"), textQuality: "good", hasPictures: false, stackedMaths: false, image: null, lines, width: 595, height: 842, rotation: 0, originX: 0, originY: 0, ...over };
}

test("parts are found in sequence; each part is a question of its own with the shared words as its stem", () => {
  const found = findQuestions([
    page(1, [
      ["1 Sam buys 3 pens at 2 pounds each.", 780],
      ["(a) Work out the total cost. (2)", 740],
      ["(b) Sam pays with a 10 pound note.", 640],
      ["Work out his change. (2)", 620],
      ["2 (a) Solve 2x + 7 = 19 (2)", 520],
      ["(b) Expand 3(x + 4) (2)", 420],
    ]),
  ]);
  assert.deepEqual(found.map((q) => [q.id, q.number, q.group, q.partLabel]), [
    ["q1", "1(a)", "1", "(a)"],
    ["q2", "1(b)", "1", "(b)"],
    ["q3", "2(a)", "2", "(a)"],
    ["q4", "2(b)", "2", "(b)"],
  ]);
  assert.match(found[0].text, /Sam buys 3 pens/, "the stem is in the part's text");
  assert.match(found[0].text, /total cost/);
  assert.equal(found[0].ownText, "Work out the total cost. (2)", "and the part alone is kept for display");
  assert.equal(found[0].stem, "1 Sam buys 3 pens at 2 pounds each.");
  assert.deepEqual(found.map((q) => q.marks), [2, 2, 2, 2]);
  assert.match(found[1].text, /Work out his change/, "a part's later lines belong to it");
  assert.doesNotMatch(found[2].text, /Sam/, "the number and the first part on one line: no stem, and no bleed from question 1");
  assert.equal(found[2].stem, undefined);
  assert.match(found[2].text, /Solve 2x \+ 7 = 19/);
});

test("roman numerals are parts of a lettered part, which then becomes their stem and is not solved itself", () => {
  const found = findQuestions([
    page(1, [
      ["3 (a) Here is a rule: multiply by 2, then add 1.", 780],
      ["(i) Start with 4. Work out the answer. (1)", 720],
      ["(ii) Start with 10. Work out the answer. (1)", 660],
      ["(b) Write the rule for 5 numbers. (2)", 600],
    ]),
  ]);
  assert.deepEqual(found.map((q) => q.number), ["3(a)(i)", "3(a)(ii)", "3(b)"]);
  assert.match(found[0].text, /Here is a rule/, "the lettered part's words are the stem of its numerals");
  assert.equal(found[0].partLabel, "(i)");
  assert.doesNotMatch(found[2].text, /Here is a rule/, "but not of the next lettered part");
});

test("parts are only taken in sequence: (b) before (a), an algebraic bracket, or a stray (i) are not parts", () => {
  const found = findQuestions([
    page(1, [
      ["1 Factorise fully.", 780],
      ["(b) this is printed out of order", 740],
      ["(x + 1)(x - 2) = 0 has two solutions.", 700],
      ["(a) Solve it. (2)", 660],
      ["(i) is not an option here yet", 620],
    ]),
  ]);
  // (b) first and the bracket are plain lines of the stem; (a) is the first part; a "(i)" after (a) is the first numeral of (a). "Solve it. (2)" carries
  // its own marks, so (a) is a task of its own as well as the stem of its numeral; "Factorise fully." is only the shared instruction.
  assert.deepEqual(found.map((q) => q.number), ["1(a)", "1(a)(i)"]);
  assert.match(found[1].text, /out of order/);
  assert.match(found[1].text, /two solutions/);
  assert.doesNotMatch(found[0].text, /not an option/, "the parent keeps only its own words");
});

test("(i) after (h) is the ninth letter, not a numeral", () => {
  const rows = [["4 Read this carefully.", 800]];
  "abcdefgh".split("").forEach((l, i) => rows.push([`(${l}) Part ${l}.`, 780 - i * 20]));
  rows.push(["(i) Part i.", 600]);
  const found = findQuestions([page(1, rows)]);
  assert.deepEqual(found.map((q) => q.number), ["4(a)", "4(b)", "4(c)", "4(d)", "4(e)", "4(f)", "4(g)", "4(h)", "4(i)"]);
});

test("a question that runs onto the next page keeps its text, and the part is marked as continued", () => {
  const found = findQuestions([
    page(1, [["1 (a) Use the table to work out the mean", 120]]),
    page(2, [["of the number of goals scored. (3)", 780], ["(b) Write down the mode. (1)", 700], ["2 Work out 3 + 4. (1)", 600]]),
  ]);
  assert.deepEqual(found.map((q) => [q.number, q.page, q.continued]), [["1(a)", 1, true], ["1(b)", 2, undefined], ["2", 2, undefined]]);
  assert.match(found[0].text, /mean\s+of the number of goals/);
  assert.equal(found[0].marks, 3, "the marks printed on the carried-over line");
});

test("a whole question with no parts is as before; a paper that starts part-way keeps its printed numbers as labels, and the ids follow the paper", () => {
  const found = findQuestions([page(1, [["3 Work out 2 + 3. (1)", 780], ["4 Work out 4 x 5. (1)", 700]])]);
  assert.deepEqual(found.map((q) => [q.id, q.number, q.group, q.partLabel, q.stem]), [["q1", "3", "3", undefined, undefined], ["q2", "4", "4", undefined, undefined]]);
});

test("the cover, a formulae sheet and a blank page hold no questions; '1 hour 30 minutes' is not question 1", () => {
  const cover = page(1, [
    ["Pearson Edexcel GCSE", 800],
    ["Candidate surname", 760],
    ["Centre number    Candidate number", 740],
    ["Time allowed: 1 hour 30 minutes", 700],
    ["Total marks 80", 680],
    ["Instructions", 640],
    ["Answer all questions.", 620],
  ]);
  const formulae = page(2, [["Formulae", 800], ["Area of a trapezium = 1/2 (a + b) h", 760]]);
  const blank = page(3, [["This page is intentionally left blank", 400]]);
  const empty = page(4, [["4", 30]]);
  const questions = page(5, [["1 Work out 2 + 3. (1)", 780]]);
  assert.equal(classifyPage(cover, true), "cover");
  assert.equal(classifyPage(formulae, false), "formulae");
  assert.equal(classifyPage(blank, false), "blank");
  assert.equal(classifyPage(empty, false), "blank", "only a page number");
  assert.equal(classifyPage(questions, false), "questions");
  assert.equal(classifyPage(page(1, [["Name: ______ Date: ______", 800], ["1 Work out 2 + 3. (1)", 760]]), true), "questions", "a worksheet's name line is not a cover");
  assert.equal(classifyPage(page(6, [["5", 40]], { textQuality: "none", text: "", hasPictures: true, lines: [] }), false), "questions", "a scan is not blank");
  const found = findQuestions([cover, formulae, blank, empty, questions]);
  assert.deepEqual(found.map((q) => [q.number, q.page]), [["1", 5]]);
});

test("through a real PDF: the cover and blank pages are skipped and said, and the parts come out in order", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const draw = (rows) => {
    const p = pdf.addPage([595, 842]);
    for (const [text, y] of rows) p.drawText(text, { x: 72, y, size: 12, font });
  };
  draw([["Pearson Edexcel GCSE Mathematics", 780], ["Candidate surname", 740], ["Centre number", 720], ["Time allowed: 1 hour 30 minutes", 700], ["Total marks 80", 680], ["Instructions", 650], ["Answer all questions.", 630]]);
  draw([
    ["1 Sam buys 3 pens at 2 pounds each.", 780],
    ["(a) Work out the total cost. (2)", 740],
    ["(b) Sam pays with a 10 pound note. Work out his change. (2)", 600],
    ["2 Solve 2x + 7 = 19 (2)", 450],
  ]);
  draw([["This page is intentionally left blank", 400]]);
  const document = await extractQuestions(null, await pdf.save());
  assert.ok(!("problem" in document), "the PDF is read");
  assert.deepEqual(document.skipped, [{ page: 1, kind: "cover" }, { page: 3, kind: "blank" }]);
  assert.deepEqual(document.questions.map((q) => [q.id, q.number, q.page]), [["q1", "1(a)", 2], ["q2", "1(b)", 2], ["q3", "2", 2]]);
  assert.ok(document.questions.every((q) => q.answer), "each part has its own answer space");
  assert.match(document.questions[0].text, /Sam buys 3 pens/);
});

test("a printed label from a picture is kept as printed, with its part", () => {
  assert.equal(printedLabel("Question 3"), "3");
  assert.equal(printedLabel("3 (a)"), "3(a)");
  assert.equal(printedLabel("3(A)(ii)"), "3(a)(ii)");
  assert.equal(printedLabel("Q.12"), "12");
  assert.equal(printedLabel("3a"), "3");
});
