import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The regression examples that decide whether "verified" means anything: what a substitution check cannot prove must not be called proved.

const { verify } = loadTsFrom(import.meta.url, "../src/lib/paper/solve.ts");
const ev = loadTsFrom(import.meta.url, "../src/lib/paper/mathsEvidence.ts");
const { equivalent } = loadTsFrom(import.meta.url, "../src/lib/paper/maths.ts");

const q = (text, over = {}) => ({ id: "q1", number: "1", page: 1, text, marks: null, box: null, answer: null, bands: [], answerLine: null, fromText: true, ...over });
const sol = (over = {}) => ({ transcription: "", final_answer: "", steps: [], explanation: "", assumptions: [], confidence: "high", check: { kind: "none" }, ...over });

test("x^2 = 4 answered x = 2 is NOT verified: the answer works, but it is not the whole solution set", () => {
  const question = q("Solve x^2 = 4.");
  const half = verify(question, sol({ final_answer: "x = 2" }));
  assert.equal(half.status, "failed");
  assert.match(half.detail, /-2/, "the retry is told what is missing");
  assert.ok(half.evidence.includes("solution_set_incomplete"));
  assert.equal(verify(question, sol({ final_answer: "x = 2 or x = -2" })).status, "verified");
  assert.equal(verify(question, sol({ final_answer: "x = 2, x = -2" })).status, "verified");
  assert.equal(verify(question, sol({ final_answer: "x = -2" })).status, "failed");
  assert.equal(verify(question, sol({ final_answer: "x = 3" })).status, "failed");
});

test("quadratics and cubics: every real root is needed, repeated roots count once, no real roots is not a solution", () => {
  const roots = (e) => ev.solutionsOf(e)?.roots.map((r) => Number(r.toFixed(6)));
  assert.deepEqual(roots("x^2 - 5x + 6 = 0"), [2, 3]);
  assert.deepEqual(roots("x^2 - 6x + 9 = 0"), [3]);
  assert.deepEqual(roots("x^3 - x = 0"), [-1, 0, 1]);
  assert.deepEqual(roots("x^4 = 16"), [-2, 2]);
  assert.deepEqual(roots("2x + 7 = 19"), [6]);
  assert.deepEqual(roots("x^2 + 1 = 0"), [], "no real solutions");
  assert.equal(ev.solutionsOf("x^2 + y = 3"), null, "two unknowns is not decided here");
  assert.equal(ev.solutionsOf("1/x = 4"), null, "a rational equation is not claimed to be polynomial");
  assert.equal(verify(q("Solve x^2 - 5x + 6 = 0"), sol({ final_answer: "x = 2" })).status, "failed");
  assert.equal(verify(q("Solve x^2 - 5x + 6 = 0"), sol({ final_answer: "x = 2 or x = 3" })).status, "verified");
  assert.equal(verify(q("Solve (x - 1)(x - 2)(x - 3) = 0"), sol({ final_answer: "x = 1 or x = 2" })).status, "failed");
});

test("a linear equation's one answer is complete; the usual GCSE equations still verify", () => {
  assert.equal(verify(q("Solve 2x + 7 = 19. Give the value of x."), sol({ final_answer: "6" })).status, "verified");
  assert.equal(verify(q("Solve 3(x - 2) = 12"), sol({ final_answer: "x = 6" })).status, "verified");
  assert.equal(verify(q("Solve 2x + 7 = 19"), sol({ final_answer: "5" })).status, "failed");
});

test("domain restrictions: a root that makes a denominator zero is extraneous, and a rational equation is not called complete", () => {
  assert.equal(ev.completeness("1/(x - 2) = 3/(x - 2)", [2]), "undefined_at_answer");
  assert.equal(ev.completeness("(x^2 - 4)/(x - 2) = 4", [2]), "undefined_at_answer", "the extraneous root of a cancelled fraction");
  assert.equal(ev.completeness("1/x = 4", [0.25]), "unknown", "it works, but completeness is not decided");
  assert.equal(verify(q("Solve 1/x = 4"), sol({ final_answer: "x = 0.25" })).status, "unchecked", "not 'verified'");
  assert.equal(verify(q("Solve sqrt(x) = -3"), sol({ final_answer: "x = 9" })).status, "failed");
});

