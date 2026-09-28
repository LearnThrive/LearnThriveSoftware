import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// Plan 11 — motion runtime. Everything here is a pure function or an injectable factory on
// purpose: the motion runtime's *decisions* (which tier a device gets, whether the debug overlay
// may render, what a frame trace means) are exactly the parts a browser test can only observe
// indirectly, and exactly the parts that regress silently. The DOM-facing behaviour is covered
// by tests-e2e/marketing-motion.spec.ts and tests-e2e/motion-performance.spec.ts.

const profiler = loadTsFrom(import.meta.url, "../src/lib/motion/frameProfiler.ts");
const debug = loadTsFrom(import.meta.url, "../src/lib/motion/debug.ts");

/** A hand-cranked requestAnimationFrame: nothing runs until the test calls `frame(dt)`. */
function makeClock() {
  let time = 1000;
  let nextId = 1;
  const callbacks = new Map();
  return {
    raf(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    caf(id) {
      callbacks.delete(id);
    },
    pending: () => callbacks.size,
    /** Deliver the next frame `dt` ms after the previous one. */
    frame(dt) {
      time += dt;
      const [[id, callback]] = callbacks;
      callbacks.delete(id);
      callback(time);
    },
    frames(count, dt) {
      for (let i = 0; i < count; i += 1) this.frame(dt);
    },
  };
}

function makeVisibility(initiallyHidden = false) {
  let hidden = initiallyHidden;
  const listeners = new Set();
  return {
    isHidden: () => hidden,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(nextHidden) {
      hidden = nextHidden;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function makeLongTaskSource() {
  let onEntry = null;
  let disconnected = 0;
  return {
    create(callback) {
      onEntry = callback;
      return () => {
        disconnected += 1;
        onEntry = null;
      };
    },
    emit(durationMs) {
      onEntry?.(durationMs);
    },
    disconnectCount: () => disconnected,
    active: () => onEntry !== null,
  };
}

const NO_LONG_TASKS = () => undefined;

// ── percentile / cadence maths ─────────────────────────────────────────────────────────────

test("percentile: nearest-rank on unsorted input, without mutating it", () => {
  const input = [50, 10, 40, 20, 30];
  assert.equal(profiler.percentile(input, 50), 30);
  assert.equal(profiler.percentile(input, 100), 50);
  assert.equal(profiler.percentile(input, 0), 10);
  assert.deepEqual(input, [50, 10, 40, 20, 30], "input must be left untouched");
  assert.equal(profiler.percentile([], 95), 0, "an empty sample has no percentile, not NaN");
});

test("summariseIntervals: reads a 60 Hz cadence as 60 Hz with nothing dropped", () => {
  const summary = profiler.summariseIntervals(Array.from({ length: 120 }, () => 1000 / 60));
  assert.ok(Math.abs(summary.refreshHz - 60) < 0.5, `expected ~60 Hz, got ${summary.refreshHz}`);
  assert.equal(summary.droppedFrames, 0);
  assert.equal(summary.droppedFramePercent, 0);
  assert.ok(Math.abs(summary.p95Ms - 1000 / 60) < 0.01);
});

test("summariseIntervals: does not assume 60 Hz — a 144 Hz trace reads as 144 Hz", () => {
  const summary = profiler.summariseIntervals(Array.from({ length: 300 }, () => 1000 / 144));
  assert.ok(Math.abs(summary.refreshHz - 144) < 1, `expected ~144 Hz, got ${summary.refreshHz}`);
  assert.equal(summary.droppedFrames, 0, "a steady 6.9 ms cadence must not look like dropped 60 Hz frames");
});

test("summariseIntervals: a 120 Hz trace with a few long frames counts the frames it missed", () => {
  // 100 on-time 8.33 ms frames plus five 33.3 ms frames — each of the long ones spans four
  // refresh intervals, i.e. three frames the display wanted and never got.
  const intervals = [
    ...Array.from({ length: 100 }, () => 1000 / 120),
    ...Array.from({ length: 5 }, () => 4000 / 120),
  ];
  const summary = profiler.summariseIntervals(intervals);
  assert.ok(Math.abs(summary.refreshHz - 120) < 1);
  assert.equal(summary.droppedFrames, 15);
  // 15 missed out of (105 delivered + 15 missed) frames the display asked for.
  assert.ok(Math.abs(summary.droppedFramePercent - 12.5) < 0.01, `got ${summary.droppedFramePercent}`);
  assert.ok(Math.abs(summary.maxMs - 4000 / 120) < 0.001, "max always sees the worst frame");
  // 5 long frames of 105 is a 4.8% tail — under the 5% a p95 is defined to ignore.
  assert.ok(Math.abs(summary.p95Ms - 1000 / 120) < 0.001, "a sub-5% tail is max's business, not p95's");
});

test("summariseIntervals: once the slow frames are 5% or more, p95 exposes the tail the average hides", () => {
  const intervals = [
    ...Array.from({ length: 90 }, () => 1000 / 120),
    ...Array.from({ length: 10 }, () => 4000 / 120),
  ];
  const summary = profiler.summariseIntervals(intervals);
  assert.ok(Math.abs(summary.p95Ms - 4000 / 120) < 0.001, `p95 was ${summary.p95Ms}`);
  assert.ok(summary.p95Ms > summary.averageMs * 2, "the average alone would have hidden this");
});

test("summariseIntervals: jitter below one and a half refresh intervals is not a dropped frame", () => {
  const intervals = Array.from({ length: 200 }, (_, index) => (index % 2 === 0 ? 15.5 : 17.8));
  assert.equal(profiler.summariseIntervals(intervals).droppedFrames, 0);
});

test("summariseIntervals: an empty trace is a safe all-zero summary", () => {
  const summary = profiler.summariseIntervals([]);
  assert.equal(summary.refreshHz, 0);
  assert.equal(summary.droppedFrames, 0);
  assert.equal(summary.droppedFramePercent, 0);
  assert.equal(summary.p95Ms, 0);
});

// ── createFrameProfiler lifecycle ──────────────────────────────────────────────────────────

test("createFrameProfiler: measures frame intervals from rAF timestamps and reports a snapshot", () => {
  const clock = makeClock();
  const instance = profiler.createFrameProfiler({
    raf: clock.raf,
    caf: clock.caf,
    visibility: makeVisibility(),
    observeLongTasks: NO_LONG_TASKS,
  });
  assert.equal(instance.snapshot().running, false);
  assert.equal(clock.pending(), 0, "nothing is scheduled until start()");

  instance.start();
  assert.equal(clock.pending(), 1);
  // The first frame only establishes a baseline; it has no predecessor to measure against.
  clock.frame(16);
  assert.equal(instance.snapshot().frames, 0);
  clock.frames(60, 1000 / 60);

  const snapshot = instance.snapshot();
  assert.equal(snapshot.running, true);
  assert.equal(snapshot.frames, 60);
  assert.ok(Math.abs(snapshot.refreshHz - 60) < 0.5);
  assert.ok(Math.abs(snapshot.averageFrameMs - 1000 / 60) < 0.01);
  assert.ok(Math.abs(snapshot.activeMs - 1000) < 1, `activeMs was ${snapshot.activeMs}`);
  assert.equal(snapshot.droppedFrames, 0);
  assert.equal(Object.isFrozen(snapshot), true, "a snapshot is read-only");
});

test("createFrameProfiler: stop() cancels the pending frame and releases every subscription", () => {
  const clock = makeClock();
  const visibility = makeVisibility();
  const longTasks = makeLongTaskSource();
  const instance = profiler.createFrameProfiler({
    raf: clock.raf,
    caf: clock.caf,
    visibility,
    observeLongTasks: longTasks.create,
  });

  instance.start();
  clock.frames(5, 16);
  assert.equal(clock.pending(), 1);
  assert.equal(visibility.listenerCount(), 1);
  assert.equal(longTasks.active(), true);

  instance.stop();
  assert.equal(clock.pending(), 0, "no rAF loop may outlive stop()");
  assert.equal(visibility.listenerCount(), 0, "the visibility listener must be removed");
  assert.equal(longTasks.disconnectCount(), 1, "the PerformanceObserver must be disconnected");
  assert.equal(instance.snapshot().running, false);

  instance.stop(); // idempotent
  assert.equal(longTasks.disconnectCount(), 1);
});

test("createFrameProfiler: start() while running does not stack a second loop", () => {
  const clock = makeClock();
  const instance = profiler.createFrameProfiler({
    raf: clock.raf,
    caf: clock.caf,
    visibility: makeVisibility(),
    observeLongTasks: NO_LONG_TASKS,
  });
  instance.start();
  instance.start();
  assert.equal(clock.pending(), 1);
  instance.stop();
});

test("createFrameProfiler: time spent hidden is a discontinuity, not a five-second dropped frame", () => {
  const clock = makeClock();
  const visibility = makeVisibility();
  const instance = profiler.createFrameProfiler({
    raf: clock.raf,
    caf: clock.caf,
    visibility,
    observeLongTasks: NO_LONG_TASKS,
  });
  instance.start();
  clock.frames(30, 1000 / 60);

  visibility.set(true); // tab hidden; the browser stops delivering frames
  visibility.set(false); // ...and much later it comes back
  clock.frame(5000); // first frame after resuming — must only re-baseline
  clock.frames(30, 1000 / 60);

  const snapshot = instance.snapshot();
  assert.equal(snapshot.droppedFrames, 0, "the hidden gap must not read as ~300 missed frames");
  assert.ok(snapshot.maxFrameMs < 20, `max frame was ${snapshot.maxFrameMs}ms`);
  assert.equal(snapshot.frames, 59, "29 before the gap, none for the resume frame, 30 after");
});

test("createFrameProfiler: counts long tasks and the time they blocked past the 50 ms budget", () => {
  const clock = makeClock();
  const longTasks = makeLongTaskSource();
  const instance = profiler.createFrameProfiler({
    raf: clock.raf,
    caf: clock.caf,
    visibility: makeVisibility(),
    observeLongTasks: longTasks.create,
  });
  instance.start();
  clock.frames(3, 16);
  longTasks.emit(60);
  longTasks.emit(120);
  const snapshot = instance.snapshot();
  assert.equal(snapshot.longTasks, 2);
  assert.equal(snapshot.longTaskBlockingMs, 10 + 70);
  instance.stop();
});

test("createFrameProfiler: keeps a rolling window so an always-on overlay cannot grow without bound", () => {
  const clock = makeClock();
  const instance = profiler.createFrameProfiler({
    raf: clock.raf,
    caf: clock.caf,
    windowSize: 10,
    visibility: makeVisibility(),
    observeLongTasks: NO_LONG_TASKS,
  });
  instance.start();
  clock.frame(16); // baseline
  clock.frames(25, 20);
  clock.frames(10, 10); // the last ten frames are the only ones that should count
  const snapshot = instance.snapshot();
  assert.equal(snapshot.frames, 10);
  assert.ok(Math.abs(snapshot.averageFrameMs - 10) < 0.01, `average was ${snapshot.averageFrameMs}`);
  instance.stop();
});

test("createFrameProfiler: reset() clears a finished run without restarting it", () => {
  const clock = makeClock();
  const instance = profiler.createFrameProfiler({
    raf: clock.raf,
    caf: clock.caf,
    visibility: makeVisibility(),
    observeLongTasks: NO_LONG_TASKS,
  });
  instance.start();
  clock.frames(20, 16);
  instance.stop();
  instance.reset();
  const snapshot = instance.snapshot();
  assert.equal(snapshot.frames, 0);
  assert.equal(snapshot.longTasks, 0);
  assert.equal(snapshot.activeMs, 0);
  assert.equal(snapshot.running, false);
});

// ── debug overlay gating ───────────────────────────────────────────────────────────────────

test("shouldShowMotionDebug: development renders the overlay only when asked for by query string", () => {
  const dev = { nodeEnv: "development", productionOptIn: false };
  assert.equal(debug.shouldShowMotionDebug({ ...dev, search: "?motionDebug=1" }), true);
  assert.equal(debug.shouldShowMotionDebug({ ...dev, search: "" }), false);
  assert.equal(debug.shouldShowMotionDebug({ ...dev, search: "?other=1" }), false);
  assert.equal(debug.shouldShowMotionDebug({ ...dev, search: "?motionDebug=0" }), false);
  assert.equal(debug.shouldShowMotionDebug({ ...dev, search: "?motionDebug=true" }), false);
  assert.equal(debug.shouldShowMotionDebug({ ...dev, search: "?utm=x&motionDebug=1" }), true);
});

test("shouldShowMotionDebug: production never renders it, even with the query string", () => {
  assert.equal(
    debug.shouldShowMotionDebug({ nodeEnv: "production", productionOptIn: false, search: "?motionDebug=1" }),
    false,
  );
});

test("shouldShowMotionDebug: production needs both the build-time opt-in and the query string", () => {
  const prod = { nodeEnv: "production", productionOptIn: true };
  assert.equal(debug.shouldShowMotionDebug({ ...prod, search: "?motionDebug=1" }), true);
  assert.equal(debug.shouldShowMotionDebug({ ...prod, search: "" }), false, "the opt-in alone shows nothing");
});

test("shouldShowMotionDebug: an unknown environment fails closed", () => {
  assert.equal(
    debug.shouldShowMotionDebug({ nodeEnv: undefined, productionOptIn: false, search: "?motionDebug=1" }),
    false,
  );
  assert.equal(
    debug.shouldShowMotionDebug({ nodeEnv: "staging", productionOptIn: false, search: "?motionDebug=1" }),
    false,
  );
});

test("shouldShowMotionDebug: the test environment behaves like development", () => {
  assert.equal(
    debug.shouldShowMotionDebug({ nodeEnv: "test", productionOptIn: false, search: "?motionDebug=1" }),
    true,
  );
});
