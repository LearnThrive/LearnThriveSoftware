import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The Paper Tutor's maths checker: what "verified" rests on, so it is tested for what it accepts AND what it refuses.

const m = loadTsFrom(import.meta.url, "../src/lib/paper/maths.ts");

test("evaluates school arithmetic in plain text and LaTeX", () => {
  assert.equal(m.evaluate("3/4 + 1/8"), 0.875);
  assert.equal(m.evaluate("\\frac{3}{4} + \\frac{1}{8}"), 0.875);
  assert.equal(m.evaluate("2^3 \\times 5"), 40);
  assert.equal(m.evaluate("80 - 15\\% \\times 80"), 68);
  assert.equal(m.evaluate("\\sqrt{144}"), 12);
  assert.ok(m.sameValue(m.evaluate("5.2 \\times 10^{-4}"), 0.00052));
  assert.equal(m.evaluate("−3 + 7"), 4, "a typographic minus");
  assert.equal(m.evaluate("1,000 / 8"), 125, "a thousands separator");
  assert.ok(Math.abs(m.evaluate("\\pi \\times 5^2") - 78.5398) < 1e-3);
  assert.equal(m.evaluate("2x + 3", { x: 4 }), 11, "implied multiplication");
  assert.equal(m.evaluate("3(x + 1)", { x: 2 }), 9);
  assert.equal(m.evaluate("(x + 2)(x + 3)", { x: 1 }), 12);
});

test("refuses what it cannot read instead of guessing", () => {
  for (const bad of ["", "3 +", "(2 + 3", "2 ** 3", "x = 4", "let me think", "3 # 4"]) assert.equal(m.evaluate(bad), null, bad);
  assert.equal(m.evaluate("2x + 1"), null, "a variable with no value");
});

test("equivalence: expansion, factorising and simplifying are confirmed, wrong forms are not", () => {
  assert.equal(m.equivalent("x^2 + 5x + 6", "(x + 2)(x + 3)"), true);
  assert.equal(m.equivalent("x^2 + 5x + 6", "(x + 1)(x + 6)"), false);
  assert.equal(m.equivalent("3(x + 4)", "3x + 12"), true);
  assert.equal(m.equivalent("3(x + 4)", "3x + 4"), false);
  assert.equal(m.equivalent("x^5 \\times x^3", "x^8"), true);
  assert.equal(m.equivalent("x^5 \\times x^3", "x^{15}"), false);
  assert.equal(m.equivalent("2x + 3y - x", "x + 3y"), true);
  assert.equal(m.equivalent("2x +", "x"), null);
});

test("equations: solutions are substituted back into every equation", () => {
  assert.equal(m.satisfies(["2x + 7 = 19"], "x = 6"), true);
  assert.equal(m.satisfies(["2x + 7 = 19"], "x = 5"), false);
  assert.equal(m.satisfies(["2x + y = 11", "x - y = 1"], "x = 4, y = 3"), true);
  assert.equal(m.satisfies(["2x + y = 11", "x - y = 1"], "x = 3, y = 5"), false, "fits the first equation only");
  assert.equal(m.satisfies(["x^2 - 3x - 10 = 0"], "x = 5 or x = -2"), true);
  assert.equal(m.satisfies(["x^2 - 3x - 10 = 0"], "x = 5 or -2"), true, "the second root without its letter");
  assert.equal(m.satisfies(["x^2 - 3x - 10 = 0"], "x = 5 or x = 2"), false, "one wrong root fails the lot");
  assert.equal(m.satisfies(["x^2 - 3x - 10 = 0"], "the answer is five"), null);
  assert.deepEqual(m.readSolutions("x = \\frac{1}{2}, y = -3"), [{ x: 0.5, y: -3 }]);
});

test("value answers: units, currency and a leading x = are tolerated", () => {
  assert.equal(m.valueOf("£68"), 68);
  assert.equal(m.valueOf("\\frac{7}{8}"), 0.875);
  assert.equal(m.valueOf("x = 6"), 6);
  assert.equal(m.valueOf("10 cm"), 10);
  assert.equal(m.sameValue(0.1 + 0.2, 0.3), true);
  assert.equal(m.sameValue(0.875, 0.88), false);
  assert.equal(m.squeeze("Solve 2x + 7 = 19"), m.squeeze("solve 2x+7=19"));
  assert.deepEqual(m.variables("x^2 + 3xy"), ["x", "y"]);
});

test("numbers spaced in digit groups, as UK papers print them, are one number, not a product", () => {
  assert.equal(m.evaluate("0.000 52"), 0.00052);
  assert.equal(m.evaluate("10 000 / 4"), 2500);
  assert.ok(m.sameValue(m.evaluate("5.2 \\times 10^{-4}"), m.evaluate("0.000 52")));
  assert.equal(m.evaluate("2 x", { x: 3 }), 6, "a number and a letter are still a product");
});
