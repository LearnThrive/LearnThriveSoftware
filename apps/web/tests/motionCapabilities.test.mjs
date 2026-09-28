import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { compileFunction } from "node:vm";
import ts from "typescript";

// Same transpile-and-load approach as tests/frameProfiler.test.mjs. capabilities.ts imports React
// (for useEffect/useState), which Node's require can resolve from the workspace's own
// node_modules — the hooks themselves are never called by these tests, only the plain
// computeTier() selection function, so React never actually needs to render anything.
const require = createRequire(import.meta.url);
const source = readFileSync(
  new URL("../src/lib/motion/capabilities.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function loadModule() {
  const fakeModule = { exports: {} };
  compileFunction(compiled, ["require", "module", "exports"])(require, fakeModule, fakeModule.exports);
  return fakeModule.exports;
}

// A fake matchMedia keyed by query string, matching only the queries computeTier() actually
// checks — a query not in `matches` returns not-matching rather than throwing, since
// computeTier() only ever calls matchMedia with its own fixed set of query strings.
function fakeWindow(matches) {
  return {
    matchMedia: (query) => ({ matches: matches.includes(query) }),
  };
}

test("computeTier: no window (server) defaults to full", () => {
  const { computeTier } = loadModule();
  const original = globalThis.window;
  delete globalThis.window;
  try {
    assert.equal(computeTier(), "full");
  } finally {
    if (original !== undefined) globalThis.window = original;
  }
});

test("computeTier: prefers-reduced-motion wins over every other signal", () => {
  const { computeTier } = loadModule();
  globalThis.window = fakeWindow([
    "(prefers-reduced-motion: reduce)",
    "(pointer: coarse)",
    "(max-width: 600px)",
  ]);
  try {
    assert.equal(computeTier(), "reduced");
  } finally {
    delete globalThis.window;
  }
});

test("computeTier: coarse pointer selects light", () => {
  const { computeTier } = loadModule();
  globalThis.window = fakeWindow(["(pointer: coarse)"]);
  try {
    assert.equal(computeTier(), "light");
  } finally {
    delete globalThis.window;
  }
});

test("computeTier: narrow (<=600px) viewport selects light even with a fine pointer", () => {
  const { computeTier } = loadModule();
  globalThis.window = fakeWindow(["(max-width: 600px)", "(max-width: 900px)"]);
  try {
    assert.equal(computeTier(), "light");
  } finally {
    delete globalThis.window;
  }
});

test("computeTier: mid viewport (601-900px) selects standard", () => {
  const { computeTier } = loadModule();
  globalThis.window = fakeWindow(["(max-width: 900px)"]);
  try {
    assert.equal(computeTier(), "standard");
  } finally {
    delete globalThis.window;
  }
});

test("computeTier: wide viewport, fine pointer, no reduced-motion selects full", () => {
  const { computeTier } = loadModule();
  globalThis.window = fakeWindow([]);
  try {
    assert.equal(computeTier(), "full");
  } finally {
    delete globalThis.window;
  }
});
