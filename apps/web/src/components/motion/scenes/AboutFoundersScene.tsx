"use client";

import { createContext, useContext, type ReactNode, type RefObject } from "react";
import { useMotionValue, type MotionValue } from "framer-motion";
import { useScene } from "@/lib/motion/scroll";
import { ParallaxLayer } from "@/components/motion/primitives/ParallaxLayer";

/**
 * plan12.md task 11: "controlled photo/content parallax only where real imagery supports it" — the
 * founders' own portraits, the one real photography on this page. One shared scroll source for the
 * whole founders section (not one `useScene()` per portrait — the same "one scroll source per
 * scene" rule SubjectsScene.tsx's own comment documents), provided via context so
 * `FounderPortraitParallax` can wrap just the `<Image>` it's given.
 */
const FoundersProgressContext = createContext<MotionValue<number> | null>(null);

export function AboutFoundersScene({ children }: { children: ReactNode }) {
  const { ref, smoothProgress } = useScene(["start end", "end start"]);
  return (
    <FoundersProgressContext.Provider value={smoothProgress}>
      <div ref={ref as RefObject<HTMLDivElement>}>{children}</div>
    </FoundersProgressContext.Provider>
  );
}

export function FounderPortraitParallax({ children }: { children: ReactNode }) {
  const sharedProgress = useContext(FoundersProgressContext);
  const fallbackProgress = useMotionValue(0);
  const progress = sharedProgress ?? fallbackProgress;
  return (
    <ParallaxLayer progress={progress} from={0} to={14}>
      {children}
    </ParallaxLayer>
  );
}
