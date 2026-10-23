import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { loadTsFrom } from "./_tsLoader.mjs";

// The maths used to be typeset in MathJax's textbook face beside handwritten prose: two hands on one page. MathJax still LAYS OUT the maths (fractions,
// roots, powers, spacing), but every glyph is now the handwriting font's, in the place MathJax put it. The three output modes are unchanged.

const { mathShapes } = loadTsFrom(import.meta.url, "../src/lib/paper/mathsvg.ts");
const { characterFor, handGlyph, boxOfPath } = loadTsFrom(import.meta.url, "../src/lib/paper/handwriting.ts");
const { annotatePaper, penStyle, prose } = loadTsFrom(import.meta.url, "../src/lib/paper/annotate.ts");
const { readPdfDocument } = loadTsFrom(import.meta.url, "../src/lib/assistant/documents.ts");

const FORMULAE = ["10 \\times 8 = 80\\text{ m}^2", "\\frac{57 - 25}{15} = 2\\frac{2}{15}", "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", "\\sqrt{144} = 12, \\quad 2\\sqrt{5} \\approx 4.47", "A = \\pi r^2 \\geq 68", "7.5 \\times 11 = 82.5\\text{ m}^2"];

test("MathJax's italic alphabet and symbols map to the handwriting font's characters", () => {
  assert.equal(characterFor(0x1d465), "x");
  assert.equal(characterFor(0x1d434), "A");
  assert.equal(characterFor(0x210e), "h");
  assert.equal(characterFor(0x37), "7");
  assert.equal(characterFor(0xd7), "×");
  assert.equal(characterFor(0x2212), "−");
  assert.equal(characterFor(0x2265), "≥");
  assert.equal(characterFor(0x1d70b), "π");
  assert.equal(characterFor(0xa0), null, "a space has no outline");
  assert.equal(characterFor(0x239b), null, "a stretched bracket piece stays MathJax's");
});

test("the glyphs of ordinary school maths are all written by the handwriting font (no textbook glyph is left in them)", () => {
  const identity = (d) => d;
  const box = { minX: 40, maxX: 460, minY: 0, maxY: 660 };
  for (const code of [...Array(10).keys()].map((n) => 0x30 + n).concat([0x1d465, 0x1d466, 0x1d44e, 0x1d44f, 0x1d450, 0x2b, 0x2212, 0x3d, 0x3c, 0x3e, 0xd7, 0xf7, 0x2264, 0x2265, 0x28, 0x29, 0x2e, 0x1d70b])) {
    assert.ok(handGlyph(code, { ...box, maxY: code === 0x3d || code === 0x2212 || code === 0x2b ? 400 : 660, minY: code === 0x3d || code === 0x2212 || code === 0x2b ? 120 : 0 }, (d, m) => `${d}|${m.join(",")}`), `U+${code.toString(16)} is written by hand`);
  }
  assert.equal(handGlyph(0x239b, box, identity), null);
});

test("MathJax still does the layout: the box of a formula is the same in the handwriting as in print, so nothing moves, clips or overlaps", () => {
  for (const tex of FORMULAE) {
    const hand = mathShapes(tex, false, true);
    const print = mathShapes(tex, false, false);
    assert.ok(hand && print, tex);
    assert.equal(hand.width, print.width, `${tex}: same width`);
    assert.equal(hand.ascent, print.ascent);
    assert.equal(hand.descent, print.descent);
    assert.equal(hand.rects.length, print.rects.length, `${tex}: the same fraction bars and root bars`);
    assert.notDeepEqual(hand.paths, print.paths, `${tex}: but the glyphs are not the textbook ones`);
    // Every glyph stays inside the formula's box (a little slack for a handwriting stroke).
    for (const d of hand.paths) {
      const b = boxOfPath(d);
      assert.ok(b.minX >= hand.minX - 120 && b.maxX <= hand.minX + hand.width + 120, `${tex}: a glyph is inside the line's width`);
      assert.ok(b.minY >= -hand.ascent - 150 && b.maxY <= hand.descent + 150, `${tex}: and inside its height`);
    }
  }
});

test("notation stays exact: fractions, roots, powers and units are all still typeset, none is turned into plain text", () => {
  for (const tex of ["\\frac{3}{4}", "\\sqrt{2}", "x^2", "75\\text{ m}^2", "2\\frac{2}{15}"]) {
    const hand = mathShapes(tex, false, true);
    assert.ok(hand, tex);
    assert.ok(hand.paths.length > 0);
  }
  assert.ok(mathShapes("\\frac{3}{4}", false, true).rects.length === 1, "a fraction keeps its bar");
  assert.ok(mathShapes("\\sqrt{2}", false, true).rects.length === 1, "a root keeps the bar over it");
  assert.equal(mathShapes("\\notacommand{", false, true), null, "what MathJax cannot typeset is still refused (the caller writes the source as text)");
  assert.match(penStyle("\\frac{1}{2} + 3"), /^\\displaystyle /, "a line with a fraction is written at full size");
  assert.equal(penStyle("3 + 4"), "3 + 4");
  assert.equal(penStyle("\\displaystyle \\frac{1}{2}"), "\\displaystyle \\frac{1}{2}");
});

