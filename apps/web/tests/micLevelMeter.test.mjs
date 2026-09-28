import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { compileFunction } from "node:vm";
import ts from "typescript";

// Same transpile-and-load approach as tests/enquiry.test.mjs and tests/frameProfiler.test.mjs.
// The source file also contains a JSX component (MicLevelMeter itself), so this needs jsx
// transpilation configured even though only the non-JSX startMicSampler export is under test —
// ts.transpileModule fails to parse the file at all otherwise.
const require = createRequire(import.meta.url);
const source = readFileSync(
  new URL("../src/features/classroom/components/MicLevelMeter.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

function loadModule() {
  const fakeModule = { exports: {} };
  // `react/jsx-runtime` isn't needed at test time — startMicSampler never touches JSX, and the
  // module-level require() call for it only resolves lazily when React's runtime is imported,
  // which compileFunction's CommonJS output does eagerly. Stub it so loading the module doesn't
  // require pulling in React for a test that never renders anything.
  const fakeRequire = (specifier) => {
    if (specifier === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
    if (specifier === "react") return { useEffect: () => {}, useRef: () => ({ current: null }), useState: () => [0, () => {}] };
    return require(specifier);
  };
  compileFunction(compiled, ["require", "module", "exports"])(fakeRequire, fakeModule, fakeModule.exports);
  return fakeModule.exports;
}

// Minimal fakes for the Web Audio / MediaStream surface startMicSampler actually touches.
// startMicSampler constructs `new MediaStream([track])` directly (isolating the single audio
// track, matching the pre-existing code this task is fixing) — MediaStream isn't a Node global,
// so a minimal stand-in is required for the module to run at all outside a browser.
class FakeMediaStreamCtor {
  constructor(tracks) {
    this.tracks = tracks;
  }
}
globalThis.MediaStream ??= FakeMediaStreamCtor;

class FakeAnalyser {
  fftSize = 0;
  frequencyBinCount = 4;
  getByteTimeDomainData(data) {
    // A constant mid-value (128) reads as "silence" — level should compute to ~0.
    data.fill(128);
  }
}
class FakeAudioContext {
  closed = false;
  createAnalyser() {
    return new FakeAnalyser();
  }
  createMediaStreamSource() {
    return { connect: () => {}, disconnect: () => { this.sourceDisconnected = true; } };
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

function makeFakeClock() {
  let time = 0;
  let scheduled = null;
  let nextHandle = 1;
  return {
    requestFrame(cb) {
      const handle = nextHandle++;
      scheduled = { handle, cb };
      return handle;
    },
    cancelFrame(handle) {
      if (scheduled?.handle === handle) scheduled = null;
    },
    tick(intervalMs) {
      time += intervalMs;
      const due = scheduled;
      scheduled = null;
      due?.cb(time);
    },
    hasScheduled: () => scheduled !== null,
  };
}

test("startMicSampler: calls onLevel every frame while running", () => {
  const { startMicSampler } = loadModule();
  const clock = makeFakeClock();
  const levels = [];
  const audioContext = new FakeAudioContext();
  const sampler = startMicSampler({
    track: {},
    onLevel: (level) => levels.push(level),
    onLabelLevel: () => {},
    createAudioContext: () => audioContext,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
  });

  clock.tick(16.7);
  clock.tick(16.7);
  clock.tick(16.7);
  assert.equal(levels.length, 3);
  assert.ok(levels.every((l) => l === 0)); // constant 128 in the fake data == silence

  sampler.stop();
});

test("startMicSampler: throttles onLabelLevel independently of the frame rate", () => {
  const { startMicSampler } = loadModule();
  const clock = makeFakeClock();
  const labelCalls = [];
  const sampler = startMicSampler({
    track: {},
    onLevel: () => {},
    onLabelLevel: (level) => labelCalls.push(level),
    createAudioContext: () => new FakeAudioContext(),
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
  });

  // ~10 frames at 16.7ms (~167ms total) should not yet cross the 400ms label-update threshold —
  // lastLabelUpdate starts at 0, so even the first tick must wait for a full 400ms gap.
  for (let i = 0; i < 10; i++) clock.tick(16.7);
  assert.equal(labelCalls.length, 0, "expected no label calls before 400ms elapses");

  for (let i = 0; i < 15; i++) clock.tick(16.7); // pushes well past 400ms total
  assert.ok(labelCalls.length >= 1, `expected a label update once 400ms elapsed, got ${labelCalls.length}`);

  sampler.stop();
});

test("startMicSampler: stop() cancels the pending frame and tears down audio resources", () => {
  const { startMicSampler } = loadModule();
  const clock = makeFakeClock();
  const audioContext = new FakeAudioContext();
  let disconnected = false;
  const originalCreateSource = audioContext.createMediaStreamSource.bind(audioContext);
  audioContext.createMediaStreamSource = (...args) => {
    const source = originalCreateSource(...args);
    return { ...source, disconnect: () => { disconnected = true; } };
  };

  const sampler = startMicSampler({
    track: {},
    onLevel: () => {},
    onLabelLevel: () => {},
    createAudioContext: () => audioContext,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
  });

  assert.ok(clock.hasScheduled(), "a frame should be scheduled while running");
  sampler.stop();
  assert.ok(!clock.hasScheduled(), "stop() must cancel the pending animation frame");
  assert.ok(disconnected, "stop() must disconnect the media stream source");
  assert.ok(audioContext.closed, "stop() must close the AudioContext");
});

test("startMicSampler: no further onLevel calls fire after stop()", () => {
  const { startMicSampler } = loadModule();
  const clock = makeFakeClock();
  const levels = [];
  const sampler = startMicSampler({
    track: {},
    onLevel: (level) => levels.push(level),
    onLabelLevel: () => {},
    createAudioContext: () => new FakeAudioContext(),
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
  });

  clock.tick(16.7);
  const countBeforeStop = levels.length;
  sampler.stop();
  clock.tick(16.7); // no pending frame after stop(), so this should be a no-op
  assert.equal(levels.length, countBeforeStop, "no onLevel calls should fire after stop()");
});
