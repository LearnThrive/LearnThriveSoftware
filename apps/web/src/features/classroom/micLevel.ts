/**
 * The analyser loop behind MicLevelMeter, kept free of React (plan11.md task 4).
 *
 * The meter used to call `setLevel(...)` from its requestAnimationFrame callback: a React render
 * and commit for every display frame, on the pre-join screen, for as long as it stayed open — plus a
 * rewrite of the accessible name on every one of them. A level bar is the textbook case for *not*
 * routing through React state: the value changes every frame, nothing else on the page depends on
 * it, and the thing that has to change is one element's `transform`. So the loop reports through
 * plain callbacks and the component writes them straight to the DOM.
 *
 * The accessible name is a separate, slow channel on purpose. A screen reader reads an image's
 * label when it reaches it — it is not a live region — so refreshing it four times a second, and only
 * when the rounded percentage actually changes, is as informative as sixty times a second and costs
 * nothing.
 *
 * Every browser dependency is injectable, which is what lets the lifecycle be tested exactly:
 * that stopping cancels the pending frame, disconnects the source, closes the context and drops
 * the visibility listener, and that a hidden page does no work.
 */

/** Analyser output is centred on 128; this maps its RMS onto the meter's 0..1 range. */
const LEVEL_GAIN = 4;
/** The accessible name is refreshed at most this often. */
export const LABEL_INTERVAL_MS = 250;

/** RMS of a time-domain byte buffer (128 = silence), scaled by LEVEL_GAIN and clamped to 0..1. */
export function levelFromSamples(data: ArrayLike<number>): number {
  const count = data.length;
  if (count === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < count; i += 1) {
    const normalised = (data[i] - 128) / 128;
    sumSquares += normalised * normalised;
  }
  return Math.min(1, Math.sqrt(sumSquares / count) * LEVEL_GAIN);
}

export interface AnalyserLike {
  fftSize: number;
  readonly frequencyBinCount: number;
  getByteTimeDomainData(array: Uint8Array<ArrayBuffer>): void;
}

export interface AudioSourceLike {
  connect(destination: unknown): unknown;
  disconnect(): void;
}

export interface AudioContextLike {
  createAnalyser(): AnalyserLike;
  createMediaStreamSource(stream: MediaStream): AudioSourceLike;
  close(): Promise<void>;
  suspend?(): Promise<void>;
  resume?(): Promise<void>;
}

export interface MicLevelSink {
  /** Every display frame while visible, with the level in 0..1. Must not set React state. */
  onFrame(level: number): void;
  /** At most every LABEL_INTERVAL_MS, and only when the rounded percentage has changed. */
  onLabel(percent: number): void;
}

export interface MicLevelDeps {
  createContext(): AudioContextLike | null;
  createStream(track: MediaStreamTrack): MediaStream;
  raf(callback: () => void): number;
  caf(id: number): void;
  now(): number;
  isHidden(): boolean;
  /** Calls the listener on every visibility change; returns the unsubscribe. */
  subscribeVisibility(listener: () => void): () => void;
}

function browserDeps(): MicLevelDeps {
  return {
    createContext: () =>
      typeof AudioContext === 'undefined' ? null : (new AudioContext() as unknown as AudioContextLike),
    createStream: (track) => new MediaStream([track]),
    raf: (callback) => requestAnimationFrame(callback),
    caf: (id) => cancelAnimationFrame(id),
    now: () => performance.now(),
    isHidden: () => document.visibilityState === 'hidden',
    subscribeVisibility(listener) {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
}

/**
 * Starts metering `track`. Returns the stop function, which releases everything it acquired; it is
 * safe to call more than once. Returns a no-op stop when the browser has no AudioContext.
 */
export function startMicLevel(
  track: MediaStreamTrack,
  sink: MicLevelSink,
  overrides: Partial<MicLevelDeps> = {},
): () => void {
  const deps = { ...browserDeps(), ...overrides };
  const context = deps.createContext();
  if (!context) return () => undefined;

  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const source = context.createMediaStreamSource(deps.createStream(track));
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  let frame: number | null = null;
  let stopped = false;
  let lastLabelAt = -Infinity;
  let lastPercent = -1;

  const tick = () => {
    frame = null;
    if (stopped) return;
    analyser.getByteTimeDomainData(data);
    const level = levelFromSamples(data);
    sink.onFrame(level);

    const now = deps.now();
    if (now - lastLabelAt >= LABEL_INTERVAL_MS) {
      const percent = Math.round(level * 10) * 10; // tens: "40 percent", not a number that jitters
      if (percent !== lastPercent) {
        lastPercent = percent;
        sink.onLabel(percent);
      }
      lastLabelAt = now;
    }
    frame = deps.raf(tick);
  };

  // A hidden page does no work: no frames are scheduled, and the audio graph is suspended so the
  // audio thread is not analysing a meter nobody can see. Both resume when the page returns.
  const onVisibility = () => {
    if (stopped) return;
    if (deps.isHidden()) {
      if (frame !== null) deps.caf(frame);
      frame = null;
      void context.suspend?.()?.catch(() => undefined);
    } else if (frame === null) {
      void context.resume?.()?.catch(() => undefined);
      frame = deps.raf(tick);
    }
  };
  const unsubscribeVisibility = deps.subscribeVisibility(onVisibility);

  if (!deps.isHidden()) frame = deps.raf(tick);

  return () => {
    if (stopped) return;
    stopped = true;
    if (frame !== null) deps.caf(frame);
    frame = null;
    unsubscribeVisibility();
    source.disconnect();
    void context.close().catch(() => undefined);
  };
}
