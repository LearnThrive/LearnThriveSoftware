import type { ReactNode } from "react";
import { MotionDebugOverlay } from "@/components/motion/MotionDebugOverlay";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { PublicShell } from "@/components/shell/PublicShell";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* A reveal server-renders its content in its *start* state (Motion writes an inline
          `opacity: 0` and a transform), so a visitor whose JavaScript never runs — blocked, failed
          to load, an extension, a text browser — would get the hero, the marquee and the footer,
          and pure background where everything below the fold should be. (The component this
          replaced left 22 of 22 revealed blocks invisible with scripting off.) <noscript> is the
          one mechanism that can answer that without JavaScript itself: it is parsed only when
          scripting is disabled, so it costs a scripted visitor nothing and never flashes, and
          `!important` is what beats an inline style. Reduced motion gets the same treatment from
          Reveal.module.css; plan12.md's MaskedText (`data-masked-text-inner`, clip-path instead of
          opacity/transform) needs the identical override for the identical reason and is covered
          here too, from MaskedText.module.css. */}
      <noscript>
        <style>{`[data-reveal], [data-reveal-inner] { opacity: 1 !important; transform: none !important; } [data-reveal-rule], [data-underline-draw] { transform: none !important; } [data-masked-text-inner] { clip-path: none !important; opacity: 1 !important; }`}</style>
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
