"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createFrameProfiler, type FrameProfilerSnapshot } from "@/lib/motion/frameProfiler";
import { useMotionTier } from "@/lib/motion/capabilities";
import { useReducedMotion } from "framer-motion";

/**
 * plan11.md Task 1: a development-only overlay showing measured Hz, p95 frame interval,
 * estimated dropped-frame %, long-task count, motion tier, reduced-motion status, document
 * visibility, and route. Never appears in production unless explicitly opted into via
 * `?motionDebug=1` — outside development, silent by default is the safe default for anything
 * that walks the DOM/attaches observers on every page load.
 */
export function MotionDebugOverlay() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tier = useMotionTier();
  const reduceMotion = useReducedMotion();
  const [snapshot, setSnapshot] = useState<FrameProfilerSnapshot | null>(null);
  const [visible, setVisible] = useState(true);

  const enabled =
    process.env.NODE_ENV !== "production" || searchParams.get("motionDebug") === "1";

  useEffect(() => {
    if (!enabled) return;
    const profiler = createFrameProfiler();
    profiler.start();
    const unsubscribe = profiler.subscribe(setSnapshot, 500);
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubscribe();
      profiler.stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 2147483647,
        padding: "10px 12px",
        borderRadius: 8,
        background: "rgba(10, 15, 20, 0.88)",
        color: "#9be7c4",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        lineHeight: 1.6,
        pointerEvents: "none",
        whiteSpace: "pre",
      }}
      aria-hidden="true"
    >
      {`route:      ${pathname}
tier:       ${tier}
reduced:    ${reduceMotion ? "yes" : "no"}
visible:    ${visible ? "yes" : "hidden"}
hz:         ${snapshot?.measuredHz ?? "—"}
avg frame:  ${snapshot?.avgFrameIntervalMs ? `${snapshot.avgFrameIntervalMs.toFixed(1)}ms` : "—"}
p95 frame:  ${snapshot?.p95FrameIntervalMs ? `${snapshot.p95FrameIntervalMs.toFixed(1)}ms` : "—"}
dropped:    ${snapshot?.droppedFramePercent !== null && snapshot?.droppedFramePercent !== undefined ? `${snapshot.droppedFramePercent.toFixed(1)}%` : "—"}
long tasks: ${snapshot?.longTaskCount ?? 0}`}
    </div>
  );
}
