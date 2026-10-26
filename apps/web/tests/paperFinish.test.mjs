import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { loadTsFrom } from "./_tsLoader.mjs";

// The review findings on the LearnThrive AI brief, each reproduced as a failing test before the fix:
//   1. correct, complete working labelled "partial" because a machine-readable comparison field was missing, and internal field names in the note
//   2. (in paperContext.test.mjs) an old answer overriding a correction
//   3. two model opinions that both say "Yes" counted as agreement though one used a floor of 68 m² and the other 100 m²
//   4. a parent question that is itself a task disappearing into its parts

const { normaliseQuestions, isIndependentTask } = loadTsFrom(import.meta.url, "../src/lib/paper/questionTree.ts");
const { findQuestions } = loadTsFrom(import.meta.url, "../src/lib/paper/questions.ts");
const { extractQuestions, solutionsMarkdown } = loadTsFrom(import.meta.url, "../src/lib/paper/paper.ts");
const { deriveComparison } = loadTsFrom(import.meta.url, "../src/lib/paper/completion.ts");
const { solveQuestion, compareSolutions } = loadTsFrom(import.meta.url, "../src/lib/paper/solve.ts");
const { annotatePaper } = loadTsFrom(import.meta.url, "../src/lib/paper/annotate.ts");
const { readPdfDocument } = loadTsFrom(import.meta.url, "../src/lib/assistant/documents.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");

const FLOOR = "The diagram shows a plan of a floor.\nPetra has 3 tins of paint.\nThere are 2.5 litres of paint in each tin.\nPetra thinks 1 litre of paint will cover 10 m² of floor.";
const PART = "Assuming Petra is correct, does she have enough paint to cover the floor?\nYou must show all your working.";
const q = (number, text, page = 1, extra = {}) => ({ id: `x${number}${page}`, number, page, text, marks: null, box: null, answer: null, bands: [], answerLine: null, fromText: false, ...extra });
const task = (over = {}) => ({ id: "q1", number: "3(a)", page: 1, text: `${FLOOR}\n${PART}`, ownText: PART, stem: FLOOR, group: "3", partLabel: "(a)", marks: 4, box: null, answer: null, bands: [], answerLine: null, fromText: false, ...over });

const INTERNAL = /comparison|final_answer|"conclusion"|\bJSON\b|\bfield\b|schema|\bretry\b|reasoning attempt|\bhave\b.*\bneed\b/i;

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. stem-only parent versus a parent that is a task of its own
// ---------------------------------------------------------------------------------------------------------------------------------

test("what makes a parent a task of its own: it asks something, and does not just introduce its parts", () => {
  assert.equal(isIndependentTask(FLOOR), false, "facts and a diagram description only");
  assert.equal(isIndependentTask("Sam buys 3 pens at 2 pounds each."), false);
  assert.equal(isIndependentTask("Here is a rule: multiply by 2, then add 1."), false);
  assert.equal(isIndependentTask("Work out:"), false, "a command that ends in a colon is shared by its parts");
  assert.equal(isIndependentTask("Work out 2 + 3. (1)"), true);
  assert.equal(isIndependentTask("Is 7 a prime number? Give a reason."), true);
  assert.equal(isIndependentTask("Here are two numbers, 4 and 7. Find their sum."), true);
  assert.equal(isIndependentTask("Write down the next term of 2, 4, 6, 8."), true);
  assert.equal(isIndependentTask(""), false);
});

test("a stem-only 3 stays context for 3(a); a 3 that asks its own question is solved alongside its parts, with distinct stable ids", () => {
  const stemOnly = normaliseQuestions([q("3", FLOOR), q("3(a)", PART)]);
  assert.deepEqual(stemOnly.map((t) => t.number), ["3(a)"], "no duplicate selectable task");
  const both = normaliseQuestions([q("3", "Here are two numbers, 4 and 7. Find their sum. (1)"), q("3(a)", "Find the product of the two numbers. (1)"), q("3(b)", "Find the difference. (1)"), q("4", "Work out 5 + 6. (1)")]);
  assert.deepEqual(both.map((t) => t.number), ["3", "3(a)", "3(b)", "4"], "the parent is a task, in paper order, before its parts");
  assert.equal(both[0].text, "Here are two numbers, 4 and 7. Find their sum. (1)", "the parent's own words, without its parts'");
  assert.equal(both[0].stem, undefined);
  assert.ok(both[1].text.startsWith("Here are two numbers"), "and its parts still carry it as their context");
  assert.ok(both.every((t) => t.group === (t.number === "4" ? "4" : "3")));
  // The same answer when it is run twice.
  assert.deepEqual(normaliseQuestions(both).map((t) => [t.number, t.text]), both.map((t) => [t.number, t.text]));
});

