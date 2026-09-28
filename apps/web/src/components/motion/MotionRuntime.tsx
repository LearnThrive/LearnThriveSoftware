"use client";

import { useEffect, type ReactNode } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "framer-motion";
import { useMotionTier } from "@/lib/motion/capabilities";

/**
 * The one motion boundary for the public marketing site (plan11.md task 3), mounted once in the
 * (public) layout. Before it, every scene and the Reveal component each wrapped themselves in
 * their own <LazyMotion>: correct, but it meant nothing could assume a runtime was present, and a
 * new motion island had to remember to bring one. Now anything under this boundary just renders
 * `m.*` components and Motion hooks.
 *
 * This is a Client Component, but wrapping `{children}` in it does not turn the pages beneath it
 * into client-rendered ones: a Server Component passed as `children` is rendered on the server and
 * handed through as already-rendered output (the "interleaving" pattern in Next.js's Server and
 * Client Components guide). Only the actual motion islands ship client JavaScript.
 *
 * - `domAnimation`, loaded synchronously, not the async feature bundle: an async bundle would leave
 *   `m` components in their `initial` state until it arrived, and that state is opacity 0 for
 *   reveals. Content must never wait on a feature download. `domMax` (drag/layout animation) is
 *   not used anywhere on this site and stays out of the bundle.
 * - `strict` makes a stray full `motion.*` component throw instead of quietly re-shipping the
 *   whole animation engine that LazyMotion exists to keep out.
 * - `reducedMotion="user"` makes Motion honour the OS setting itself — transform and layout
 *   animations are skipped, opacity and colour still animate — without any per-component
 *   `useReducedMotion` branch. It acts when an animation starts, not while rendering, so it cannot
 *   change server-rendered markup and cannot cause a hydration mismatch.
 *
 * It also mirrors the tier onto <html data-motion-tier>. That lets stylesheets adapt without any
 * JavaScript per element (e.g. `html[data-motion-tier="light"] …`) and gives tests and the debug
 * overlay one place to read it. It is written from an effect, after hydration, so React never sees
 * an attribute on <html> that the server did not render.
 */
export function MotionRuntime({ children }: { children: ReactNode }) {
  const tier = useMotionTier();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.motionTier = tier;
    return () => {
      delete root.dataset.motionTier;
    };
  }, [tier]);

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
