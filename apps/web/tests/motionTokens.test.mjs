import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan15 Wave 2 section 6.2/6.3: motion tokens v2, parallax depth presets and the stagger helper.
// All pure, so the arithmetic can be pinned here and the primitives that use it stay thin.

const tokens = loadTsFrom(import.meta.url, "../src/lib/motion/tokens.ts");
const depth = loadTsFrom(import.meta.url, "../src/lib/motion/depth.ts");
const globalsCss = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

/** `--duration-name: 600ms;` as seconds, from globals.css's :root block. */
function cssDurationSeconds(name) {
  const match = globalsCss.match(new RegExp(`--duration-${name}:\\s*(\\d+)ms`));
  assert.ok(match, `--duration-${name} is defined in globals.css`);
  return Number(match[1]) / 1000;
}

test("every motion duration with a CSS counterpart matches it", () => {
  for (const name of ["instant", "fast", "slow", "emphasis", "hero", "cinematic"]) {
    assert.equal(tokens.motionDuration[name], cssDurationSeconds(name), `${name}: tokens.ts vs globals.css`);
  }
  assert.equal(tokens.motionDuration.standard, cssDurationSeconds("medium"));
});

test("the new durations are ordered and sit above the existing scale", () => {
  const d = tokens.motionDuration;
  assert.ok(d.slow < d.narrative && d.narrative < d.emphasis && d.emphasis < d.hero && d.hero < d.cinematic);
  // plan15's stated ranges: reveals 600-1000ms, hero moments 800-1400ms.
  assert.ok(d.emphasis >= 0.6 && d.hero >= 0.8 && d.cinematic <= 1.4);
});

test("soft and weighty springs are softer than the existing ones, weighty heavier than soft", () => {
  const { surface, tactile, soft, weighty } = tokens.motionSpring;
  assert.ok(soft.stiffness < surface.stiffness && weighty.stiffness < soft.stiffness);
  assert.ok(soft.stiffness < tactile.stiffness);
  assert.ok(weighty.mass > soft.mass);
  // Critically-damped-ish: damping ratio zeta = c / (2 sqrt(k m)) should be near or above 1 (no wobble).
  for (const spring of [soft, weighty]) {
    const zeta = spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
    assert.ok(zeta > 0.8, `damping ratio ${zeta.toFixed(2)} settles without a visible wobble`);
  }
});

test("staggerDelay is index * step, capped, rounded and never negative", () => {
  assert.equal(tokens.staggerDelay(0), 0);
  assert.equal(tokens.staggerDelay(3, tokens.motionStagger.cards), 0.27);
  assert.equal(tokens.staggerDelay(2, 0.08, 0.1), 0.26);
  assert.equal(tokens.staggerDelay(-4), 0);
  const cap = tokens.staggerDelay(tokens.MAX_STAGGER_STEPS, tokens.motionStagger.cards);
  assert.equal(tokens.staggerDelay(50, tokens.motionStagger.cards), cap, "long lists stop accumulating delay");
  // plan15: editorial stagger lives in 80-140ms.
  assert.ok(tokens.motionStagger.editorial >= 0.08 && tokens.motionStagger.editorial <= 0.14);
});

test("depth presets: accent <= 48, scene <= 120, cinematic <= 200", () => {
  assert.deepEqual(depth.PARALLAX_DEPTH_MAX_PX, { accent: 48, scene: 120, cinematic: 200 });
  assert.equal(depth.clampParallaxPx(500), 48, "default depth is accent");
  assert.equal(depth.clampParallaxPx(500, "scene"), 120);
  assert.equal(depth.clampParallaxPx(-500, "cinematic"), -200);
  assert.equal(depth.clampParallaxPx(30, "accent"), 30);
});

test("cinematic parallax moves on the full tier only; the others scale as before", () => {
  assert.equal(depth.parallaxScaleFor("cinematic", "full", 1), 1);
  for (const tier of ["standard", "light", "reduced"]) {
    assert.equal(depth.parallaxScaleFor("cinematic", tier, 0.7), 0, `${tier} gets a still background`);
  }
  assert.equal(depth.parallaxScaleFor("scene", "standard", 0.7), 0.7);
  assert.equal(depth.parallaxScaleFor("accent", "light", 0.35), 0.35);
});

test("overscan is the largest absolute travel, after clamping", () => {
  assert.equal(depth.parallaxOverscanPx(0, 120), 120);
  assert.equal(depth.parallaxOverscanPx(-150, 40), 150);
  assert.equal(depth.parallaxOverscanPx(0, 900), 200, "clamped to the cinematic cap");
});