test("the same rule for a text layer: the parent that asks something is found as a task, the stem-only parent is not", () => {
  const page = (rows) => ({ number: 1, text: rows.map((r) => r[0]).join("\n"), textQuality: "good", hasPictures: false, stackedMaths: false, image: null, lines: rows.map(([text, y]) => ({ text, x: 72, y, w: 400, h: 12 })), width: 595, height: 842, rotation: 0, originX: 0, originY: 0 });
  const found = findQuestions([page([["3 Work out 2 + 3. (1)", 780], ["(a) Work out 4 + 5. (1)", 700], ["(b) Work out 6 + 7. (1)", 620]])]);
  assert.deepEqual(found.map((t) => [t.number, t.marks]), [["3", 1], ["3(a)", 1], ["3(b)", 1]]);
  assert.equal(found[0].ownText, "Work out 2 + 3. (1)");
  const stem = findQuestions([page([["3 The diagram shows a plan of a floor.", 780], ["Petra has 3 tins of paint.", 762], ["(a) Does she have enough paint? (4)", 700]])]);
  assert.deepEqual(stem.map((t) => t.number), ["3(a)"]);
  assert.deepEqual(normaliseQuestions(found).map((t) => t.number), ["3", "3(a)", "3(b)"], "normalising does not lose it either");
});

