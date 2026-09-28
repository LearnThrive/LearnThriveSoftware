import { Suspense, type ReactNode } from "react";
import { PublicShell } from "@/components/shell/PublicShell";
import { MotionDebugOverlay } from "@/components/motion/MotionDebugOverlay";
import { MotionRuntime } from "@/components/motion/MotionRuntime";

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
      <MotionRuntime>
        <PublicShell>{children}</PublicShell>
      </MotionRuntime>
      {/* Suspense, not a bare render: MotionDebugOverlay reads useSearchParams() for the
          ?motionDebug=1 opt-in, and Next's App Router requires that hook to sit under a Suspense
          boundary — otherwise the whole page tree bails out of static generation to render it,
          which would silently undo every marketing page's Server Component default. */}
      <Suspense fallback={null}>
        <MotionDebugOverlay />
      </Suspense>
    </>
  );
}
