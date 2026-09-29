"use client";

import { useRef, type ReactNode } from "react";
import { useSceneActivity } from "@/lib/motion/activity";
import { useMotionCapabilities } from "@/lib/motion/capabilities";
import styles from "./CinematicBackdrop.module.css";

/**
 * The atmospheric layer behind a `SceneShell`'s content (plan12.md task 2) — a gradient, an SVG
 * field, a WebGL canvas, whatever the scene needs. This component supplies none of that itself; it
 * is purely the gating/positioning wrapper every backdrop should sit inside, built entirely from
 * plan11's existing activity/capability primitives rather than inventing a second suspension
 * mechanism:
 *
 * - **Tier-aware content.** `children` is the full-richness backdrop (full/standard tiers, subject
 *   to their own further gating inside); `lightChildren` is a deliberately cheaper stand-in for the
 *   light tier (a still gradient, no moving parts) — omit it and the light tier gets nothing rather
 *   than a silently-too-heavy fallback. Reduced motion always renders nothing: the section's tone
 *   carries it, with no spatial atmosphere to replace.
 * - **Suspended, not just hidden.** While the scene is off/near the screen or the tab is hidden
 *   (`useSceneActivity`), content unmounts rather than merely being visually hidden — the one way to
 *   *guarantee* a WebGL context or CSS animation actually stops doing work, not just stops being
 *   seen doing it.
 * - **Never the accessibility tree.** Always `aria-hidden`; a backdrop has no content of its own to
 *   announce.
 */
export type CinematicBackdropProps = {
  children?: ReactNode;
  lightChildren?: ReactNode;
  className?: string;
};

export function CinematicBackdrop({ children, lightChildren, className }: CinematicBackdropProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { tier } = useMotionCapabilities();
  const active = useSceneActivity(ref, "200px");

  if (tier === "reduced") return null;

  const content = tier === "light" ? lightChildren : children;
  if (!content) return null;

  return (
    <div
      ref={ref}
      className={[styles.backdrop, className].filter(Boolean).join(" ")}
      aria-hidden="true"
      data-cinematic-backdrop=""
      data-backdrop-active={active}
    >
      {active ? content : null}
    </div>
  );
}