test("through the reader, selection and ids: a PDF with an independent parent lists it once, with its own id", async () => {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  for (const [text, y] of [["3 Work out 2 + 3. (1)", 780], ["(a) Work out 4 + 5. (1)", 700], ["4 The diagram shows a plan of a floor.", 600], ["Petra has 3 tins of paint.", 582], ["(a) Does she have enough paint? (4)", 520]]) page.drawText(text, { x: 72, y, size: 11, font });
  const doc = await extractQuestions(null, new Uint8Array(await pdf.save()));
  assert.ok(!("problem" in doc));
  assert.deepEqual(doc.questions.map((x) => [x.id, x.number]), [["q1", "3"], ["q2", "3(a)"], ["q3", "4(a)"]]);
  assert.equal(new Set(doc.questions.map((x) => x.id)).size, 3);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. complete working is not "partial" because a structured field is missing
// ---------------------------------------------------------------------------------------------------------------------------------

const good = (over = {}) => ({
  transcription: `${FLOOR}\n${PART}`,
  givens: ["top edge 10 m", "left edge 8 m", "right edge 5 m", "bottom edge 6 m"],
  final_answer: "Yes",
  conclusion: "Yes, because 75 m^2 is more than 68 m^2.",
  comparison: { have: "75 m^2", need: "68 m^2", relation: ">=" },
  steps: [
    { say: "Area of the whole rectangle", math: "10 \\times 8 = 80\\text{ m}^2" },
    { say: "Area of the missing corner", math: "(10 - 6) \\times (8 - 5) = 4 \\times 3 = 12\\text{ m}^2" },
    { say: "Floor area", math: "80 - 12 = 68\\text{ m}^2" },
    { say: "Paint she has", math: "3 \\times 2.5 = 7.5\\text{ litres}" },
    { say: "Area the paint covers", math: "7.5 \\times 10 = 75\\text{ m}^2" },
    { say: "Compare", math: "75\\text{ m}^2 > 68\\text{ m}^2" },
  ],
  explanation: "Subtract the missing corner from the full rectangle, then compare with what the paint covers.",
  assumptions: [],
  confidence: "medium",
  check: { kind: "none" },
  ...over,
});

class Script extends MockProvider {
  constructor(replies, repair = null) {
    super({ delayMs: 0 });
    this.replies = [...replies];
    this.repair = repair;
    this.calls = [];
    this.repairs = [];
  }
  async *stream(messages, options) {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const send = function* (value) {
      yield { type: "text", text: JSON.stringify(value) };
      yield { type: "done" };
    };
    if (options.json && system.startsWith("You write worked solutions")) {
      this.calls.push({ messages, options });
      return yield* send(this.replies.length > 1 ? this.replies.shift() : this.replies[0]);
    }
    if (options.json && system.startsWith("A worked solution is given.")) {
      this.repairs.push({ messages, options });
      return yield* send(this.repair ?? { comparison: null });
    }
    yield* super.stream(messages, options);
  }
}
const deps = (provider, over = {}) => ({ provider, queue: new GenerationQueue(1, 5), model: "mock", visionModel: "mock", contextSize: 6144, maxTokens: 1700, reasoningTokens: 3300, crossCheck: false, ...over });

test("the structured comparison is read from working that already compares the figures, not demanded again", () => {
  const without = good({ comparison: null });
  assert.deepEqual(deriveComparison(task(), without), { have: "75 m^2", need: "68 m^2" });
  // A "No": the larger figure is what is needed.
  const no = good({ comparison: null, final_answer: "No", conclusion: "No, because 60 m^2 is less than 68 m^2.", steps: [...good().steps.slice(0, 3), { say: "Paint covers", math: "6 \\times 10 = 60\\text{ m}^2" }, { say: "Compare", math: "60\\text{ m}^2 < 68\\text{ m}^2" }] });
  assert.deepEqual(deriveComparison(task(), no), { have: "60 m^2", need: "68 m^2" });
  // Not derivable: nothing is assumed.
  assert.equal(deriveComparison(task(), good({ comparison: null, conclusion: "Yes, she has enough paint.", steps: good().steps.slice(0, 5) })), null);
  // Operands in different units are not a comparison.
  assert.equal(deriveComparison(task(), good({ comparison: null, steps: [...good().steps.slice(0, 5), { math: "7.5\\text{ litres} > 68\\text{ m}^2" }] })), null);
});

test("complete working with the comparison only in its steps is solved, not 'partial', and says nothing internal", async () => {
  const provider = new Script([good({ comparison: null })]);
  const solved = await solveQuestion(deps(provider), task(), "UElDVFVSRQ==");
  assert.equal(provider.calls.length, 1, "no retry for a field the working already evidences");
  assert.equal(provider.repairs.length, 0, "and no repair call");
  assert.equal(solved.status, "unchecked");
  assert.equal(solved.finalAnswer, "Yes");
  assert.deepEqual(solved.comparison, { have: "75 m^2", need: "68 m^2" });
  assert.ok(solved.evidence.includes("comparison_derived"));
  assert.ok(!solved.evidence.some((e) => e.startsWith("issue:")));
  assert.doesNotMatch(`${solved.statusNote} ${solved.explanation}`, INTERNAL);
});

test("when the comparison cannot be read from the working, one bounded repair is asked for; if that gives nothing the answer still stands, as unchecked", async () => {
  const ambiguous = good({ comparison: null, conclusion: "Yes, she has enough paint to cover the floor because the paint covers more than the floor.", steps: good().steps.slice(0, 5) });
  const repaired = new Script([ambiguous], { comparison: { have: "75 m^2", need: "68 m^2", relation: ">=" } });
  const a = await solveQuestion(deps(repaired), task(), "UElDVFVSRQ==");
  assert.equal(repaired.repairs.length, 1, "bounded: one repair call");
  assert.equal(repaired.calls.length, 1);
  assert.equal(a.status, "unchecked");
  assert.deepEqual(a.comparison, { have: "75 m^2", need: "68 m^2" });
  assert.ok(a.evidence.includes("comparison_repaired"));
  // A repair that invents a figure the working never shows is refused.
  const invented = new Script([ambiguous], { comparison: { have: "99 m^2", need: "68 m^2" } });
  const b = await solveQuestion(deps(invented), task(), "UElDVFVSRQ==");
  assert.equal(b.status, "unchecked", "complete working is not partial because a field could not be filled");
  assert.equal(b.comparison, undefined, "and the refused figures were not adopted");
  assert.ok(b.evidence.includes("comparison_not_structured"));
  assert.doesNotMatch(`${b.statusNote} ${b.explanation}`, INTERNAL);
  const none = await solveQuestion(deps(new Script([ambiguous])), task(), "UElDVFVSRQ==");
  assert.equal(none.status, "unchecked");
  assert.equal(none.finalAnswer, "Yes");
});

test("genuinely incomplete work is still partial, in words a student can use", async () => {
  const bare = good({ comparison: null, conclusion: "", steps: [{ say: "Calculate the floor area." }, { say: "Calculate the paint." }, { say: "Compare them." }] });
  const solved = await solveQuestion(deps(new Script([bare])), task(), "UElDVFVSRQ==");
  assert.equal(solved.status, "partial");
  assert.doesNotMatch(solved.statusNote, INTERNAL, solved.statusNote);
  assert.match(solved.statusNote, /calculation|working|steps/i, "it says what is missing, plainly");
  // The same with the other kinds of genuine gap.
  for (const gap of [good({ conclusion: "" }), good({ steps: [{ say: "Floor", math: "80 - 12 = 70\\text{ m}^2" }, ...good().steps.slice(3)] }), good({ final_answer: "6.8" })]) {
    const s = await solveQuestion(deps(new Script([gap])), task(), "UElDVFVSRQ==");
    assert.doesNotMatch(`${s.statusNote} ${s.explanation}`, INTERNAL, `${s.status}: ${s.statusNote}`);
  }
});

test("nothing internal reaches the student in the PDF, the chat summary or the panel: only plain explanations", async () => {
  const bare = good({ comparison: null, conclusion: "", steps: [{ say: "Calculate the floor area." }, { say: "Calculate the paint." }, { say: "Compare them." }] });
  const solved = await solveQuestion(deps(new Script([bare])), task({ number: "3(a)" }), "UElDVFVSRQ==");
  assert.equal(solved.status, "partial");
  const blank = await PDFDocument.create();
  blank.addPage([595, 842]);
  const bytes = new Uint8Array(await blank.save());
  for (const mode of ["filled", "hybrid", "worked"]) {
    const out = await annotatePaper(bytes, [{ ...solved, answer: { x: 40, y: 80, w: 515, h: 300 }, bands: [{ x: 40, y: 80, w: 515, h: 300 }], fromText: true }], mode);
    const read = await readPdfDocument(out.pdf, { render: false, maxPages: 5 });
    const text = read.pages.map((p) => p.text).join("\n");
    assert.doesNotMatch(text, INTERNAL, `${mode}: ${text.slice(0, 300)}`);
  }
  assert.doesNotMatch(solutionsMarkdown([solved]), INTERNAL);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. two opinions that both say Yes are not agreement
// ---------------------------------------------------------------------------------------------------------------------------------

/** Another reading of the same floor: the same "Yes", but a floor of 100 m² and a paint coverage to match. */
const sameYesOtherAreas = () =>
  good({
    conclusion: "Yes, because 150 m^2 is more than 100 m^2.",
    comparison: { have: "150 m^2", need: "100 m^2", relation: ">=" },
    steps: [{ say: "Floor area", math: "10 \\times 10 = 100\\text{ m}^2" }, { say: "Paint", math: "3 \\times 2.5 = 7.5\\text{ litres}" }, { say: "Covers", math: "7.5 \\times 20 = 150\\text{ m}^2" }, { say: "Compare", math: "150\\text{ m}^2 > 100\\text{ m}^2" }],
  });
const otherMethod = () =>
  good({
    steps: [{ say: "Left part", math: "8 \\times 6 = 48\\text{ m}^2" }, { say: "Right part", math: "(10 - 6) \\times 5 = 20\\text{ m}^2" }, { say: "Floor area", math: "48 + 20 = 68\\text{ m}^2" }, { say: "Paint", math: "3 \\times 2.5 = 7.5\\text{ litres}" }, { say: "Covers", math: "7.5 \\times 10 = 75\\text{ m}^2" }, { say: "Compare", math: "75\\text{ m}^2 > 68\\text{ m}^2" }],
  });
const litresMethod = () =>
  good({
    conclusion: "Yes, because she needs 6.8 litres and has 7.5 litres.",
    comparison: { have: "7.5 litres", need: "6.8 litres", relation: ">=" },
    steps: [{ say: "Floor area", math: "80 - 12 = 68\\text{ m}^2" }, { say: "Litres needed", math: "68 \\div 10 = 6.8\\text{ litres}" }, { say: "Litres she has", math: "3 \\times 2.5 = 7.5\\text{ litres}" }, { say: "Compare", math: "7.5\\text{ litres} > 6.8\\text{ litres}" }],
  });

test("the same Yes with different areas is a disagreement; different correct methods to the same facts agree", () => {
  const same = compareSolutions(good(), sameYesOtherAreas());
  assert.equal(same.agree, false, "68 against 100 is not agreement, however alike the Yes");
  assert.match(same.differences.join(" "), /68/);
  assert.match(same.differences.join(" "), /100/);
  const equivalent = compareSolutions(good(), otherMethod());
  assert.equal(equivalent.agree, true, equivalent.differences.join("; "));
  assert.equal(equivalent.basis, "figures");
  const crossUnits = compareSolutions(good(), litresMethod());
  assert.equal(crossUnits.agree, true, "areas against litres: each is judged on its own figures, and the decision is the same");
  assert.equal(crossUnits.basis, "decision", "which is weaker evidence, and said so");
  assert.equal(compareSolutions(good(), good({ final_answer: "No", conclusion: "No, because 60 m^2 is less than 68 m^2.", comparison: { have: "60 m^2", need: "68 m^2" } })).agree, false);
  assert.equal(compareSolutions(good({ final_answer: "68\\text{ m}^2", conclusion: "", comparison: null }), good({ final_answer: "100\\text{ m}^2", conclusion: "", comparison: null })).agree, false, "numeric answers by value");
  assert.equal(compareSolutions(good({ final_answer: "6.18", comparison: null }), good({ final_answer: "6.1818", comparison: null })).agree, true, "a stated rounding is the same value");
});

test("a second 'Yes' with a different floor is not approval: it triggers a bounded review, and nothing is shown as agreed unless two readings really agree", async () => {
  const review = new Script([good(), sameYesOtherAreas(), good()]);
  const solved = await solveQuestion(deps(review, { crossCheck: true }), task(), "UElDVFVSRQ==");
  assert.equal(review.calls.length, 3, "bounded: first, second, and one review");
  const told = review.calls[2].messages.at(-1).content;
  assert.match(told, /68/);
  assert.match(told, /100/);
  assert.match(told, /disagree/i, "the review is told exactly what the two readings differ on");
  assert.equal(solved.finalAnswer, "Yes");
  assert.match(solved.statusNote, /Two of three/);
  assert.doesNotMatch(solved.statusNote, /same answer\.$/);
  assert.equal(solved.status, "unchecked", "supporting evidence, never proof");
  assert.match(solved.statusNote, /evidence|not checked|look/i);
  // No two of three agree on the facts: nothing is presented as the answer.
  const third = good({ steps: [{ say: "Floor", math: "9 \\times 9 = 81\\text{ m}^2" }, { say: "Covers", math: "7.5 \\times 20 = 150\\text{ m}^2" }, { say: "Compare", math: "150\\text{ m}^2 > 81\\text{ m}^2" }], conclusion: "Yes, because 150 m^2 is more than 81 m^2.", comparison: { have: "150 m^2", need: "81 m^2" } });
  const fourth = good({ steps: [{ say: "Floor", math: "7 \\times 7 = 49\\text{ m}^2" }, { say: "Covers", math: "7.5 \\times 20 = 150\\text{ m}^2" }, { say: "Compare", math: "150\\text{ m}^2 > 49\\text{ m}^2" }], conclusion: "Yes, because 150 m^2 is more than 49 m^2.", comparison: { have: "150 m^2", need: "49 m^2" } });
  const more = (n) => good({ steps: [{ say: "Floor", math: `${n} \\times ${n} = ${n * n}\\text{ m}^2` }, { say: "Covers", math: "7.5 \\times 20 = 150\\text{ m}^2" }, { say: "Compare", math: `150\\text{ m}^2 > ${n * n}\\text{ m}^2` }], conclusion: `Yes, because 150 m^2 is more than ${n * n} m^2.`, comparison: { have: "150 m^2", need: `${n * n} m^2` } });
  const split = new Script([good(), sameYesOtherAreas(), third, fourth, more(6), more(5)]);
  const unresolved = await solveQuestion(deps(split, { crossCheck: true }), task(), "UElDVFVSRQ==");
  assert.equal(unresolved.status, "partial");
  assert.equal(unresolved.finalAnswer, "");
  assert.doesNotMatch(unresolved.statusNote, INTERNAL);
  assert.match(unresolved.statusNote, /different answers|did not agree|disagree/i);
});

test("two readings that agree on the figures are said to agree, but only as supporting evidence", async () => {
  const provider = new Script([good(), otherMethod()]);
  const solved = await solveQuestion(deps(provider, { crossCheck: true }), task(), "UElDVFVSRQ==");
  assert.equal(provider.calls.length, 2);
  assert.equal(solved.status, "unchecked");
  assert.match(solved.statusNote, /second, independent attempt reached the same/);
  assert.ok(solved.evidence.includes("independent_attempt_agrees"));
});
