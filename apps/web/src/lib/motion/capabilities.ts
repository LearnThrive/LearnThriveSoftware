"use client";

import { useEffect, useState } from "react";

export type MotionTier = "full" | "light" | "reduced";

/**
 * A deliberately small version of plan10.md section 34's four-tier system (full/standard/
 * light/reduced) — collapsed to three, because "standard" and "light" would differ only in
 * whether Canvas/heavy scroll choreography runs, and this codebase isn't shipping a Canvas
 * scene in this pass (see the deferred-items note in the scenes README). What each tier gates:
 *
 * - "reduced": prefers-reduced-motion is on. Scroll-linked transforms and scenes render their
 *   static end state immediately; only opacity/colour transitions are allowed.
 * - "light": a touch-primary or narrow (<900px) device. Scroll choreography still runs (the
 *   scenes remain readable and functional) but pointer-driven effects (parallax-by-cursor,
 *   magnetic buttons) are skipped — plan10.md section 32's "no pointer features" on mobile.
 * - "full": everything.
 */
function computeTier(): MotionTier {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "full";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "reduced";
  if (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 900px)").matches) {
    return "light";
  }
  return "full";
}

export function useMotionTier(): MotionTier {
  // Lazy initializer, not a synchronous setState-in-effect: this reads the real value on first
  // render (client-only — computeTier() returns "full" during SSR, matched by the server's own
  // markup, so there's no hydration mismatch, just a one-frame-late correction on mount if the
  // real client environment differs).
  const [tier, setTier] = useState<MotionTier>(computeTier);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const narrow = window.matchMedia("(max-width: 900px)");

    const update = () => setTier(computeTier());
    reduced.addEventListener("change", update);
    coarse.addEventListener("change", update);
    narrow.addEventListener("change", update);
    return () => {
      reduced.removeEventListener("change", update);
      coarse.removeEventListener("change", update);
      narrow.removeEventListener("change", update);
    };
  }, []);

  return tier;
}
