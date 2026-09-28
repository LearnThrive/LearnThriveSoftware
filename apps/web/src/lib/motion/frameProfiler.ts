/**
 * Frame-pacing profiler for the marketing motion runtime (plan11.md task 1).
 *
 * Every later task in that plan is judged against "smooth", and "feels smoother" is not a
 * measurement. This samples requestAnimationFrame timestamps — the browser's own record of when
 * it actually produced frames — and reduces them to the numbers that matter: the cadence the page
 * is really running at, how long a typical and a worst-5% frame take, and how many frames the
 * display asked for and never got.
 *
 * It deliberately does not assume 60 Hz. A 120 or 144 Hz display wants a frame every 8.3 / 6.9 ms;
 * judged against a hard-coded 16.7 ms budget, a page struggling at 144 Hz would read as healthy as
 * long as it stayed above 60 fps. The refresh interval is instead inferred from the samples
 * themselves — the 25th-percentile interval, i.e. the typical *undropped* frame — and misses are
 * counted against that.
 *
 * One limit is inherent to measuring through rAF and is not fixable here: the display's real rate
 * is only visible through the frames the page manages to produce. A page that never exceeds 60 fps
 * on a 120 Hz panel is indistinguishable from a healthy 60 Hz page, so the figure is the *observed
 * cadence*, not a claim about the hardware.
 *
 * The measurement loop never touches React state (a profiler that re-renders the page it is
 * measuring perturbs the measurement) and its hot path allocates nothing: intervals go into a
 * preallocated ring buffer, and all sorting happens only when a snapshot is requested. Nothing in
 * this module touches `window`/`document` at import time, so it is safe to import anywhere.
 */

/** A frame this many refresh intervals long (or more) is counted as having dropped frames. */
export const DROPPED_FRAME_RATIO = 1.5;
/** Longer than this between two frames is a paused debugger or a sleeping laptop, not jank. */
const MAX_INTERVAL_MS = 5000;
/** The browser's own long-task threshold; time beyond it is what actually blocks input. */
const LONG_TASK_BUDGET_MS = 50;

export interface FrameSummary {
  /** Estimated interval between display refreshes, in ms (25th-percentile frame interval). */
  refreshIntervalMs: number;
  refreshHz: number;
  averageMs: number;
  p95Ms: number;
  maxMs: number;
  /** Refreshes the display wanted a new frame for and did not get one. */
  droppedFrames: number;
  /** droppedFrames as a share of every frame the display asked for (delivered + dropped). */
  droppedFramePercent: number;
}

const EMPTY_SUMMARY: FrameSummary = Object.freeze({
  refreshIntervalMs: 0,
  refreshHz: 0,
  averageMs: 0,
  p95Ms: 0,
  maxMs: 0,
  droppedFrames: 0,
  droppedFramePercent: 0,
});

/** Nearest-rank percentile of an already-ascending sample. */
function percentileOfSorted(sorted: ArrayLike<number>, count: number, p: number): number {
  if (count <= 0) return 0;
  const rank = Math.ceil((p / 100) * count);
  return sorted[Math.min(count - 1, Math.max(0, rank - 1))];
}

/** Nearest-rank percentile of an unsorted sample; 0 for an empty one. Never mutates `values`. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const sorted = Float64Array.from(values);
  sorted.sort(); // typed-array sort is numeric, unlike Array.prototype.sort
  return percentileOfSorted(sorted, sorted.length, p);
}

/**
 * Reduces a list of frame intervals (ms between consecutive frames) to a FrameSummary. Only the
 * first `count` entries are read, so a preallocated ring buffer can be passed in as-is — order
 * is irrelevant to every statistic here.
 */
export function summariseIntervals(
  intervals: ArrayLike<number>,
  count: number = intervals.length,
): FrameSummary {
  if (count <= 0) return EMPTY_SUMMARY;

  const sorted = new Float64Array(count);
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    sorted[i] = intervals[i];
    total += intervals[i];
  }
  sorted.sort();

  const refreshIntervalMs = percentileOfSorted(sorted, count, 25);
  let droppedFrames = 0;
  if (refreshIntervalMs > 0) {
    for (let i = 0; i < count; i += 1) {
      const ratio = sorted[i] / refreshIntervalMs;
      // A frame of ~N refresh intervals means N-1 refreshes went by with nothing new to show.
      if (ratio >= DROPPED_FRAME_RATIO) droppedFrames += Math.round(ratio) - 1;
    }
  }

  return {
    refreshIntervalMs,
    refreshHz: refreshIntervalMs > 0 ? 1000 / refreshIntervalMs : 0,
    averageMs: total / count,
    p95Ms: percentileOfSorted(sorted, count, 95),
    maxMs: sorted[count - 1],
    droppedFrames,
    droppedFramePercent: (droppedFrames / (count + droppedFrames)) * 100,
  };
}

export interface FrameProfilerSnapshot {
  running: boolean;
  /** Frame intervals in the rolling window the statistics below are computed over. */
  frames: number;
  refreshIntervalMs: number;
  refreshHz: number;
  averageFrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  droppedFrames: number;
  droppedFramePercent: number;
  longTasks: number;
  /** Total time long tasks ran beyond the 50 ms budget — the part that actually delays input. */
  longTaskBlockingMs: number;
  /** Visible time sampled since the last reset, across the whole run (not just the window). */
  activeMs: number;
}