test("exact fractions versus rounded decimals, and the precision the question asks for", () => {
  assert.equal(ev.checkForm("Work out 1/3.", "0.3333333333", 1 / 3).ok, false, "a rounded decimal for an exact value");
  assert.equal(ev.checkForm("Work out 1/3.", "\\frac{1}{3}", 1 / 3).ok, true);
  assert.equal(ev.checkForm("Work out 1/4.", "0.25", 0.25).ok, true, "a terminating decimal is exact");
  assert.equal(ev.checkForm("Work out 1/3. Give your answer to 2 decimal places.", "0.33", 1 / 3).ok, true);
  assert.equal(ev.checkForm("Work out 1/3. Give your answer to 2 decimal places.", "0.3", 1 / 3).ok, false, "too few places");
  assert.equal(ev.checkForm("Work out 2/3. Give your answer to 2 decimal places.", "0.66", 2 / 3).ok, false, "truncated, not rounded");
  assert.equal(ev.checkForm("Work out 2/3 to 3 significant figures.", "0.667", 2 / 3).ok, true);
  assert.equal(ev.checkForm("Work out 2/3 to 3 significant figures.", "0.66", 2 / 3).ok, false);
  const wrongForm = verify(q("Work out 5/6."), sol({ final_answer: "0.8333333333" }));
  assert.equal(wrongForm.status, "failed");
  assert.match(wrongForm.note, /exact/i);
  assert.equal(verify(q("Work out 5/6."), sol({ final_answer: "\\frac{5}{6}" })).status, "verified");
  assert.equal(verify(q("Work out 5/6. Give your answer to 2 decimal places."), sol({ final_answer: "0.83" })).status, "verified");
});

test("a correct final answer with invalid working is left for review, not 'verified'; valid working through a different method passes", () => {
  const question = q("Solve 2x + 7 = 19. Give the value of x.");
  const good = verify(question, sol({ final_answer: "6", steps: [{ say: "Take 7", math: "2x = 12" }, { say: "Divide by 2", math: "x = 6" }] }));
  assert.equal(good.status, "verified");
  assert.ok(good.evidence.includes("working_consistent"));
  const bad = verify(question, sol({ final_answer: "6", steps: [{ math: "2x = 14" }, { math: "x = 6" }] }));
  assert.equal(bad.status, "unchecked");
  assert.match(bad.note, /step 2/);
  assert.ok(bad.evidence.includes("working_flawed"));
  const arithmetic = verify(question, sol({ final_answer: "6", steps: [{ math: "19 - 7 = 13" }, { math: "13 / 2 = 6.5" }, { math: "x = 6" }] }));
  assert.equal(arithmetic.status, "unchecked", "an arithmetic slip in the working");
  // Another route to the same answer: trial and improvement style lines are not judged as equations, so a correct different method is not penalised.
  const other = verify(question, sol({ final_answer: "6", steps: [{ math: "2 \\times 6 + 7 = 19" }, { math: "x = 6" }] }));
  assert.equal(other.status, "verified");
  assert.deepEqual(ev.checkWorking([{ math: "3(x + 4) = 24" }, { math: "3x + 12 = 24" }, { math: "3x = 14" }]), { checked: 2, flawed: [2] }, "a step that changes the solution");
  assert.deepEqual(ev.checkWorking([{ math: "3(x + 4) = 3x + 12 = 3x + 13" }]), { checked: 1, flawed: [0] }, "a chain that is not an identity");
  assert.deepEqual(ev.checkWorking([{ math: "the decimal point moves" }, { math: "" }]), { checked: 0, flawed: [] }, "a line that cannot be read is skipped, not failed");
});

