"use client";

import dynamic from "next/dynamic";

/**
 * Mounts the motion debug overlay only in builds that can ever show it (plan15 audit F7). The overlay is
 * gated at runtime (lib/motion/debug.ts: development, or a production build made with
 * NEXT_PUBLIC_MOTION_DEBUG=1 and opened with ?motionDebug=1), but it used to be imported statically, so
 * every production visit still downloaded its stylesheet, and Chrome warned that the preloaded CSS file was
 * "not used within a few seconds". Here the import is behind the same build-time constants, so in a normal
 * production build the branch is dead code: no overlay chunk, no overlay CSS, no warning.
 */
const BUILT_WITH_DEBUG = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_MOTION_DEBUG === "1";

const Overlay = BUILT_WITH_DEBUG
  ? dynamic(() => import("./MotionDebugOverlay").then((module) => module.MotionDebugOverlay), { ssr: false })
  : null;

export function MotionDebugGate() {
  return Overlay ? <Overlay /> : null;
}
