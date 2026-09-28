import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";

// plan11.md task 5 and the Definition of Done: continuous and hover animation runs on the
// compositor, and the things that quietly stop being true — one `transition: all`, one
// `will-change` on a wrapper, one keyframe that animates `width` — are caught here, at the source,
// rather than found later in a trace. These read the stylesheets as text; the *measured* effect
// (style recalculations, layouts, running animations) is in scripts/profile-motion.mjs.

const root = resolve(import.meta.dirname, "..");
const srcDir = join(root, "src");
const apps = resolve(root, "..");

function cssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(fullPath);
    return entry.name.endsWith(".css") ? [fullPath] : [];
  });
}

const sheets = [
  ...cssFiles(srcDir),
  // The standalone classroom's stylesheet is the source the web port is ported from.
  ...cssFiles(join(apps, "classroom", "src")),
].map((path) => ({
  path,
  name: relative(resolve(root, "..", ".."), path).replaceAll("\\", "/"),
  css: readFileSync(path, "utf8"),
}));

/** Strips comments so prose that mentions a property is not mistaken for using it. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `@keyframes name { ... }` with its body, by brace matching (bodies are nested). */
function keyframeBlocks(css) {
  const blocks = [];
  const pattern = /@keyframes\s+([\w-]+)\s*\{/g;
  let match;
  while ((match = pattern.exec(css))) {
    let depth = 1;
    let index = pattern.lastIndex;
    while (depth > 0 && index < css.length) {
      if (css[index] === "{") depth += 1;
      else if (css[index] === "}") depth -= 1;
      index += 1;
    }
    blocks.push({ name: match[1], body: css.slice(pattern.lastIndex, index - 1) });
  }
  return blocks;
}

test("no stylesheet uses `transition: all` or `transition-property: all`", () => {
  const offenders = sheets
    .filter(({ css }) => /transition(?:-property)?\s*:[^;{}]*\ball\b/.test(stripComments(css)))
    .map(({ name }) => name);
  assert.deepEqual(offenders, []);
});

test("no stylesheet sets `will-change` — promotion is applied to measured layers only, from script", () => {
  const offenders = sheets.filter(({ css }) => /will-change\s*:/.test(stripComments(css))).map(({ name }) => name);
  assert.deepEqual(offenders, []);
});

test("no @keyframes animates a layout or paint property — only transform and opacity", () => {
  const allowed = new Set(["transform", "opacity", "translate", "scale", "rotate"]);
  const offenders = [];
  let parsed = 0;
  for (const { name, css } of sheets) {
    for (const block of keyframeBlocks(stripComments(css))) {
      parsed += 1;
      const properties = [...block.body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      const bad = [...new Set(properties)].filter((property) => !allowed.has(property));
      if (bad.length) offenders.push(`${name}: @keyframes ${block.name} animates ${bad.join(", ")}`);
    }
  }
  // Guard against a parser that quietly finds nothing and so "passes": the product has ~40.
  assert.ok(parsed >= 30, `only parsed ${parsed} @keyframes blocks`);
  assert.deepEqual(offenders, []);
});

test("the skeleton shimmer moves a pseudo-element with transform, not the background position", () => {
  const dashboard = sheets.find(({ name }) => name.endsWith("app/app-dashboard.css")).css;
  const shimmer = keyframeBlocks(stripComments(dashboard)).find(({ name }) => name === "skeleton-shimmer");
  assert.ok(shimmer, "skeleton-shimmer keyframes should exist");
  assert.match(shimmer.body, /transform\s*:/);
  assert.doesNotMatch(shimmer.body, /background-position/);
  assert.match(dashboard, /\.skeleton::after\s*\{[^}]*animation\s*:\s*skeleton-shimmer/);
});

const marketing = sheets.filter(({ name }) => /apps\/web\/src\/(app\/\(public\)\/|components\/Marquee)/.test(name));

test("marketing pages use no CSS blur filter — the hero glow is a baked gradient, not a filtered layer", () => {
  assert.ok(marketing.length >= 6, "expected the public page modules and the marquee");
  const offenders = marketing.filter(({ css }) => /(?<!-)filter\s*:\s*blur\(/.test(stripComments(css))).map(({ name }) => name);
  assert.deepEqual(offenders, []);
});

test("no hero glow animates — perpetual motion on that layer cost a style recalculation per frame", () => {
  const offenders = [];
  for (const { name, css } of marketing) {
    const clean = stripComments(css);
    for (const rule of clean.matchAll(/\.heroGlow\s*\{([^}]*)\}/g)) {
      if (/animation\s*:/.test(rule[1])) offenders.push(name);
    }
  }
  assert.deepEqual(offenders, []);
});

test("marketing cards fade a pre-drawn shadow layer in instead of interpolating box-shadow", () => {
  // FAQ items are deliberately left on a small, subtle box-shadow transition (the item clips its
  // own overflow, and the shadow is at most 32px on a ~60px element); everything else moves to the
  // opacity layer. If the FAQ accordion is rebuilt, take it off this list.
  const justified = new Set(["apps/web/src/app/(public)/faq/faq.module.css"]);
  const offenders = marketing
    .filter(({ name }) => !justified.has(name))
    .filter(({ css }) => /transition\s*:[^;{}]*\bbox-shadow\b/.test(stripComments(css)))
    .map(({ name }) => name);
  assert.deepEqual(offenders, []);
});

test("the marquee's styles are owned by the Marquee component, not by a page's stylesheet", () => {
  const marquee = readFileSync(join(srcDir, "components", "Marquee.tsx"), "utf8");
  assert.match(marquee, /from "\.\/Marquee\.module\.css"/);
  const strayGlobals = sheets
    .filter(({ name }) => !name.endsWith("components/Marquee.module.css"))
    .filter(({ css }) => /lt-marquee/.test(css))
    .map(({ name }) => name);
  assert.deepEqual(strayGlobals, [], "a :global .lt-marquee rule only reaches pages that happen to load that sheet");
});

test("no component or stylesheet still refers to the legacy hero classes that were removed as dead", () => {
  const names = /hero-image-frame|hero-subject-note|\blive-dot\b/;
  const files = [...sheets.map(({ name, css }) => ({ name, text: css }))];
  const offenders = files.filter(({ text }) => names.test(text)).map(({ name }) => name);
  assert.deepEqual(offenders, []);
});
