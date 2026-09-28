import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan11.md task 3: which motion tier a device lands in is a pure decision over a handful of
// capability signals (lib/motion/capabilities.ts), so it is tested here as one — every boundary
// stated explicitly — and the browser-facing half (the tier really following the viewport, the
// pointer and the OS setting) is covered by tests-e2e/marketing-motion.spec.ts.

const capabilities = loadTsFrom(import.meta.url, "../src/lib/motion/capabilities.ts");

const DESKTOP = {
  reducedMotion: false,
  coarsePointer: false,
  hoverNone: false,
  viewportWidth: 1440,
  saveData: false,
  cpuCores: 8,
  memoryGb: 8,
};
const tierFor = (overrides) => capabilities.selectMotionTier({ ...DESKTOP, ...overrides });

test("selectMotionTier: a capable, wide desktop with a fine pointer is full", () => {
  assert.equal(tierFor({}), "full");
  assert.equal(tierFor({ viewportWidth: 1024 }), "full", "1024 is the first width that can be full");
  assert.equal(tierFor({ viewportWidth: 2560 }), "full");
});

test("selectMotionTier: prefers-reduced-motion always wins, on any device", () => {
  assert.equal(tierFor({ reducedMotion: true }), "reduced");
  assert.equal(tierFor({ reducedMotion: true, viewportWidth: 390, coarsePointer: true }), "reduced");
  assert.equal(tierFor({ reducedMotion: true, saveData: true, cpuCores: 2 }), "reduced");
});

test("selectMotionTier: phones are light however capable they are", () => {
  const phone = { viewportWidth: 390, coarsePointer: true, hoverNone: true, cpuCores: 8, memoryGb: 8 };
  assert.equal(tierFor(phone), "light");
  assert.equal(tierFor({ ...phone, viewportWidth: 360 }), "light");
  assert.equal(tierFor({ viewportWidth: 767 }), "light", "the phone boundary is width alone, not the pointer");
  assert.equal(tierFor({ viewportWidth: capabilities.PHONE_MAX_WIDTH }), "light");
});

test("selectMotionTier: tablets and narrow desktop windows are standard, not light and not full", () => {
  assert.equal(tierFor({ viewportWidth: 768 }), "standard", "768 is the first non-phone width");
  assert.equal(tierFor({ viewportWidth: 834, coarsePointer: true, hoverNone: true }), "standard");
  assert.equal(tierFor({ viewportWidth: 1023 }), "standard", "a desktop window just under 1024 is standard");
});

test("selectMotionTier: a wide touch screen is standard — no pointer, but room for choreography", () => {
  assert.equal(tierFor({ viewportWidth: 1366, coarsePointer: true, hoverNone: true }), "standard");
  assert.equal(tierFor({ viewportWidth: 1440, hoverNone: true }), "standard", "hover: none alone is enough");
  assert.equal(tierFor({ viewportWidth: 1440, coarsePointer: true }), "standard", "so is a coarse pointer alone");
});

test("selectMotionTier: resource hints demote a device to light", () => {
  assert.equal(tierFor({ saveData: true }), "light");
  assert.equal(tierFor({ memoryGb: 2 }), "light");
  assert.equal(tierFor({ memoryGb: 0.5 }), "light");
  assert.equal(tierFor({ cpuCores: 2 }), "light");
  assert.equal(tierFor({ cpuCores: 3 }), "light");
});

test("selectMotionTier: the hint thresholds are inclusive at 4 GB and 4 cores", () => {
  assert.equal(tierFor({ memoryGb: 4 }), "full");
  assert.equal(tierFor({ cpuCores: 4 }), "full");
});

test("selectMotionTier: no capability evidence at all is uncertainty, and uncertainty is standard", () => {
  assert.equal(tierFor({ cpuCores: undefined, memoryGb: undefined }), "standard");
});

test("selectMotionTier: one positive hint is enough evidence — Safari/Firefox report cores but not memory", () => {
  assert.equal(tierFor({ cpuCores: 8, memoryGb: undefined }), "full");
  assert.equal(tierFor({ cpuCores: undefined, memoryGb: 8 }), "full");
});

test("selectMotionTier: a missing hint never demotes on its own", () => {
  assert.equal(tierFor({ memoryGb: undefined }), "full");
  assert.equal(tierFor({ cpuCores: undefined }), "full");
});

test("selectMotionTier: never reads the user agent — the signal set has no such field", () => {
  const source = capabilities.selectMotionTier.toString();
  assert.doesNotMatch(source, /userAgent|navigator/i);
});

test("motionCapabilities: each tier allows strictly less than the one above it", () => {
  const full = capabilities.motionCapabilities("full");
  const standard = capabilities.motionCapabilities("standard");
  const light = capabilities.motionCapabilities("light");
  const reduced = capabilities.motionCapabilities("reduced");

  assert.deepEqual([full.tier, standard.tier, light.tier, reduced.tier], ["full", "standard", "light", "reduced"]);
  assert.ok(full.parallaxScale > standard.parallaxScale);
  assert.ok(standard.parallaxScale > light.parallaxScale);
  assert.ok(light.parallaxScale > reduced.parallaxScale);
  assert.equal(full.parallaxScale, 1, "full is the authored scale; every other tier is a fraction of it");
});

test("motionCapabilities: reduced has no spatial choreography at all", () => {
  const reduced = capabilities.motionCapabilities("reduced");
  assert.equal(reduced.scrollChoreography, false);
  assert.equal(reduced.parallaxScale, 0);
  assert.equal(reduced.pointerDepth, false);
  assert.equal(reduced.webgl, false);
});

test("motionCapabilities: WebGL is full-tier only, and pointer depth is never on for light or reduced", () => {
  assert.equal(capabilities.motionCapabilities("full").webgl, true);
  for (const tier of ["standard", "light", "reduced"]) {
    assert.equal(capabilities.motionCapabilities(tier).webgl, false, `${tier} must not run WebGL`);
  }
  assert.equal(capabilities.motionCapabilities("full").pointerDepth, true);
  assert.equal(capabilities.motionCapabilities("light").pointerDepth, false);
  assert.equal(capabilities.motionCapabilities("reduced").pointerDepth, false);
});

test("motionCapabilities: light keeps scroll choreography, only smaller — mobile stays lively", () => {
  const light = capabilities.motionCapabilities("light");
  assert.equal(light.scrollChoreography, true);
  assert.ok(light.parallaxScale > 0 && light.parallaxScale <= 0.5, "tiny, not zero");
});
