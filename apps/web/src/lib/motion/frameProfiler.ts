/**
 * Development-only frame-pacing profiler (plan11.md Task 1). Deliberately outside React —
 * a per-frame rAF loop writing to React state would itself be the exact "high-frequency React
 * rendering" this whole plan exists to eliminate (plan11.md's Global Constraints: "Never use
 * React state as a per-frame transport"). Consumers read snapshots via `subscribe`, which is
 * throttled independently of the rAF sampling rate.
 */

export interface FrameProfilerSnapshot {
  sampleCount: number;
  /** Estimated native refresh cadence in Hz, derived from observed frame intervals rather than
      assumed — a 120Hz/144Hz display reports correctly instead of being treated as 60Hz. */
  measuredHz: number | null;
  avgFrameIntervalMs: number | null;
  p95FrameIntervalMs: number | null;
  /** Percentage of expected frames (at the measured cadence) estimated as missed/dropped. */
  droppedFramePercent: number | null;
  longTaskCount: number;
  activeDurationMs: number;
}

export interface FrameProfiler {
  start(): void;
  stop(): void;
  reset(): void;
  getSnapshot(): FrameProfilerSnapshot;
  /** Calls `cb` with the latest snapshot every `intervalMs` (default 500ms) while running.
      Returns an unsubscribe function. Never fires more often than intervalMs, regardless of the
      underlying frame rate — this is the one place a caller may put a snapshot into React state. */
  subscribe(cb: (snapshot: FrameProfilerSnapshot) => void, intervalMs?: number): () => void;
}

const MAX_SAMPLES = 300; // ~2.5-5s of history depending on refresh rate — enough for stable stats

export interface FrameProfilerOptions {
  /** Injectable for tests; defaults to the real rAF/performance.now(). */
  now?: () => number;
  requestFrame?: (cb: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

export function createFrameProfiler(options: FrameProfilerOptions = {}): FrameProfiler {
  const now = options.now ?? (() => performance.now());
  const requestFrame =
    options.requestFrame ??
    (typeof requestAnimationFrame === "function" ? requestAnimationFrame.bind(globalThis) : null);
  const cancelFrame =
    options.cancelFrame ??
    (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame.bind(globalThis) : null);

  const intervals: number[] = [];
  let lastFrameTime: number | null = null;
  let rafHandle: number | null = null;
  let running = false;
  let startedAt: number | null = null;
  let activeDurationMs = 0;
  let longTaskCount = 0;
  let longTaskObserver: PerformanceObserver | null = null;
  const subscribers = new Map<(snapshot: FrameProfilerSnapshot) => void, ReturnType<typeof setInterval>>();

  function recordFrame(t: number) {
    if (lastFrameTime !== null) {
      const delta = t - lastFrameTime;
      // Guard against tab-hidden/throttled gaps (e.g. a backgrounded tab firing rAF once every
      // few seconds) — a multi-second "interval" would poison the cadence estimate.
      if (delta > 0 && delta < 250) {
        intervals.push(delta);
        if (intervals.length > MAX_SAMPLES) intervals.shift();
      }
    }
    lastFrameTime = t;
    if (running && requestFrame) {
      rafHandle = requestFrame(recordFrame);
    }
  }

  function estimateMeasuredIntervalMs(): number | null {
    if (intervals.length < 5) return null;
    // The lowest ~20% of observed intervals is the best available proxy for the display's native
    // frame time: any interval below native cadence is impossible, so the low tail is dominated
    // by genuinely-unblocked frames rather than main-thread jank pulling the average up.
    const sorted = [...intervals].sort((a, b) => a - b);
    const lowTailCount = Math.max(3, Math.floor(sorted.length * 0.2));
    const lowTail = sorted.slice(0, lowTailCount);
    const sum = lowTail.reduce((a, b) => a + b, 0);
    return sum / lowTail.length;
  }

  function percentile(sorted: number[], p: number): number {
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[idx];
  }

  function getSnapshot(): FrameProfilerSnapshot {
    if (intervals.length === 0) {
      return {
        sampleCount: 0,
        measuredHz: null,
        avgFrameIntervalMs: null,
        p95FrameIntervalMs: null,
        droppedFramePercent: null,
        longTaskCount,
        activeDurationMs,
      };
    }
    const sorted = [...intervals].sort((a, b) => a - b);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const p95 = percentile(sorted, 0.95);
    const measuredInterval = estimateMeasuredIntervalMs();
    const measuredHz = measuredInterval ? Math.round(1000 / measuredInterval) : null;

    let droppedFramePercent: number | null = null;
    if (measuredInterval && measuredInterval > 0) {
      let expected = 0;
      let missed = 0;
      for (const delta of intervals) {
        const framesForThisGap = Math.max(1, Math.round(delta / measuredInterval));
        expected += framesForThisGap;
        missed += framesForThisGap - 1;
      }
      droppedFramePercent = expected > 0 ? (missed / expected) * 100 : 0;
    }

    return {
      sampleCount: intervals.length,
      measuredHz,
      avgFrameIntervalMs: avg,
      p95FrameIntervalMs: p95,
      droppedFramePercent,
      longTaskCount,
      activeDurationMs,
    };
  }

  function start() {
    if (running) return;
    running = true;
    startedAt = now();
    lastFrameTime = null;

    if (typeof PerformanceObserver !== "undefined") {
      try {
        const supported = PerformanceObserver.supportedEntryTypes?.includes("longtask");
        if (supported) {
          longTaskObserver = new PerformanceObserver((list) => {
            longTaskCount += list.getEntries().length;
          });
          longTaskObserver.observe({ entryTypes: ["longtask"] });
        }
      } catch {
        // longtask unsupported in this browser — fail gracefully, longTaskCount stays 0.
        longTaskObserver = null;
      }
    }

    if (requestFrame) {
      rafHandle = requestFrame(recordFrame);
    }
  }

  function stop() {
    if (!running) return;
    running = false;
    if (rafHandle !== null && cancelFrame) cancelFrame(rafHandle);
    rafHandle = null;
    if (startedAt !== null) activeDurationMs += now() - startedAt;
    startedAt = null;
    longTaskObserver?.disconnect();
    longTaskObserver = null;
    for (const timer of subscribers.values()) clearInterval(timer);
    subscribers.clear();
  }

  function reset() {
    intervals.length = 0;
    lastFrameTime = null;
    activeDurationMs = 0;
    longTaskCount = 0;
  }

  function subscribe(cb: (snapshot: FrameProfilerSnapshot) => void, intervalMs = 500) {
    const timer = setInterval(() => cb(getSnapshot()), intervalMs);
    subscribers.set(cb, timer);
    return () => {
      clearInterval(timer);
      subscribers.delete(cb);
    };
  }

  return { start, stop, reset, getSnapshot, subscribe };
}
