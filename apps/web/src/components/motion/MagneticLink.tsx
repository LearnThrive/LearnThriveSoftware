"use client";

import { useEffect, useRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { useFinePointer, useMotionTier } from "@/lib/motion/capabilities";

/**
 * A link that leans toward the pointer as it approaches (plan15 Wave 7 section 11.1): the hero's
 * main call to action drifts a few pixels toward the cursor, then settles back. Deliberately small
 * (never more than `strength` px, default 8) — an invitation, not a gimmick.
 *
 * Runs on the full tier with a fine pointer only; everywhere else it is exactly a plain anchor.
 * It moves the element with the individual CSS `translate` property, not `transform`, so the
 * button's own hover lift and press scale (a `transform`) keep working untouched.
 *
 * One passive pointermove listener while it is mounted, a requestAnimationFrame loop that exists only
 * while the link is still moving toward its target, no React state anywhere, and nothing at rest.
 */
type MagneticLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
  /** Largest displacement in px. */
  strength?: number;
  /** How close (px, from the link's centre) the pointer must come before it reacts. */
  radius?: number;
};

export function MagneticLink({ children, strength = 8, radius = 120, ...anchorProps }: MagneticLinkProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  const tier = useMotionTier();
  const finePointer = useFinePointer();

  useEffect(() => {
    const element = ref.current;
    if (!element || tier !== "full" || !finePointer) return;

    let frame = 0;
    let x = 0;
    let y = 0;
    let targetX = 0;
    let targetY = 0;

    const step = () => {
      frame = 0;
      x += (targetX - x) * 0.18;
      y += (targetY - y) * 0.18;
      const settled = Math.abs(targetX - x) < 0.05 && Math.abs(targetY - y) < 0.05;
      if (settled) {
        x = targetX;
        y = targetY;
      }
      element.style.translate = x === 0 && y === 0 ? "" : `${x.toFixed(2)}px ${y.toFixed(2)}px`;
      if (!settled) frame = requestAnimationFrame(step);
    };
    const kick = () => {
      if (frame === 0) frame = requestAnimationFrame(step);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const rect = element.getBoundingClientRect();
      // Measure against where the link rests, not where it currently is, or it would chase itself.
      const centreX = rect.left + rect.width / 2 - x;
      const centreY = rect.top + rect.height / 2 - y;
      const dx = event.clientX - centreX;
      const dy = event.clientY - centreY;
      const distance = Math.hypot(dx, dy);
      if (distance > radius + Math.max(rect.width, rect.height) / 2) {
        targetX = 0;
        targetY = 0;
      } else {
        targetX = Math.max(-strength, Math.min(strength, dx * 0.2));
        targetY = Math.max(-strength, Math.min(strength, dy * 0.2));
      }
      kick();
    };
    const onLeaveWindow = () => {
      targetX = 0;
      targetY = 0;
      kick();
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeaveWindow);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeaveWindow);
      if (frame) cancelAnimationFrame(frame);
      element.style.translate = "";
    };
  }, [tier, finePointer, strength, radius]);

  return (
    <a ref={ref} {...anchorProps}>
      {children}
    </a>
  );
}