export interface VisibilitySource {
  isHidden(): boolean;
  /** Calls `listener` on every visibility change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export interface FrameProfilerOptions {
  /** How many of the most recent frame intervals the statistics cover. Default 600. */
  windowSize?: number;
  raf?: (callback: (timestamp: number) => void) => number;
  caf?: (id: number) => void;
  visibility?: VisibilitySource;
  /**
   * Subscribes to long-task durations; returns a disconnect function, or undefined when the
   * browser cannot report them. Defaults to a `longtask` PerformanceObserver (Chromium only).
   */
  observeLongTasks?: (onDuration: (durationMs: number) => void) => (() => void) | undefined;
}

export interface FrameProfiler {
  /** Begin sampling. A no-op while already running; does not clear earlier samples. */
  start(): void;
  /** Stop sampling and release the rAF loop, the visibility listener and the observer. */
  stop(): void;
  /** Discard every sample and counter. Leaves the running state as it was. */
  reset(): void;
  snapshot(): Readonly<FrameProfilerSnapshot>;
}

const documentVisibility: VisibilitySource = {
  isHidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
  subscribe(listener) {
    if (typeof document === "undefined") return () => undefined;
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

function observeBrowserLongTasks(onDuration: (durationMs: number) => void): (() => void) | undefined {
  if (typeof PerformanceObserver === "undefined") return undefined;
  const supported = PerformanceObserver.supportedEntryTypes;
  if (!supported || !supported.includes("longtask")) return undefined;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) onDuration(entry.duration);
    });
    observer.observe({ type: "longtask" });
    return () => observer.disconnect();
  } catch {
    // Some engines list the type but refuse to observe it (embedded webviews, older Safari).
    return undefined;
  }
}

export function createFrameProfiler(options: FrameProfilerOptions = {}): FrameProfiler {
  const windowSize = Math.max(2, Math.floor(options.windowSize ?? 600));
  const visibility = options.visibility ?? documentVisibility;
  const observeLongTasks = options.observeLongTasks ?? observeBrowserLongTasks;
  const raf =
    options.raf ?? ((callback: (timestamp: number) => void) => window.requestAnimationFrame(callback));
  const caf = options.caf ?? ((id: number) => window.cancelAnimationFrame(id));

  const ring = new Float64Array(windowSize);
  let filled = 0;
  let writeIndex = 0;
  let activeMs = 0;
  let longTasks = 0;
  let longTaskBlockingMs = 0;

  let running = false;
  let frameId: number | null = null;
  let lastTimestamp: number | null = null;
  let unsubscribeVisibility: (() => void) | null = null;
  let disconnectLongTasks: (() => void) | null = null;

  function record(interval: number) {
    ring[writeIndex] = interval;
    writeIndex = (writeIndex + 1) % windowSize;
    if (filled < windowSize) filled += 1;
    activeMs += interval;
  }

  function onLongTask(durationMs: number) {
    longTasks += 1;
    longTaskBlockingMs += Math.max(0, durationMs - LONG_TASK_BUDGET_MS);
  }

  function tick(timestamp: number) {
    frameId = null;
    if (!running) return;

    const hidden = visibility.isHidden();
    if (lastTimestamp !== null && !hidden) {
      const interval = timestamp - lastTimestamp;
      if (interval > 0 && interval < MAX_INTERVAL_MS) record(interval);
    }
    // A hidden tab (or a frame delivered while hidden) re-baselines instead of contributing a
    // multi-second "frame" that would read as hundreds of dropped ones.
    lastTimestamp = hidden ? null : timestamp;
    frameId = raf(tick);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastTimestamp = null;
      unsubscribeVisibility = visibility.subscribe(() => {
        lastTimestamp = null;
      });
      disconnectLongTasks = observeLongTasks(onLongTask) ?? null;
      frameId = raf(tick);
    },

    stop() {
      if (!running) return;
      running = false;
      if (frameId !== null) caf(frameId);
      frameId = null;
      lastTimestamp = null;
      unsubscribeVisibility?.();
      unsubscribeVisibility = null;
      disconnectLongTasks?.();
      disconnectLongTasks = null;
    },

    reset() {
      filled = 0;
      writeIndex = 0;
      activeMs = 0;
      longTasks = 0;
      longTaskBlockingMs = 0;
      lastTimestamp = null;
    },

    snapshot() {
      const summary = summariseIntervals(ring, filled);
      return Object.freeze({
        running,
        frames: filled,
        refreshIntervalMs: summary.refreshIntervalMs,
        refreshHz: summary.refreshHz,
        averageFrameMs: summary.averageMs,
        p95FrameMs: summary.p95Ms,
        maxFrameMs: summary.maxMs,
        droppedFrames: summary.droppedFrames,
        droppedFramePercent: summary.droppedFramePercent,
        longTasks,
        longTaskBlockingMs,
        activeMs,
      });
    },
  };
}
