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
  const handleRef = useRef<HeroGradientHandle | null>(null);
  const active = useSceneActivity(containerRef, "200px");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // The canvas is created here rather than rendered by React, on purpose. `dispose()` ends in
    // WEBGL_lose_context.loseContext(), and a canvas element hands back the same — now dead —
    // context for every later getContext() call. React Strict Mode runs each effect twice in
    // development (mount, cleanup, mount again), so a React-owned canvas came back from its own
    // cleanup with a lost context: an opaque white sheet with a broken-image icon painted over the
    // navy hero, hiding its white text. A fresh canvas per effect run means disposing one can never
    // poison the next.
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:100%;height:100%;display:block";
    container.appendChild(canvas);

    const handle = createHeroGradient(canvas);
    handleRef.current = handle;

    let resizeObserver: ResizeObserver | undefined;
    if (handle) {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        handle.resize(entry.contentRect.width, entry.contentRect.height, dpr);
      });
      resizeObserver.observe(container);
    }

    return () => {
      resizeObserver?.disconnect();
      handle?.dispose();
      handleRef.current = null;
      canvas.remove();
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

  return <div ref={containerRef} aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />;
}
