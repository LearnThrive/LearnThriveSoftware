"use client";

import { useEffect, useRef } from "react";
import { createHeroGradient, type HeroGradientHandle } from "@/components/motion/webgl/heroGradient";
import { useSceneActivity } from "@/lib/motion/activity";

/**
 * plan12.md task 4's raw-WebGL interactive gradient, mounted only by the dynamic import in
 * `HeroScene.tsx` (never imported statically — see that file for why). This component owns the
 * DOM/lifecycle side: creating the canvas-backed handle on mount, disposing it on unmount, sizing
 * it to its container (DPR capped at 1.5, per the plan's conservative-cap rule), and forwarding
 * pointer position — everything about the render itself lives in `heroGradient.ts`, kept as plain,
 * non-React code on purpose (see that file's own comment).
 *
 * The pointer listener attaches only while `useSceneActivity` says this scene is on/near the
 * screen and the tab is visible — the same primitive `CinematicBackdrop` uses — so nothing here
 * does any work while the hero is scrolled away.
 */
const MAX_DPR = 1.5;

export function HeroWebGLAtmosphere() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<HeroGradientHandle | null>(null);
  const active = useSceneActivity(containerRef, "200px");

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const handle = createHeroGradient(canvas);
    handleRef.current = handle;
    if (!handle) return;

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      handle.resize(entry.contentRect.width, entry.contentRect.height, dpr);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      handle.dispose();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const onMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      handleRef.current?.setPointer((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [active]);

  return (
    <div ref={containerRef} aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
