"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useMotionTier } from "@/lib/motion/capabilities";
import { shouldShowMotionDebug } from "@/lib/motion/debug";
import { createFrameProfiler } from "@/lib/motion/frameProfiler";
import { prefersReducedMotion } from "@/lib/motion/reducedMotion";
import styles from "./MotionDebugOverlay.module.css";

/**
 * plan11.md task 1: a live readout of the numbers every later motion task is judged by — the
 * cadence the page is actually producing frames at, how long its typical and worst frames take,
 * how many frames it drops, long tasks, and the state of the motion system around them (tier,
 * reduced-motion, visibility, route, and the scene currently on screen).
 *
 * Off unless asked for: lib/motion/debug.ts decides, and in production it needs both a
 * build-time opt-in and `?motionDebug=1`. The gate is a useSyncExternalStore so the server and the
 * first client render agree (both render nothing) and hydration never mismatches; the panel — and
 * with it the rAF loop, the PerformanceObserver and the IntersectionObserver — only exists once
 * the gate opens, so a normal visit pays for none of it.
 *
 * Nothing that changes at frame or sample cadence goes through React: the profiler runs outside it,
 * and the readout is written straight into the DOM ~4 times a second. A debug tool that re-rendered
 * the page it was measuring would be measuring itself.
 *
 * A scene shows up in the "scene" row by carrying `data-motion-scene="<label>"` — the overlay
 * discovers those attributes itself, so scenes need no runtime code for it.
 */

const REFRESH_MS = 250;
/** plan11.md performance targets: <2% dropped frames during normal marketing scroll. */
const DROPPED_FRAME_WARN_PERCENT = 2;

const subscribeNever = () => () => undefined;
const getServerSnapshot = () => false;
function getClientSnapshot() {
  return shouldShowMotionDebug({
    nodeEnv: process.env.NODE_ENV,
    productionOptIn: process.env.NEXT_PUBLIC_MOTION_DEBUG === "1",
    search: window.location.search,
  });
}

export function MotionDebugOverlay() {
  const enabled = useSyncExternalStore(subscribeNever, getClientSnapshot, getServerSnapshot);
  return enabled ? <MotionDebugPanel /> : null;
}

const ROWS: ReadonlyArray<readonly [field: string, label: string]> = [
  ["hz", "cadence"],
  ["average", "avg frame"],
  ["p95", "p95 frame"],
  ["dropped", "dropped"],
  ["longTasks", "long tasks"],
  ["tier", "tier"],
  ["reduced", "reduced motion"],
  ["visibility", "document"],
  ["route", "route"],
  ["scene", "scene"],
];

function MotionDebugPanel() {
  const tier = useMotionTier();
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);

  // The frame profiler and the numeric readout. One interval, direct textContent writes.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const field = (name: string) => root.querySelector<HTMLElement>(`[data-field="${name}"]`);
    const hz = field("hz");
    const average = field("average");
    const p95 = field("p95");
    const dropped = field("dropped");
    const longTasks = field("longTasks");
    const reduced = field("reduced");
    const visibility = field("visibility");
    const droppedRow = dropped?.parentElement ?? null;

    const profiler = createFrameProfiler({ windowSize: 480 });
    profiler.start();

    const paint = () => {
      const snapshot = profiler.snapshot();
      const measured = snapshot.frames > 0;
      if (hz) {
        hz.textContent = measured
          ? `${snapshot.refreshHz.toFixed(0)} Hz (${snapshot.refreshIntervalMs.toFixed(1)} ms)`
          : "measuring…";
      }
      if (average) average.textContent = measured ? `${snapshot.averageFrameMs.toFixed(1)} ms` : "–";
      if (p95) p95.textContent = measured ? `${snapshot.p95FrameMs.toFixed(1)} ms` : "–";
      if (dropped) {
        dropped.textContent = measured
          ? `${snapshot.droppedFramePercent.toFixed(1)}% (${snapshot.droppedFrames})`
          : "–";
      }
      droppedRow?.classList.toggle(
        styles.warn,
        measured && snapshot.droppedFramePercent >= DROPPED_FRAME_WARN_PERCENT,
      );
      if (longTasks) {
        longTasks.textContent = `${snapshot.longTasks} (${snapshot.longTaskBlockingMs.toFixed(0)} ms over)`;
      }
      if (reduced) reduced.textContent = prefersReducedMotion() ? "on" : "off";
      if (visibility) visibility.textContent = document.visibilityState;
    };

    paint();
    const timer = window.setInterval(paint, REFRESH_MS);
    document.addEventListener("visibilitychange", paint);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", paint);
      profiler.stop();
    };
  }, []);

  // The active-scene label. Re-scans when the route changes, because a client-side navigation
  // replaces the page's scenes without remounting this layout-level panel.
  useEffect(() => {
    const label = rootRef.current?.querySelector<HTMLElement>('[data-field="scene"]');
    if (!label || typeof IntersectionObserver === "undefined") return;

    const visible = new Map<Element, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
        let best: Element | null = null;
        let bestRatio = 0;
        for (const [target, ratio] of visible) {
          if (ratio > bestRatio) {
            best = target;
            bestRatio = ratio;
          }
        }
        label.textContent = best?.getAttribute("data-motion-scene") ?? "–";
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );

    const scan = () => {
      document.querySelectorAll("[data-motion-scene]").forEach((node) => observer.observe(node));
    };
    scan();
    // A client navigation commits the new page's scenes in the same pass as this effect; the
    // delayed second scan catches any that arrive a beat later (lazily rendered islands).
    const late = window.setTimeout(scan, 400);
    return () => {
      window.clearTimeout(late);
      observer.disconnect();
    };
  }, [pathname]);

  return (
    <div ref={rootRef} className={styles.panel} data-motion-debug="" aria-hidden="true">
      <p className={styles.title}>motion debug</p>
      <dl className={styles.list}>
        {ROWS.map(([field, label]) => (
          <div key={field} className={styles.row}>
            <dt>{label}</dt>
            <dd data-field={field}>
              {field === "tier" ? tier : field === "route" ? pathname : "–"}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
