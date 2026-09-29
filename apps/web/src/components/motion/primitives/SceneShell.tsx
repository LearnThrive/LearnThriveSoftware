import type { ReactNode } from "react";
import styles from "./SceneShell.module.css";

/**
 * The outer frame every plan12 cinematic section sits in — tone, clipping and containment only
 * (plan12.md task 2). A Server Component on purpose: it has no interactive or scroll-linked
 * behaviour of its own, so nothing here forces a route's shell into the client bundle. Everything
 * that actually moves — a `CinematicBackdrop`, a `ParallaxLayer`, a scene's own `useScene()` — lives
 * inside `children`, scoped to its own scroll source; `SceneShell` never attaches one, matching
 * plan11.md's "one scroll source per scene" rule extended to "SceneShell doesn't get to have one
 * at all".
 *
 * `overflow: hidden` gives absolutely-positioned decoration (a `CinematicBackdrop`, a
 * `ParallaxLayer` that drifts a few px past its box) a stable clipping context, and `isolation:
 * isolate` keeps that decoration's stacking order contained to this section rather than leaking
 * into a sibling's.
 */
export type SceneTone = "navy" | "cream" | "white" | "mint";
export type SceneIntensity = "quiet" | "medium" | "flagship";

export type SceneShellProps = {
  id?: string;
  tone: SceneTone;
  /** quiet: a support section. medium: a normal flagship-adjacent section. flagship: full-bleed, min-height 100svh. */
  intensity?: SceneIntensity;
  className?: string;
  children: ReactNode;
};

const TONE_CLASS: Record<SceneTone, string> = {
  navy: styles.toneNavy,
  cream: styles.toneCream,
  white: styles.toneWhite,
  mint: styles.toneMint,
};

const INTENSITY_CLASS: Record<SceneIntensity, string> = {
  quiet: styles.intensityQuiet,
  medium: styles.intensityMedium,
  flagship: styles.intensityFlagship,
};

export function SceneShell({ id, tone, intensity = "medium", className, children }: SceneShellProps) {
  const joined = [styles.shell, TONE_CLASS[tone], INTENSITY_CLASS[intensity], className].filter(Boolean).join(" ");
  return (
    <section id={id} className={joined} data-scene-tone={tone} data-scene-intensity={intensity}>
      {children}
    </section>
  );
}
