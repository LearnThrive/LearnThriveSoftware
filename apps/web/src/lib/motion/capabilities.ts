"use client";

import { useEffect, useState } from "react";

export type MotionTier = "full" | "standard" | "light" | "reduced";

/**
 * plan11.md Task 3's four-tier system (plan10.md's own three-tier version collapsed "standard"
 * and "light" together, since nothing shipped in that pass actually needed the distinction —
 * Task 3 restores it now that more capability-gated work is landing):
 *
 * - "reduced": prefers-reduced-motion is on. Scroll-linked transforms and scenes render their
 *   static end state immediately; only opacity/colour transitions are allowed.
 * - "light": a touch-primary or narrow (<600px) device. The leanest capable tier — simplified
 *   choreography, no pointer-driven effects, small-scale transforms only.
 * - "standard": a modest/mid viewport (600-900px) or otherwise-uncertain device. Scroll
 *   choreography runs in full, but pointer depth/parallax and any Canvas/WebGL-tier work stay
 *   off — plan11.md's Global Constraints: "uncertain devices default to standard."
 * - "full": everything, including pointer-driven depth and (if ever shipped) Canvas/WebGL.
 */
// Exported (not just used internally) so tests can exercise the actual selection logic against
// a fake `window.matchMedia`, rather than duplicating the branching in a test-only copy that
// could silently drift from the real thing.
export function computeTier(): MotionTier {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "full";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "reduced";
  if (window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 600px)").matches) {
    return "light";
  }
  if (window.matchMedia("(max-width: 900px)").matches) return "standard";
  return "full";
}

export function useMotionTier(): MotionTier {
  // Always "full" on the very first render, client or server — never computeTier() directly as
  // the lazy initializer. That would read the real client environment synchronously on the
  // client's first render (e.g. a genuinely narrow/reduced-motion device immediately resolving
  // to "light"/"reduced"), while the server — no window, no way to know — always assumes "full".
  // Any consumer that uses the tier to pick between two *different* rendered values at rest
  // (an asymmetric transform range, a conditional branch) would hydrate-mismatch the moment tier
  // differs, exactly as LearningPathScene.tsx and SafeguardingScene.tsx did before their own
  // fixes. Fixing it once here, centrally, means no future consumer has to remember that rule
  // themselves — the real tier always arrives via the effect below, one microtask after mount,
  // imperceptible in practice but never part of the initial hydration comparison.
  const [tier, setTier] = useState<MotionTier>("full");

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const narrowLight = window.matchMedia("(max-width: 600px)");
    const narrowStandard = window.matchMedia("(max-width: 900px)");

    const update = () => queueMicrotask(() => setTier(computeTier()));
    update();
    reduced.addEventListener("change", update);
    coarse.addEventListener("change", update);
    narrowLight.addEventListener("change", update);
    narrowStandard.addEventListener("change", update);
    return () => {
      reduced.removeEventListener("change", update);
      coarse.removeEventListener("change", update);
      narrowLight.removeEventListener("change", update);
      narrowStandard.removeEventListener("change", update);
    };
  }, []);

  return tier;
}

/**
 * plan11.md Task 3: reusable viewport/document activity for continuous scenes — a decorative
 * loop (marquee, ambient background, a future Canvas scene) should suspend when the tab is
 * hidden, and `active` additionally reflects whether the subject element itself is on screen, so
 * a caller can stop rAF/canvas work for a scene scrolled far out of view without each scene
 * re-implementing its own IntersectionObserver + visibilitychange wiring.
 */
export function usePageActivity(target?: React.RefObject<Element | null>): { visible: boolean; active: boolean } {
  const [visible, setVisible] = useState(true);
  const [intersecting, setIntersecting] = useState(true);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const el = target?.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setIntersecting(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  return { visible, active: visible && intersecting };
}