const solved = (id, over = {}) => ({
  id, number: id.replace("q", ""), page: 1, text: "x", marks: 4, box: null, answer: { x: 40, y: 80, w: 515, h: 300 }, bands: [{ x: 40, y: 80, w: 515, h: 300 }], answerLine: null, fromText: true,
  transcription: "x", finalAnswer: "Yes", conclusion: "Yes, because 75 m^2 is more than 68 m^2.", explanation: "x", status: "unchecked", statusNote: "",
  steps: [{ say: "Whole rectangle", math: "10 \\times 8 = 80\\text{ m}^2" }, { say: "Missing corner", math: "(10 - 6) \\times (8 - 5) = 12\\text{ m}^2" }, { say: "Floor", math: "80 - 12 = 68\\text{ m}^2" }, { say: "Covers", math: "7.5 \\times 10 = 75\\text{ m}^2" }],
  ...over,
});

async function blankPaper() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return new Uint8Array(await doc.save());
}

test("the three output modes behave as before, with the handwriting: answers on the paper, worked pages, and neither clips nor overlaps", async () => {
  const paper = await blankPaper();
  const filled = await annotatePaper(paper, [solved("q3")], "filled");
  assert.deepEqual(filled.workedPages, [], "filled: the answer fits its space, so no extra page");
  assert.equal(filled.placements.filter((p) => p.kind === "answer").length, 1);
  const hybrid = await annotatePaper(paper, [solved("q3")], "hybrid");
  assert.equal(hybrid.placements.filter((p) => p.kind === "answer").length, 1, "hybrid: the answer is on the paper");
  assert.ok(hybrid.workedPages.length >= 1, "and the full working is on added pages");
  const worked = await annotatePaper(paper, [solved("q3")], "worked");
  assert.equal(worked.placements.length, 0, "worked: the paper is left as it is");
  assert.ok(worked.workedPages.length >= 1);
  for (const placement of [...filled.placements, ...hybrid.placements]) {
    assert.ok(placement.rect.x >= 40 && placement.rect.x + placement.rect.w <= 40 + 515 + 1, "inside the answer space across");
    assert.ok(placement.rect.y >= 80 - 1 && placement.rect.y + placement.rect.h <= 80 + 300 + 1, "and down");
    assert.ok(placement.size >= 11, "never smaller than 11 pt");
  }
  for (const out of [filled, hybrid, worked]) assert.equal((await readPdfDocument(out.pdf, { render: false, maxPages: 20 })).ok, true, "every output opens");
});

test("a conclusion is written on the paper under the answer, with its reason, and on the worked page", async () => {
  const paper = await blankPaper();
  const out = await annotatePaper(paper, [solved("q3")], "filled");
  const read = await readPdfDocument(out.pdf, { render: false, maxPages: 5 });
  assert.ok(read.ok);
  assert.match(read.pages[0].text, /because 75 m² is more than 68 m²/);
  const worked = await annotatePaper(paper, [solved("q3")], "worked");
  const pages = await readPdfDocument(worked.pdf, { render: false, maxPages: 5 });
  assert.match(pages.pages.at(-1).text, /because 75 m² is more than 68 m²/);
});

test("words are written as words: a label before an equals sign is text, and LaTeX that strayed into a sentence is written as the pen would", () => {
  assert.equal(penStyle("Area of left rectangle = 8 \\times 6 = 48\\text{ m}^2"), "\\text{Area of left rectangle} = 8 \\times 6 = 48\\text{ m}^2");
  assert.equal(penStyle("Area = 6 \\times 5 = 30"), "\\text{Area} = 6 \\times 5 = 30");
  assert.equal(penStyle("x = 5"), "x = 5", "a single letter is a variable, not a label");
  assert.equal(penStyle("2x + 1 = 7"), "2x + 1 = 7");
  assert.ok(mathShapes(penStyle("Total paint = 3 \\times 2.5 = 7.5\\text{ litres}")), "and it still typesets");
  assert.equal(prose("Height of right rectangle = 10 - 5 = 5 \\text{ m}"), "Height of right rectangle = 10 - 5 = 5 m");
  assert.equal(prose("No, because 75 m^2 is less than 78 m^{2}. Use \\times and 3 \\geq 2."), "No, because 75 m² is less than 78 m². Use × and 3 ≥ 2.");
  assert.equal(prose("The cube has volume 8 cm^3"), "The cube has volume 8 cm³");
  assert.equal(prose("Plain words stay as they are."), "Plain words stay as they are.");
});
