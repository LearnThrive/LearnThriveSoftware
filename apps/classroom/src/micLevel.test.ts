import { describe, expect, it } from 'vitest';
import {
  LABEL_INTERVAL_MS,
  levelFromSamples,
  startMicLevel,
  type AudioContextLike,
  type MicLevelDeps,
} from './micLevel';

/** Everything the meter touches, hand-cranked: nothing runs until the test says so. */
function harness(options: { hidden?: boolean } = {}) {
  let time = 0;
  let nextId = 1;
  let hidden = options.hidden ?? false;
  let amplitude = 0;
  const frames = new Map<number, () => void>();
  const visibilityListeners = new Set<() => void>();
  const calls = { closed: 0, suspended: 0, resumed: 0, disconnected: 0, connected: 0 };
  const analyser = {
    fftSize: 0,
    frequencyBinCount: 8,
    getByteTimeDomainData(array: Uint8Array) {
      // Alternates around the 128 centre line, so RMS is exactly amplitude * 127 / 128.
      for (let i = 0; i < array.length; i += 1) array[i] = 128 + (i % 2 === 0 ? 1 : -1) * Math.round(amplitude * 127);
    },
  };
  const context: AudioContextLike = {
    createAnalyser: () => analyser,
    createMediaStreamSource: () => ({
      connect: () => {
        calls.connected += 1;
      },
      disconnect: () => {
        calls.disconnected += 1;
      },
    }),
    close: () => {
      calls.closed += 1;
      return Promise.resolve();
    },
    suspend: () => {
      calls.suspended += 1;
      return Promise.resolve();
    },
    resume: () => {
      calls.resumed += 1;
      return Promise.resolve();
    },
  };
  const deps: Partial<MicLevelDeps> = {
    createContext: () => context,
    createStream: () => ({}) as MediaStream,
    raf: (callback) => {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    caf: (id) => {
      frames.delete(id);
    },
    now: () => time,
    isHidden: () => hidden,
    subscribeVisibility: (listener) => {
      visibilityListeners.add(listener);
      return () => visibilityListeners.delete(listener);
    },
  };
  const sink = {
    levels: [] as number[],
    labels: [] as number[],
    onFrame(level: number) {
      this.levels.push(level);
    },
    onLabel(percent: number) {
      this.labels.push(percent);
    },
  };
  return {
    deps,
    calls,
    context,
    analyser,
    sink,
    pending: () => frames.size,
    listeners: () => visibilityListeners.size,
    setAmplitude: (value: number) => {
      amplitude = value;
    },
    frame(dt = 16) {
      time += dt;
      const [[id, callback]] = frames;
      frames.delete(id);
      callback();
    },
    setHidden(value: boolean) {
      hidden = value;
      visibilityListeners.forEach((listener) => listener());
    },
  };
}

const track = {} as MediaStreamTrack;

describe('levelFromSamples', () => {
  it('reads silence (the 128 centre line) as zero', () => {
    expect(levelFromSamples(new Uint8Array(64).fill(128))).toBe(0);
  });

  it('reads an empty buffer as zero rather than NaN', () => {
    expect(levelFromSamples(new Uint8Array(0))).toBe(0);
  });

  it('scales RMS by the meter gain', () => {
    // ±16 around the centre is an RMS of 16/128 = 0.125, which the gain of 4 maps to exactly 0.5.
    const samples = Uint8Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 144 : 112));
    expect(levelFromSamples(samples)).toBeCloseTo(0.5, 10);
  });

  it('clamps a full-scale signal to 1', () => {
    const samples = Uint8Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 255 : 0));
    expect(levelFromSamples(samples)).toBe(1);
  });
});

