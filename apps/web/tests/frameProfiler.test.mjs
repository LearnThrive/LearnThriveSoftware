import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { compileFunction } from "node:vm";
import ts from "typescript";

// Same transpile-and-load approach as tests/enquiry.test.mjs — frameProfiler.ts has no external
// imports, so this works without a bundler.
const require = createRequire(import.meta.url);
const source = readFileSync(
  new URL("../src/lib/motion/frameProfiler.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadModule() {
  const fakeModule = { exports: {} };
  compileFunction(compiled, ["require", "module", "exports"])(require, fakeModule, fakeModule.exports);
  return fakeModule.exports;
}

// A deterministic fake clock/rAF: each call to requestFrame schedules a callback that fires
// when `tick(ms)` advances the clock past its target, letting tests control exact frame timing
// instead of racing the real display's refresh rate.
function makeFakeClock() {
  let time = 0;
  const scheduled = [];
  let nextHandle = 1;
  return {
    now: () => time,
    requestFrame(cb) {
      const handle = nextHandle++;
      scheduled.push({ handle, cb });
      return handle;
    },
    cancelFrame(handle) {
      const idx = scheduled.findIndex((s) => s.handle === handle);
      if (idx !== -1) scheduled.splice(idx, 1);
    },
    // Advances the clock by intervalMs and fires exactly one pending frame, mimicking a real
    // rAF loop where each frame re-schedules the next one.
    tick(intervalMs) {
      time += intervalMs;
      const due = scheduled.splice(0, scheduled.length);
      for (const { cb } of due) cb(time);
    },
  };
}

test("frameProfiler: empty snapshot before any frames recorded", () => {
  const { createFrameProfiler } = loadModule();
  const clock = makeFakeClock();
  const profiler = createFrameProfiler({
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
  });
  const snapshot = profiler.getSnapshot();
  assert.equal(snapshot.sampleCount, 0);
  assert.equal(snapshot.measuredHz, null);
  assert.equal(snapshot.droppedFramePercent, null);
});

test("frameProfiler: derives ~60Hz from consistent 16.7ms frame intervals", () => {
  const { createFrameProfiler } = loadModule();
  const clock = makeFakeClock();
  const profiler = createFrameProfiler({
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
  });
  profiler.start();
  for (let i = 0; i < 30; i++) clock.tick(16.7);
  const snapshot = profiler.getSnapshot();
  assert.equal(snapshot.sampleCount, 29); // first tick has no prior frame to diff against
  assert.ok(snapshot.measuredHz >= 58 && snapshot.measuredHz <= 62, `expected ~60Hz, got ${snapshot.measuredHz}`);
  assert.ok(snapshot.droppedFramePercent < 5, `expected near-zero drops, got ${snapshot.droppedFramePercent}`);
  profiler.stop();
});

test("frameProfiler: derives ~120Hz without assuming 60Hz", () => {
  const { createFrameProfiler } = loadModule();
  const clock = makeFakeClock();
  const profiler = createFrameProfiler({
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
  });
  profiler.start();
  for (let i = 0; i < 30; i++) clock.tick(8.33);
  const snapshot = profiler.getSnapshot();
  assert.ok(snapshot.measuredHz >= 115 && snapshot.measuredHz <= 125, `expected ~120Hz, got ${snapshot.measuredHz}`);
  profiler.stop();
});

test("frameProfiler: detects dropped frames against the measured cadence", () => {
  const { createFrameProfiler } = loadModule();
  const clock = makeFakeClock();
  const profiler = createFrameProfiler({
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
  });
  profiler.start();
  // Establish a clean 60Hz baseline, then simulate every 5th frame taking 3x as long (a
  // dropped-frame stutter), and confirm the estimate reflects real, non-trivial loss.
  for (let i = 0; i < 20; i++) clock.tick(16.7);
  for (let i = 0; i < 20; i++) clock.tick(i % 5 === 0 ? 50 : 16.7);
  const snapshot = profiler.getSnapshot();
  assert.ok(snapshot.droppedFramePercent > 10, `expected meaningful drop rate, got ${snapshot.droppedFramePercent}`);
  profiler.stop();
});

test("frameProfiler: ignores multi-second gaps (backgrounded tab) rather than poisoning cadence", () => {
  const { createFrameProfiler } = loadModule();
  const clock = makeFakeClock();
  const profiler = createFrameProfiler({
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
  });
  profiler.start();
  for (let i = 0; i < 10; i++) clock.tick(16.7);
  clock.tick(5000); // tab was hidden and throttled
  for (let i = 0; i < 10; i++) clock.tick(16.7);
  const snapshot = profiler.getSnapshot();
  assert.ok(snapshot.measuredHz >= 58 && snapshot.measuredHz <= 62, `5s gap should not skew cadence, got ${snapshot.measuredHz}`);
  profiler.stop();
});

test("frameProfiler: stop() halts frame collection", () => {
  const { createFrameProfiler } = loadModule();
  const clock = makeFakeClock();
  const profiler = createFrameProfiler({
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
  });
  profiler.start();
  clock.tick(16.7);
  clock.tick(16.7);
  profiler.stop();
  const before = profiler.getSnapshot().sampleCount;
  clock.tick(16.7); // no pending frame after stop(), so this is a no-op
  const after = profiler.getSnapshot().sampleCount;
  assert.equal(before, after);
});

test("frameProfiler: reset() clears samples but keeps the profiler usable", () => {
  const { createFrameProfiler } = loadModule();
  const clock = makeFakeClock();
  const profiler = createFrameProfiler({
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
  });
  profiler.start();
  for (let i = 0; i < 5; i++) clock.tick(16.7);
  assert.ok(profiler.getSnapshot().sampleCount > 0);
  profiler.reset();
  assert.equal(profiler.getSnapshot().sampleCount, 0);
  profiler.stop();
});

test("frameProfiler: subscribe delivers snapshots on a real timer, independent of frame rate", async () => {
  const { createFrameProfiler } = loadModule();
  const clock = makeFakeClock();
  const profiler = createFrameProfiler({
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
  });
  profiler.start();
  for (let i = 0; i < 5; i++) clock.tick(16.7);

  const received = [];
  const unsubscribe = profiler.subscribe((snap) => received.push(snap), 10);
  await new Promise((resolve) => setTimeout(resolve, 35));
  unsubscribe();
  profiler.stop();

  assert.ok(received.length >= 2, `expected multiple subscriber callbacks, got ${received.length}`);
  assert.ok(received[0].sampleCount > 0);
});
