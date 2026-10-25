import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The deterministic checks a reply's working goes through before a hard STEM answer is shown (src/lib/assistant/checks): small, fixed engineering
// cases, not an educational benchmark. Each case is a mistake the checker must find, or correct work it must leave alone.

const maths = loadTsFrom(import.meta.url, "../src/lib/assistant/checks/maths.ts");
const chem = loadTsFrom(import.meta.url, "../src/lib/assistant/checks/chemistry.ts");
const evidence = loadTsFrom(import.meta.url, "../src/lib/assistant/checks/evidence.ts");

test("working: correct steps, chains, substitutions and roundings pass; nothing is called wrong that cannot be decided", () => {
  const good = [
    "$$2x + 7 = 19$$",
    "$$2x = 12$$",
    "$$x = 6$$",
    "",
    "\\[ x^2 - 5x + 6 = (x - 2)(x - 3) \\]",
    "$$v = u + at = 0 + 9.8 \\times 3 = 29.4 \\text{ m/s}$$",
    "$$A = \\pi r^2 = \\pi \\times 3^2 = 28.27 \\text{ cm}^2$$",
    "$$\\frac{1}{2} + \\frac{1}{3} = \\frac{5}{6}$$",
    "$$x^2 = 9$$",
    "$$x = 3$$",
    "$$x = 3 \\text{ or } x = -3$$",
    "$$\\sin 30^\\circ = 0.5$$",
    "$$3.2 \\times 10^{4} = 32000$$",
  ].join("\n");
  const r = maths.checkWorkingLines(good);
  assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
  assert.ok(r.checked >= 6, `lines checked: ${r.checked}`);
});

test("working: a false line of arithmetic, a wrong identity and a step that gains a solution are found", () => {
  const r = maths.checkWorkingLines(["$$\\frac{1}{2} + \\frac{1}{3} = \\frac{2}{5}$$", "", "Expanding:", "$$(x + 3)^2 = x^2 + 9 = x^2 + 9$$", "", "Solving:", "$$2x + 7 = 19$$", "$$2x = 14$$", "$$x = 7$$"].join("\n"));
  assert.equal(r.findings.length, 3, JSON.stringify(r.findings));
  assert.match(r.findings[0].problem, /0\.833333, not/);
  assert.match(r.findings[1].problem, /not equal for every value of x/);
  assert.match(r.findings[2].problem, /does not follow/);
  assert.ok(r.findings.every((f) => f.status === "CONTRADICTED"));
});

test("working: prose between lines breaks a run, and a rounding written to its figures is accepted while a wrong one is not", () => {
  const separate = maths.checkWorkingLines(["(a)", "$$2x = 8$$", "$$x = 4$$", "(b) Now the second part.", "$$x + 1 = 10$$", "$$x = 9$$"].join("\n"));
  assert.deepEqual(separate.findings, [], "two questions are two runs");
  assert.deepEqual(maths.checkWorkingLines("$$22 \\div 7 = 3.14$$").findings, []);
  assert.equal(maths.checkWorkingLines("$$22 \\div 7 = 3.24$$").findings.length, 1);
  assert.deepEqual(maths.checkWorkingLines("$$100 \\div 3 \\approx 33.3$$").findings, [], "an approximation is not judged");
});

test("equations: balanced equations, ions, electrons, hydrates and state symbols pass", () => {
  const good = [
    "The reaction is 2H2 + O2 → 2H2O.",
    "$\\ce{CH4 + 2O2 -> CO2 + 2H2O}$",
    "Half equation: Cu^{2+} + 2e^- → Cu",
    "CuSO₄·5H₂O → CuSO₄ + 5H₂O",
    "Ca(OH)2(aq) + 2HCl(aq) → CaCl2(aq) + 2H2O(l)",
    "Na+ + Cl- → NaCl",
  ].join("\n");
  const r = chem.checkEquations(good);
  assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
  assert.equal(r.checked, 6);
});

test("equations: an unbalanced equation or charge is found; word equations and ambiguous charges are left alone", () => {
  const r = chem.checkEquations(["Burning methane: CH4 + O2 → CO2 + H2O", "Fe^{3+} + e^- → Fe", "methane + oxygen → carbon dioxide + water", "Fe3+ + 3e- → Fe"].join("\n"));
  assert.equal(r.findings.length, 2, JSON.stringify(r.findings));
  assert.match(r.findings[0].problem, /H: 4 on the left, 2 on the right/);
  assert.match(r.findings[1].problem, /charge: 2 on the left, 0 on the right/);
  assert.equal(r.checked, 2, "the word equation and the ambiguous Fe3+ are not read");
});

test("evidence statuses: a revision site or a near miss is never VERIFIED, and only wrong or absent evidence is acted on", () => {
  assert.equal(evidence.quoteEvidence("verified_exact"), "VERIFIED");
  assert.equal(evidence.quoteEvidence("supported_secondary"), "SUPPORTED");
  assert.equal(evidence.quoteEvidence("incorrect_attribution"), "CONTRADICTED");
  assert.equal(evidence.quoteEvidence("paraphrase_or_misquote"), "CONTRADICTED");
  assert.equal(evidence.quoteEvidence("unsupported"), "UNSUPPORTED");
  assert.equal(evidence.quoteEvidence("unverifiable"), "UNVERIFIABLE");
  assert.equal(evidence.claimEvidence("contradicted"), "CONTRADICTED");
  assert.equal(evidence.actionable("UNVERIFIABLE"), false);
  assert.equal(evidence.actionable("SUPPORTED"), false);
  assert.equal(evidence.actionable("CONTRADICTED"), true);
});