describe('startMicLevel', () => {
  it('connects an analyser and reports a level on every frame', () => {
    const h = harness();
    startMicLevel(track, h.sink, h.deps);
    expect(h.analyser.fftSize).toBe(512);
    expect(h.calls.connected).toBe(1);
    expect(h.pending()).toBe(1);

    h.setAmplitude(0.05);
    h.frame();
    h.setAmplitude(0.1);
    h.frame();
    expect(h.sink.levels).toHaveLength(2);
    expect(h.sink.levels[1]).toBeGreaterThan(h.sink.levels[0]);
    expect(h.pending()).toBe(1);
  });

  it('refreshes the accessible name at a human pace, not once per frame', () => {
    const h = harness();
    startMicLevel(track, h.sink, h.deps);
    h.setAmplitude(0.1); // ≈ 40%

    // One second of frames at ~60 Hz with a steady signal.
    for (let i = 0; i < 60; i += 1) h.frame(16);
    expect(h.sink.levels).toHaveLength(60);
    expect(h.sink.labels).toEqual([40]); // once — the percentage never changed after that

    h.setAmplitude(0.2); // ≈ 80%
    for (let i = 0; i < 60; i += 1) h.frame(16);
    expect(h.sink.labels).toEqual([40, 80]);
  });

  it('never refreshes the name more often than the interval, even when the level is jumping', () => {
    const h = harness();
    startMicLevel(track, h.sink, h.deps);
    const amplitudes = [0.02, 0.1, 0.2, 0.05, 0.15, 0.25, 0.01];
    // Each step is far shorter than the interval, and each changes the rounded percentage.
    amplitudes.forEach((value) => {
      h.setAmplitude(value);
      h.frame(LABEL_INTERVAL_MS / 10);
    });
    expect(h.sink.labels.length).toBeLessThanOrEqual(1);
  });

  it('stop() releases every resource it acquired, and stops the loop', () => {
    const h = harness();
    const stop = startMicLevel(track, h.sink, h.deps);
    h.frame();
    expect(h.pending()).toBe(1);
    expect(h.listeners()).toBe(1);

    stop();
    expect(h.pending()).toBe(0);
    expect(h.listeners()).toBe(0);
    expect(h.calls.disconnected).toBe(1);
    expect(h.calls.closed).toBe(1);
  });

  it('stop() is idempotent', () => {
    const h = harness();
    const stop = startMicLevel(track, h.sink, h.deps);
    stop();
    stop();
    expect(h.calls.closed).toBe(1);
    expect(h.calls.disconnected).toBe(1);
  });

  it('does no work while the page is hidden, and picks up again when it returns', () => {
    const h = harness();
    startMicLevel(track, h.sink, h.deps);
    h.frame();

    h.setHidden(true);
    expect(h.pending()).toBe(0);
    expect(h.calls.suspended).toBe(1);
    const framesBefore = h.sink.levels.length;

    h.setHidden(false);
    expect(h.calls.resumed).toBe(1);
    expect(h.pending()).toBe(1);
    h.frame();
    expect(h.sink.levels.length).toBe(framesBefore + 1);
  });

  it('schedules nothing when started on an already-hidden page, until it becomes visible', () => {
    const h = harness({ hidden: true });
    startMicLevel(track, h.sink, h.deps);
    expect(h.pending()).toBe(0);
    h.setHidden(false);
    expect(h.pending()).toBe(1);
  });

  it('stopping while hidden does not resurrect the loop or throw', () => {
    const h = harness();
    const stop = startMicLevel(track, h.sink, h.deps);
    h.setHidden(true);
    stop();
    expect(h.pending()).toBe(0);
    expect(h.calls.closed).toBe(1);
  });

  it('is a harmless no-op where the browser has no AudioContext', () => {
    const h = harness();
    const stop = startMicLevel(track, h.sink, { ...h.deps, createContext: () => null });
    expect(h.pending()).toBe(0);
    expect(h.listeners()).toBe(0);
    expect(() => stop()).not.toThrow();
  });

  it('swallows a rejected close()/suspend() instead of leaking an unhandled rejection', async () => {
    const h = harness();
    h.context.close = () => Promise.reject(new Error('already closed'));
    h.context.suspend = () => Promise.reject(new Error('cannot suspend'));
    const stop = startMicLevel(track, h.sink, h.deps);
    h.setHidden(true);
    stop();
    // Vitest fails the run on an unhandled rejection; give any stray one time to surface.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
