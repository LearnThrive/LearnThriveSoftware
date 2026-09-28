import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan11.md task 7: the Product Story and Safeguarding scenes used to call setState on every
// spring tick of their scroll progress. These pin down the pure part of the fix — which step a
// progress value is in, and that a crossing detector reports crossings and nothing else.

const { indexForProgress, createThresholdTracker } = loadTsFrom(import.meta.url, "../src/lib/motion/thresholds.ts");

test("indexForProgress: splits 0..1 into equal steps and includes both ends", () => {
  assert.equal(indexForProgress(0, 6), 0);
  assert.equal(indexForProgress(0.1666, 6), 0);
  assert.equal(indexForProgress(1 / 6, 6), 1, "a boundary belongs to the step it opens");
  assert.equal(indexForProgress(0.5, 6), 3);
  assert.equal(indexForProgress(0.9999, 6), 5);
  assert.equal(indexForProgress(1, 6), 5, "progress 1 is the last step, not one past it");
});

test("indexForProgress: out-of-range and non-finite progress is clamped, never an invalid step", () => {
  assert.equal(indexForProgress(-0.4, 6), 0);
  assert.equal(indexForProgress(1.7, 6), 5);
  assert.equal(indexForProgress(NaN, 6), 0);
  assert.equal(indexForProgress(Infinity, 6), 0);
  assert.equal(indexForProgress(0.5, 0), 0);
  assert.equal(indexForProgress(0.5, 1), 0);
});

test("createThresholdTracker: steady progress inside a step never calls back", () => {
  const seen = [];
  const track = createThresholdTracker(6, (index) => seen.push(index));
  for (let i = 0; i < 100; i += 1) track(0.05 + i * 0.0005); // 0.05 → 0.0995, all step 0
  assert.deepEqual(seen, []);
});

test("createThresholdTracker: a full forward scroll fires exactly once per crossing", () => {
  const seen = [];
  const track = createThresholdTracker(6, (index) => seen.push(index));
  // 600 progress updates — a spring settling over a scroll — but only five crossings.
  for (let i = 0; i <= 600; i += 1) track(i / 600);
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
});

test("createThresholdTracker: a fast reverse scroll that skips steps fires once, with where it landed", () => {
  const seen = [];
  const track = createThresholdTracker(6, (index) => seen.push(index));
  track(0.95);
  track(0.02); // the visitor flicked straight back to the top
  assert.deepEqual(seen, [5, 0]);
});

test("createThresholdTracker: the same value repeated is idempotent", () => {
  const seen = [];
  const track = createThresholdTracker(4, (index) => seen.push(index));
  for (let i = 0; i < 50; i += 1) track(0.6);
  assert.deepEqual(seen, [2]);
});

test("createThresholdTracker: it starts from the step it is told React already holds", () => {
  const seen = [];
  const track = createThresholdTracker(6, (index) => seen.push(index), 5);
  track(0.99); // already step 5 — nothing to report
  track(0.4);
  assert.deepEqual(seen, [2]);
});

test("createThresholdTracker: going forward and back across one boundary reports each real crossing", () => {
  const seen = [];
  const track = createThresholdTracker(6, (index) => seen.push(index));
  track(0.2); // 1
  track(0.1); // 0
  track(0.2); // 1
  assert.deepEqual(seen, [1, 0, 1]);
});
