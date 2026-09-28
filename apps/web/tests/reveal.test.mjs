import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

// plan11.md task 6. Source-level guarantees for the Reveal primitive: what it may animate, what it
// must not do per instance, and that the mechanisms that keep content visible without motion
// (reduced-motion CSS, the <noscript> override) are actually present. The behaviour is proved in
// a browser by tests-e2e/marketing-motion.spec.ts against /dev/motion.

const root = resolve(import.meta.dirname, "..");
const read = (...parts) => readFileSync(join(root, "src", ...parts), "utf8");

/** Comments explain *why* a property or hook is absent, so they must not count as using it. */
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const reveal = withoutComments(read("components", "motion", "primitives", "Reveal.tsx"));
const revealCss = read("components", "motion", "primitives", "Reveal.module.css");
const layout = read("app", "(public)", "layout.tsx");

const VARIANTS = ["soft", "mask", "scale", "side", "editorial", "static"];

test("Reveal exposes exactly the six documented variants", () => {
  const union = reveal.match(/export type RevealVariant =([^;]+);/)[1];
  const declared = [...union.matchAll(/"(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(declared.sort(), [...VARIANTS].sort());
});

test("Reveal animates only compositor properties: opacity, x, y, scale", () => {
  // The start states and the shared end state are the only literals that name properties.
  const startBlock = reveal.match(/const START[\s\S]*?\n\};/)[0];
  const endBlock = reveal.match(/const END[^\n]*/)[0];
  const props = [...(startBlock + endBlock).matchAll(/\b(opacity|x|y|scale|scaleX|clipPath|filter|width|height|top|left|margin|padding|boxShadow|backgroundPosition)\s*:/g)].map((m) => m[1]);
  const allowed = new Set(["opacity", "x", "y", "scale"]);
  assert.deepEqual([...new Set(props)].filter((p) => !allowed.has(p)), []);
  // `mask` and the editorial rule animate y and scaleX respectively — also transforms.
  assert.match(reveal, /y: "110%"/);
  assert.match(reveal, /scaleX: 0/);
  assert.doesNotMatch(reveal, /clipPath|clip-path/);
});

test("Reveal uses Motion's shared viewport observation, not a per-instance observer, timer or state", () => {
  assert.match(reveal, /whileInView="visible"/);
  assert.match(reveal, /viewport=\{viewport\}/);
  assert.doesNotMatch(reveal, /new IntersectionObserver/);
  assert.doesNotMatch(reveal, /\bsetTimeout\b|\bsetInterval\b/);
  assert.doesNotMatch(reveal, /\buseState\b|\buseEffect\b|\buseReducer\b/);
});

test("Reveal does not branch its markup on the visitor's motion preference (a hydration hazard)", () => {
  assert.doesNotMatch(reveal, /useReducedMotion|prefersReducedMotion|matchMedia/);
});

test("reduced motion forces every variant's final state with !important, beating Motion's inline start state", () => {
  const block = revealCss.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\n\}/)[0];
  for (const attribute of ["data-reveal", "data-reveal-inner", "data-reveal-rule"]) {
    assert.match(block, new RegExp(`\\[${attribute}\\]`));
  }
  assert.match(block, /opacity: 1 !important/);
  assert.match(block, /transform: none !important/);
});

test("the (public) layout's <noscript> forces the final state for a visitor without JavaScript", () => {
  const noscript = layout.match(/<noscript>[\s\S]*?<\/noscript>/)[0];
  assert.match(noscript, /\[data-reveal\]/);
  assert.match(noscript, /\[data-reveal-inner\]/);
  assert.match(noscript, /\[data-underline-draw\]/);
  assert.match(noscript, /opacity: 1 !important/);
  assert.match(noscript, /transform: none !important/);
});

test("the old ScrollReveal mechanism is gone: no component, no .rv class, no imports", () => {
  assert.throws(() => read("components", "ScrollReveal.tsx"), /ENOENT/);
  for (const file of [
    ["app", "(public)", "page.tsx"],
    ["app", "(public)", "subjects", "page.tsx"],
    ["app", "(public)", "about", "page.tsx"],
    ["app", "(public)", "contact", "page.tsx"],
    ["app", "(public)", "faq", "page.tsx"],
    ["app", "(public)", "home.module.css"],
  ]) {
    const source = read(...file);
    assert.doesNotMatch(source, /ScrollReveal/, file.join("/"));
    assert.doesNotMatch(source, /\brv--in\b|:global\(\.rv/, file.join("/"));
  }
});

test("every <Reveal> on the marketing pages names a real variant, and generic soft is not the only voice", () => {
  const pages = [
    ["app", "(public)", "page.tsx"],
    ["app", "(public)", "subjects", "page.tsx"],
    ["app", "(public)", "about", "page.tsx"],
    ["app", "(public)", "contact", "page.tsx"],
    ["app", "(public)", "faq", "page.tsx"],
  ];
  const used = [];
  for (const file of pages) {
    for (const match of read(...file).matchAll(/<Reveal\b([^>]*)>/g)) {
      const variant = match[1].match(/variant="(\w+)"/)?.[1];
      assert.ok(VARIANTS.includes(variant), `${file.join("/")}: <Reveal${match[1]}> has no valid variant`);
      used.push(variant);
    }
  }
  assert.ok(used.length >= 30, `expected the migrated call sites, found ${used.length}`);
  const soft = used.filter((v) => v === "soft").length;
  assert.ok(soft / used.length < 0.6, `soft is ${soft} of ${used.length} — generic fade-up must not dominate`);
  assert.ok(new Set(used).size >= 4, "the pages should use at least four different reveal variants");
});
