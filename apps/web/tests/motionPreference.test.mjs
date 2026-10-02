import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan15 Wave 11 feature A3: the visitor's own motion preference. Reduce always wins; there is no override
// of an OS reduced-motion setting.

const pref = loadTsFrom(import.meta.url, "../src/lib/motion/preference.ts");
const { THEME_INIT_SCRIPT } = loadTsFrom(import.meta.url, "../src/lib/theme.ts");

const fakeStorage = (initial = {}, throws = false) => ({
  getItem(key) {
    if (throws) throw new Error("blocked");
    return key in initial ? initial[key] : null;
  },
});
const fakeRoot = () => {
  const attrs = new Map();
  return { attrs, getAttribute: (k) => attrs.get(k) ?? null, setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) };
};

test("only the exact stored value 'reduce' means Reduce; everything else, and any storage failure, is System", () => {
  assert.equal(pref.readStoredMotionPreference(fakeStorage({ "lt-motion": "reduce" })), "reduce");
  for (const value of ["system", "full", "REDUCE", "", "true", "1"]) {
    assert.equal(pref.readStoredMotionPreference(fakeStorage({ "lt-motion": value })), "system", value);
  }
  assert.equal(pref.readStoredMotionPreference(fakeStorage({})), "system");
  assert.equal(pref.readStoredMotionPreference(fakeStorage({ "lt-motion": "reduce" }, true)), "system");
  assert.equal(pref.readStoredMotionPreference(undefined), "system");
});

test("there are exactly two choices: no 'full motion' override exists", () => {
  assert.deepEqual([...pref.MOTION_CHOICES], ["system", "reduce"]);
  assert.equal(pref.isMotionPreference("full"), false);
  assert.equal(pref.isMotionPreference("always"), false);
});

test("applying sets and clears the html attribute, and the attribute is what the runtime reads", () => {
  const root = fakeRoot();
  assert.equal(pref.currentMotionPreference(root), "system");
  pref.applyMotionPreference("reduce", root);
  assert.equal(root.getAttribute("data-motion"), "reduce");
  assert.equal(pref.currentMotionPreference(root), "reduce");
  pref.applyMotionPreference("system", root);
  assert.equal(root.getAttribute("data-motion"), null);
  assert.equal(pref.currentMotionPreference(root), "system");
});

function runInitScript({ stored, throws = false }) {
  const root = fakeRoot();
  const localStorage = {
    getItem(key) {
      if (throws) throw new Error("blocked");
      return stored[key] ?? null;
    },
  };
  new Function("document", "localStorage", THEME_INIT_SCRIPT)({ documentElement: root }, localStorage);
  return root;
}

test("the pre-paint script applies the stored motion choice and the stored theme, independently", () => {
  assert.equal(runInitScript({ stored: { "lt-motion": "reduce" } }).getAttribute("data-motion"), "reduce");
  assert.equal(runInitScript({ stored: { "lt-motion": "reduce" } }).getAttribute("data-theme"), null);
  const both = runInitScript({ stored: { "lt-motion": "reduce", "lt-theme": "dark" } });
  assert.equal(both.getAttribute("data-motion"), "reduce");
  assert.equal(both.getAttribute("data-theme"), "dark");
  assert.equal(runInitScript({ stored: { "lt-theme": "light" } }).getAttribute("data-motion"), null);
});

test("the pre-paint script ignores junk and survives blocked storage", () => {
  assert.equal(runInitScript({ stored: { "lt-motion": "full" } }).getAttribute("data-motion"), null);
  assert.equal(runInitScript({ stored: { "lt-motion": "system" } }).getAttribute("data-motion"), null);
  assert.doesNotThrow(() => runInitScript({ stored: {}, throws: true }));
});

test("the pre-paint script is still a fixed string with no interpolation left in it", () => {
  assert.equal(typeof THEME_INIT_SCRIPT, "string");
  assert.doesNotMatch(THEME_INIT_SCRIPT, /\$\{/);
  assert.ok(THEME_INIT_SCRIPT.length < 400, "keep it tiny: it is inlined into every page");
});
