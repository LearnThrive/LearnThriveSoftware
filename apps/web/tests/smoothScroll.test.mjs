import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan15 Wave 4: when smooth scrolling is allowed, which wheel events it must leave to the browser,
// and the arithmetic of the shared scroll store's scrub helper. Pure functions on purpose; the
// browser-facing behaviour (anchors, focus, keyboard, nested scrollers, kill switches) is in
// tests-e2e/smooth-scroll.spec.ts.

const smooth = loadTsFrom(import.meta.url, "../src/lib/motion/smoothScroll.ts");
const store = loadTsFrom(import.meta.url, "../src/lib/motion/scrollStore.ts");

const base = { tier: "full", finePointer: true, saveData: false, buildEnabled: true, search: "", storedOff: false };

test("smooth scroll runs on full and standard tiers with a fine pointer", () => {
  assert.equal(smooth.shouldSmoothScroll(base), true);
  assert.equal(smooth.shouldSmoothScroll({ ...base, tier: "standard" }), true);
});

test("it never runs on light or reduced tiers, touch, Save-Data, or when switched off", () => {
  assert.equal(smooth.shouldSmoothScroll({ ...base, tier: "light" }), false);
  assert.equal(smooth.shouldSmoothScroll({ ...base, tier: "reduced" }), false, "reduced motion keeps native scrolling");
  assert.equal(smooth.shouldSmoothScroll({ ...base, finePointer: false }), false, "touch keeps native scrolling");
  assert.equal(smooth.shouldSmoothScroll({ ...base, saveData: true }), false);
  assert.equal(smooth.shouldSmoothScroll({ ...base, buildEnabled: false }), false, "NEXT_PUBLIC_SMOOTH_SCROLL=0");
  assert.equal(smooth.shouldSmoothScroll({ ...base, search: "?smooth=0" }), false, "?smooth=0");
  assert.equal(smooth.shouldSmoothScroll({ ...base, search: "?a=1&smooth=0" }), false);
  assert.equal(smooth.shouldSmoothScroll({ ...base, storedOff: true }), false);
  assert.equal(smooth.shouldSmoothScroll({ ...base, search: "?smooth=1" }), true, "only 0 switches it off");
});

test("a mouse-wheel notch is smoothed; a precision touchpad's small deltas are left native", () => {
  // Windows wheel notches: 100 at 100% scaling, 120 at 125%, 150 at 150%.
  for (const deltaY of [100, 120, 150, -100, 200]) {
    assert.equal(smooth.isTouchpadLikeWheel({ deltaX: 0, deltaY, deltaMode: 0 }), false, `wheel ${deltaY}`);
  }
  // Touchpad streams: small and/or fractional.
  for (const deltaY of [1, 3, 7.5, 12, 24, 49, -18.25]) {
    assert.equal(smooth.isTouchpadLikeWheel({ deltaX: 0, deltaY, deltaMode: 0 }), true, `touchpad ${deltaY}`);
  }
  assert.equal(smooth.isTouchpadLikeWheel({ deltaX: 0, deltaY: 103.4, deltaMode: 0 }), true, "a fractional delta is not a notch");
  assert.equal(smooth.isTouchpadLikeWheel({ deltaX: 0, deltaY: 3, deltaMode: 1 }), false, "line mode is always a wheel");
  assert.equal(smooth.isTouchpadLikeWheel({ deltaX: 0, deltaY: 0, deltaMode: 0 }), false);
});

test("the easing is monotonic, starts at 0 and lands at 1", () => {
  assert.ok(smooth.smoothScrollEasing(0) < 0.01);
  assert.equal(smooth.smoothScrollEasing(1), 1);
  let previous = -1;
  for (let t = 0; t <= 1; t += 0.05) {
    const value = smooth.smoothScrollEasing(t);
    assert.ok(value >= previous, "never goes backwards");
    previous = value;
  }
  assert.ok(smooth.smoothScrollEasing(0.3) > 0.8, "front-loaded: most of the distance in the first third");
  assert.ok(smooth.SMOOTH_SCROLL_OPTIONS.duration >= 1.0 && smooth.SMOOTH_SCROLL_OPTIONS.duration <= 1.2);
  assert.equal(smooth.SMOOTH_SCROLL_OPTIONS.syncTouch, false);
});

test("scrubProgress clamps to 0..1 and treats a degenerate range as a step", () => {
  assert.equal(store.scrubProgress(50, 0, 100), 0.5);
  assert.equal(store.scrubProgress(-10, 0, 100), 0);
  assert.equal(store.scrubProgress(500, 0, 100), 1);
  assert.equal(store.scrubProgress(150, 100, 300), 0.25);
  assert.equal(store.scrubProgress(99, 100, 100), 0);
  assert.equal(store.scrubProgress(100, 100, 100), 1);
  assert.equal(store.scrubProgress(5, 100, 50), 0, "an inverted range is a step at its start");
});
