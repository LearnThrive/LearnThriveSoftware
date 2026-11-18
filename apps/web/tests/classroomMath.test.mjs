import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// The equation tool's engine (features/classroom/math.ts): LaTeX in, a sized SVG picture or a clear error out. It uses dynamic import() of
// MathJax, so the module is compiled to ES modules here and loaded from a data: URL-free temp file next to the tests' cache.

const source = readFileSync(fileURLToPath(new URL("../src/features/classroom/math.ts", import.meta.url)), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const require = createRequire(import.meta.url);
const module_ = { exports: {} };
new Function("module", "exports", "require", compiled)(module_, module_.exports, (id) => require(id));
const { renderTex, MathError, equationFileId } = module_.exports;

test("a formula becomes a sized SVG picture with its own proportions", async () => {
  const small = await renderTex("\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", 20);
  assert.match(small.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+"/);
  assert.ok(small.width > 40 && small.height > 20);
  assert.match(small.dataUrl, /^data:image\/svg\+xml;base64,/);
  const big = await renderTex("\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}", 40);
  assert.ok(Math.abs(big.width / small.width - 2) < 0.1, "twice the text size is twice the picture");
});

test("maths and science notation the tutors need all typeset", async () => {
  for (const tex of [
    "\\int_0^{\\pi} \\sin x \\, dx = 2",
    "\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}",
    "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
    "\\ce{2H2 + O2 -> 2H2O}",
    "\\ce{CH3COOH <=> CH3COO^- + H+}",
    "\\vec{F} = m\\vec{a}",
    "x \\neq 0 \\Rightarrow \\cancel{x}/x = 1",
    "\\theta = 90^\\circ",
    "\\text{speed} = \\frac{\\text{distance}}{\\text{time}}",
  ]) {
    const image = await renderTex(tex);
    assert.ok(image.width > 0 && image.height > 0, tex);
  }
});

const nodes = (svg) => [...svg.matchAll(/data-mml-node="([A-Za-z]+)"/g)].map((m) => m[1]);

test("chemistry is really understood: subscripts, charges and arrows are typeset, not shown as the letters c and e", async () => {
  const water = await renderTex("\\ce{H2O}");
  const typedAsLetters = await renderTex("ce{H2O}");
  assert.notEqual(water.svg, typedAsLetters.svg, "\\ce must change the result");
  assert.ok(nodes(water.svg).includes("msub"), "the 2 in H2O is a subscript");
  assert.ok(!water.svg.includes('data-c="63"') || water.svg !== typedAsLetters.svg);
  for (const formula of [
    "\\ce{2H2 + O2 -> 2H2O}",
    "\\ce{CH3COOH <=> CH3COO^- + H+}",
    "\\ce{6CO2 + 6H2O ->[\\text{light}] C6H12O6 + 6O2}",
    "\\ce{N2 + 3H2 <=>[\\text{Fe}][\\text{high pressure}] 2NH3}",
    "\\ce{SO4^2-}",
    "\\ce{Ca(OH)2 (aq) + CO2 (g) -> CaCO3 (s) + H2O (l)}",
    "\\pu{25 kJ/mol}",
    "\\text{Word equation: } \\ce{Mg + 2HCl -> MgCl2 + H2}",
  ]) {
    const image = await renderTex(formula);
    assert.ok(image.width > 0 && nodes(image.svg).length > 5, formula);
  }
  const ion = await renderTex("\\ce{SO4^2-}");
  assert.ok(nodes(ion.svg).some((name) => name === "msup" || name === "msubsup"), "the charge is a superscript");
});

test("physics, cancelling and degree symbols are understood too, not shown as plain letters", async () => {
  const same = async (command, plain) => (await renderTex(command)).svg === (await renderTex(plain)).svg;
  assert.equal(await same("\\dv{f}{x}", "dvfx"), false, "\\dv is a derivative");
  assert.equal(await same("\\cancel{x}", "x"), false, "\\cancel draws a line through it");
  assert.equal(await same("\\vec{F}", "F"), false, "\\vec puts an arrow on it");
  assert.equal(await same("\\mathbb{R}", "R"), false, "\\mathbb is the real numbers");
});

test("bad input is a clear error, never a picture of an error", async () => {
  await assert.rejects(renderTex(""), (e) => e instanceof MathError && /Type an equation/.test(e.message));
  await assert.rejects(renderTex("x = \\frac{1}{"), (e) => e instanceof MathError);
  await assert.rejects(renderTex("a".repeat(2001)), (e) => e instanceof MathError && /under 2000/.test(e.message));
});

test("the same formula always gets the same file id, a different one a different id", () => {
  assert.equal(equationFileId("x^2"), equationFileId("x^2"));
  assert.notEqual(equationFileId("x^2"), equationFileId("x^3"));
  assert.match(equationFileId("x^2"), /^eq-[0-9a-f]{16}$/);
});