test("a wrong answer that happens to pass a few sampled points is caught: the extra points come from the expressions themselves", () => {
  // A deliberately built impostor: it equals x^2 - 3x + 2 at the six fixed spot values (so the old check passed it) but not elsewhere.
  const spots = [1.37, -2.71, 0.53, 3.19, -0.87, 5.41];
  const vanishing = spots.map((s) => `(x - ${s})`).join("");
  assert.equal(equivalent("x^2 - 3x + 2", `x^2 - 3x + 2 + 0.001${vanishing}`), false);
  assert.equal(equivalent("(x - 1)(x - 2)", "x^2 - 3x + 2"), true, "real equivalents are still equal");
  assert.equal(equivalent("(x + 1)^3", "x^3 + 3x^2 + 3x + 1"), true);
  assert.equal(equivalent("(x + 1)^3", "x^3 + 3x^2 + 3x + 2"), false);
  assert.equal(equivalent("x^2 - 1", "(x - 1)(x + 1)"), true);
});

test("what the checker cannot decide stays unchecked: words, diagrams and proofs are never verified", () => {
  assert.equal(verify(q("Prove that the sum of two odd numbers is even."), sol({ final_answer: "even" })).status, "unchecked");
  assert.equal(verify(q("Find the size of angle ABC."), sol({ final_answer: "52^\\circ" })).status, "unchecked");
  assert.equal(verify(q("Solve 2x + 7 = 19"), sol({ final_answer: "", confidence: "low" })).status, "unsolved");
});

test("a scan's reading is a different kind of evidence from the printed question, and the status says which", () => {
  const scanned = q("Solve 2x + 7 = 19", { fromText: false });
  const verdict = verify(scanned, sol({ final_answer: "6", check: { kind: "solve", equations: ["2x + 7 = 19"], answer: "x = 6" } }));
  assert.equal(verdict.status, "checked_reading");
});

test("found by the benchmark: marks printed after a question are not maths, a part's own words come before its stem, and 'x' between numbers is times", () => {
  // "Solve x^2 = 4 (2)": the (2) marks must not turn the equation into x^2 = 4 x 2.
  const half = verify(q("Solve x^2 = 4 (2)"), sol({ final_answer: "x = 2" }));
  assert.equal(half.status, "failed");
  assert.match(half.detail, /-2/, "the reason is the missing solution, not a broken equation");
  assert.equal(verify(q("Solve x^2 = 4 [2 marks]"), sol({ final_answer: "x = 2 or x = -2" })).status, "verified");
  // 2(b)(i): the stem says "Expand each expression", the part says what to expand.
  const part = q("(b) Expand each expression.\nExpand 3(x + 4) (1)", { ownText: "Expand 3(x + 4) (1)", stem: "(b) Expand each expression." });
  assert.equal(verify(part, sol({ final_answer: "3x + 12" })).status, "verified");
  assert.equal(verify(part, sol({ final_answer: "3x + 4" })).status, "failed");
  // A part with nothing to check of its own takes the equation from the stem it shares.
  const shared = q("x^2 - 5x + 6 = 0\nSolve it.", { ownText: "Solve it.", stem: "x^2 - 5x + 6 = 0" });
  assert.equal(verify(shared, sol({ final_answer: "x = 2" })).status, "failed");
  assert.equal(verify(shared, sol({ final_answer: "x = 2 or x = 3" })).status, "verified");
  assert.equal(verify(q("Work out 12 x 7 (1)"), sol({ final_answer: "84" })).status, "verified");
  assert.equal(verify(q("Work out 12 x 7 (1)"), sol({ final_answer: "74" })).status, "failed");
  // A working line that lists the solutions is not a chain of equal expressions.
  assert.deepEqual(ev.checkWorking([{ math: "x = 3 or x = 2" }, { math: "x = \pm 2" }, { math: "x < 5, x > 1" }]), { checked: 0, flawed: [] });
});
