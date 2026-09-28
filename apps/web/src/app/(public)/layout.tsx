import type { ReactNode } from "react";
import { MotionDebugOverlay } from "@/components/motion/MotionDebugOverlay";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { PublicShell } from "@/components/shell/PublicShell";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* ScrollReveal hides its content (`.rv` is opacity: 0 until an IntersectionObserver adds
          `.rv--in`), which means a visitor whose JavaScript never runs — blocked, failed to load,
          an extension, a text browser — gets the hero, the marquee and the footer, and pure
          background where the subjects, how-it-works, testimonials, stats and closing CTA should
          be. 22 of 22 revealed blocks measured invisible with scripting off. <noscript> is the
          one mechanism that can answer this without JavaScript itself: parsed only when scripting
          is disabled, so it costs a scripted visitor nothing and never flashes. */}
      <noscript>
        <style>{`.rv { opacity: 1 !important; transform: none !important; }`}</style>
      </noscript>
      {/* The one Motion runtime for the whole public site (LazyMotion + MotionConfig). It wraps
          the pages without making them client-rendered — see MotionRuntime.tsx. */}
      <MotionRuntime>
        <PublicShell>{children}</PublicShell>
        {/* Renders nothing unless `?motionDebug=1` is present in a development build (or a build
            made with NEXT_PUBLIC_MOTION_DEBUG=1) — see lib/motion/debug.ts. */}
        <MotionDebugOverlay />
      </MotionRuntime>
    </>
  );
}
