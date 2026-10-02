import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// plan15 Wave 3: the dark theme is declared twice in tokens.css (system and explicit), because CSS
// cannot share one declaration list between a media query and an attribute selector. Nothing else
// stops the copies drifting apart, so this does.

const css = readFileSync(new URL("../src/app/tokens.css", import.meta.url), "utf8");

function themeBlocks() {
  const blocks = [...css.matchAll(/\/\* theme:begin \*\/([\s\S]*?)\/\* theme:end \*\//g)].map((m) =>
    m[1]
      .split(";")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  );
  return blocks;
}

test("the system and explicit dark blocks declare exactly the same tokens", () => {
  const blocks = themeBlocks();
  assert.equal(blocks.length, 2, "one block per selector");
  assert.deepEqual(blocks[0], blocks[1]);
});

test("every semantic token the light theme defines has a dark value", () => {
  const light = css.slice(0, css.indexOf("@media (prefers-color-scheme: dark)"));
  const rootBlock = light.slice(light.indexOf(":root {"), light.indexOf("/* The product scope"));
  const lightNames = new Set([...rootBlock.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
  const darkNames = new Set(themeBlocks()[0].map((decl) => decl.split(":")[0].trim()));
  // Deliberately theme-independent: spacing-like or structural tokens, and the texture grain.
  const themeIndependent = new Set(["--grain", "--focus-width", "--focus-offset", "--focus-colour-on-inverse", "--on-accent"]);
  const missing = [...lightNames].filter((name) => !darkNames.has(name) && !themeIndependent.has(name));
  assert.deepEqual(missing, [], "light tokens with no dark counterpart");
});

test("the dark theme is gated on the themes flag, so it can be switched off at build time", () => {
  assert.match(css, /:root\[data-themes="on"\]:not\(\[data-theme="light"\]\)/);
  assert.match(css, /:root\[data-themes="on"\]\[data-theme="dark"\]/);
});

// ── Contrast: every text/background pair that can occur passes WCAG AA in BOTH themes ──────────
// Computed from the token values themselves (tokens.css), compositing translucent values over the
// surface they sit on, so a palette tweak that breaks contrast fails here before it reaches a page.

function tokenMap(blockText) {
  const map = new Map();
  for (const m of blockText.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) map.set(m[1], m[2].trim().replace(/\s*\/\*.*$/, ""));
  return map;
}

function parseColour(value, tokens, depth = 0) {
  const v = value.trim();
  const ref = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (ref) {
    assert.ok(depth < 8, `token chain too deep: ${value}`);
    return parseColour(tokens.get(ref[1]), tokens, depth + 1);
  }
  let m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  m = v.match(/^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)(%?))?\s*\)$/i);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : m[5] ? +m[4] / 100 : +m[4] };
  assert.fail(`cannot parse colour: ${value}`);
}

const over = (top, bottom) => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});
const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
function ratio(fg, bg) {
  const solidBg = over(bg, { r: 255, g: 255, b: 255, a: 1 });
  const solidFg = over(fg, solidBg);
  const [hi, lo] = [luminance(solidFg), luminance(solidBg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

const lightRoot = css.slice(css.indexOf(":root {"), css.indexOf("/* The product scope"));
// The raw palette the semantic tokens point at lives in globals.css's first :root block.
const globalsCss = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const palette = tokenMap(globalsCss.slice(globalsCss.indexOf(":root {"), globalsCss.indexOf("}", globalsCss.indexOf(":root {"))));
const lightTokens = new Map([...palette, ...tokenMap(lightRoot)]);
const themes = {
  light: lightTokens,
  dark: new Map([...lightTokens, ...tokenMap(css.match(/\/\* theme:begin \*\/([\s\S]*?)\/\* theme:end \*\//)[1])]),
};

const PAIRS = [
  // body copy and headings on every surface a page can paint
  ...["--fg-strong", "--fg-body", "--fg-ink", "--fg-muted", "--fg-accent", "--fg-error"].flatMap((fg) =>
    ["--surface-canvas", "--surface-1", "--surface-2", "--surface-3", "--surface-sunken"].map((bg) => [fg, bg, 4.5]),
  ),
  // navy sections
  ...["--fg-on-inverse", "--fg-on-inverse-soft", "--fg-on-inverse-muted", "--fg-accent-on-inverse"].flatMap((fg) =>
    ["--surface-inverse", "--surface-inverse-deep", "--surface-inverse-raised"].map((bg) => [fg, bg, 4.5]),
  ),
  // large figures only (the stat numerals are 46px): 3:1
  ["--fg-accent-bright", "--surface-inverse", 3],
  ["--fg-accent-bright", "--surface-inverse-raised", 3],
  // filled accent buttons
  ["--on-accent", "--accent", 4.5],
  ["--on-accent", "--accent-strong", 4.5],
  // status tones over the card they sit on
  ...["neutral", "muted", "positive", "warning", "info"].map((t) => [`--tone-${t}-fg`, `--tone-${t}-bg`, 4.5]),
  ["--tone-warning-soft-fg", "--tone-warning-soft-bg", 4.5],
  ["--tone-info-fg", "--tone-info-soft-bg", 4.5],
  ["--tone-private-fg", "--tone-private-bg", 4.5],
  ["--tone-private-label", "--tone-private-bg", 4.5],
  ["--tone-private-body", "--tone-private-bg", 4.5],
  ["--fg-error", "--error-bg", 4.5],
  ...["a", "b", "c", "d", "e"].map((k) => [`--avatar-${k}-fg`, `--avatar-${k}-bg`, 4.5]),
  ...["maths", "english", "science", "eleven-plus"].flatMap((k) =>
    ["--surface-canvas", "--surface-1", "--surface-3"].map((bg) => [`--subject-${k}`, bg, 3]),
  ),
];

for (const theme of ["light", "dark"]) {
  test(`${theme} theme: every text/background token pair meets WCAG AA`, () => {
    const tokens = themes[theme];
    const failures = [];
    for (const [fg, bg, min] of PAIRS) {
      // A translucent background (a tone tint) sits on a card: composite it over --surface-1 first.
      const bgColour = over(parseColour(`var(${bg})`, tokens), parseColour("var(--surface-1)", tokens));
      const value = ratio(parseColour(`var(${fg})`, tokens), bgColour);
      if (value < min) failures.push(`${fg} on ${bg}: ${value.toFixed(2)}:1 (needs ${min}:1)`);
    }
    assert.deepEqual(failures, []);
  });
}
