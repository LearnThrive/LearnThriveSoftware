import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan11.md task 4. apps/web/src/features/classroom is a port of the standalone apps/classroom
// source, so the two MicLevelMeter implementations have to change together — and the full
// lifecycle suite (apps/classroom/src/micLevel.test.ts, run by that workspace's vitest) only
// exercises the classroom copy. These tests cover what that cannot: that the web port loads and
// behaves, and that the two copies have not drifted apart.

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const webFeature = resolve(repoRoot, "apps", "web", "src", "features", "classroom");
const classroomApp = resolve(repoRoot, "apps", "classroom", "src");

const read = (path) => readFileSync(path, "utf8");

const micLevel = loadTsFrom(import.meta.url, "../src/features/classroom/micLevel.ts");

test("the web port's micLevel.ts is byte-identical to the classroom app's", () => {
  assert.equal(
    read(resolve(webFeature, "micLevel.ts")),
    read(resolve(classroomApp, "micLevel.ts")),
    "apps/web/src/features/classroom/micLevel.ts drifted from apps/classroom/src/micLevel.ts",
  );
});

test("the web port's MicLevelMeter.tsx is byte-identical to the classroom app's", () => {
  assert.equal(
    read(resolve(webFeature, "components", "MicLevelMeter.tsx")),
    read(resolve(classroomApp, "components", "MicLevelMeter.tsx")),
    "the two MicLevelMeter components drifted apart",
  );
});

test("neither MicLevelMeter holds React state for the level — it would re-render every animation frame", () => {
  for (const path of [
    resolve(webFeature, "components", "MicLevelMeter.tsx"),
    resolve(classroomApp, "components", "MicLevelMeter.tsx"),
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /\buseState\b/, `${path} must not use useState for the level`);
    assert.doesNotMatch(source, /\buseReducer\b/, `${path} must not use useReducer for the level`);
    assert.match(source, /style\.transform/, `${path} should write the fill's transform directly`);
    assert.doesNotMatch(source, /\bwidth\b\s*[:=]/, `${path} must move the fill with transform, not width`);
  }
});

test("levelFromSamples: silence is zero, a full-scale signal clamps to one, and gain applies in between", () => {
  assert.equal(micLevel.levelFromSamples(new Uint8Array(64).fill(128)), 0);
  assert.equal(micLevel.levelFromSamples(new Uint8Array(0)), 0);
  assert.equal(micLevel.levelFromSamples(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 0 : 255))), 1);
  const half = Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 112 : 144));
  assert.ok(Math.abs(micLevel.levelFromSamples(half) - 0.5) < 1e-9);
});

test("startMicLevel (web port): releases the frame, the source, the context and the listener on stop", async () => {
  let nextId = 1;
  const frames = new Map();
  const listeners = new Set();
  const calls = { disconnected: 0, closed: 0 };
  const context = {
    createAnalyser: () => ({ fftSize: 0, frequencyBinCount: 4, getByteTimeDomainData: (array) => array.fill(128) }),
    createMediaStreamSource: () => ({ connect() {}, disconnect: () => { calls.disconnected += 1; } }),
    close: () => { calls.closed += 1; return Promise.resolve(); },
  };
  const sink = { frames: 0, onFrame() { this.frames += 1; }, onLabel() {} };

  const stop = micLevel.startMicLevel({}, sink, {
    createContext: () => context,
    createStream: () => ({}),
    raf: (callback) => { const id = nextId++; frames.set(id, callback); return id; },
    caf: (id) => frames.delete(id),
    now: () => 0,
    isHidden: () => false,
    subscribeVisibility: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
  });

  const [[firstId, first]] = frames;
  frames.delete(firstId);
  first();
  assert.equal(sink.frames, 1);
  assert.equal(frames.size, 1, "the loop reschedules itself");
  assert.equal(listeners.size, 1);

  stop();
  assert.equal(frames.size, 0, "no rAF may outlive stop()");
  assert.equal(listeners.size, 0);
  assert.equal(calls.disconnected, 1);
  assert.equal(calls.closed, 1);
});
