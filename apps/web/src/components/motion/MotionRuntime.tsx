"use client";

import { LazyMotion, domAnimation } from "framer-motion";
import type { ReactNode } from "react";

/**
 * plan11.md Task 3: one shared LazyMotion boundary around the public site's motion islands,
 * instead of every scene component (HeroScene, LearningPathScene, ProductStoryScene,
 * SafeguardingScene, and every scene still to come) wrapping its own redundant
 * `<LazyMotion features={domAnimation}>`. LazyMotion's feature bundle is provided via React
 * context, so any `m.*` component anywhere under this one boundary works without needing its own
 * direct LazyMotion ancestor — this removes N duplicate feature-bundle references without
 * changing what actually loads.
 *
 * Deliberately does NOT also add `<MotionConfig reducedMotion="user">` here. Every existing scene
 * already has its own carefully-verified `useReducedMotion()` handling (see LearningPathScene.tsx
 * and SafeguardingScene.tsx's comments on the hydration-mismatch bugs that manual handling had to
 * work around) — layering Motion's own global reduced-motion suppression on top risks a new,
 * different inconsistency between what MotionConfig silently suppresses and what each scene's
 * own logic already expects, for no proven benefit over the existing per-scene checks.
 *
 * A Client Component wrapping Server Component children is safe and intentional here — this
 * doesn't turn the marketing pages into client-rendered pages, it only adds one client boundary
 * at the point motion actually starts, exactly as plan11.md's Global Constraints require
 * ("Server Components remain the default... do not convert whole marketing pages to Client
 * Components solely for animation").
 */
export function MotionRuntime({ children }: { children: ReactNode }) {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}
