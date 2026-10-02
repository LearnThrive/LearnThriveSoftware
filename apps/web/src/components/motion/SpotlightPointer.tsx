"use client";

import { useEffect } from "react";
import { useFinePointer, useMotionTier } from "@/lib/motion/capabilities";

/**
 * The pointer-tracked spotlight border (plan15 Wave 6 section 10.8): a soft light that follows the
 * cursor around the edge of a card. Mounted once for the whole public site, so there is ONE
 * delegated `pointermove` listener, not one per card.
 *
 * It does exactly one thing: while the pointer is over an element carrying `data-spotlight`, it
 * writes the pointer's position, relative to that element, into `--mx` and `--my` (a custom
 * property, no React state, at most once per animation frame). Everything visual is CSS
 * (`[data-spotlight]::before` in globals.css), which is why it costs nothing at rest.
 *
 * Tiers: runs on the full tier with a fine pointer only. Elsewhere nothing attaches, the custom
 * properties are never written, and the card keeps its plain static border (the CSS fades the
 * highlight in on :hover only where `(hover: hover) and (pointer: fine)` holds).
 */
export function SpotlightPointer() {
  const tier = useMotionTier();
  const finePointer = useFinePointer();

  useEffect(() => {
    if (tier !== "full" || !finePointer) return;

    let frame = 0;
    let card: HTMLElement | null = null;
    let x = 0;
    let y = 0;

    const paint = () => {
      frame = 0;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${Math.round(x - rect.left)}px`);
      card.style.setProperty("--my", `${Math.round(y - rect.top)}px`);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const next = (event.target as Element | null)?.closest?.("[data-spotlight]") as HTMLElement | null;
      if (!next) return;
      card = next;
      x = event.clientX;
      y = event.clientY;
      if (frame === 0) frame = requestAnimationFrame(paint);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [tier, finePointer]);

  return null;
}
