"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import styles from "./NavigationProgress.module.css";

/**
 * A slim, branded route-progress bar (plan15 Wave 7 section 11.5) for navigations that take a while.
 * It appears only if a navigation is still pending ~150ms after the click, so a fast route change
 * (the common case, with prefetching) shows nothing at all, and finishes the instant the new path
 * renders. It never blocks anything: it is a fixed, `pointer-events: none` strip.
 *
 * Mechanism: the App Router has no navigation-start event, so a capture-phase click listener notes a
 * same-origin link click to a different path, and `usePathname()` changing is the "arrived" signal.
 * The bar itself is driven with a CSS custom property and a transform; there is no React state, so a
 * navigation never re-renders anything because of it. Mounted once in each layout that wants it.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const barRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<{ timer: number; shown: boolean } | null>(null);

  // Arrived: complete and fade out.
  useEffect(() => {
    const bar = barRef.current;
    const pending = pendingRef.current;
    if (!bar || !pending) return;
    window.clearTimeout(pending.timer);
    pendingRef.current = null;
    if (pending.shown) {
      bar.dataset.state = "done";
      window.setTimeout(() => {
        if (!pendingRef.current && barRef.current) barRef.current.dataset.state = "idle";
      }, 360);
    }
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      if (link.origin !== window.location.origin || link.pathname === window.location.pathname) return;
      if (pendingRef.current) window.clearTimeout(pendingRef.current.timer);
      const entry = { timer: 0, shown: false };
      entry.timer = window.setTimeout(() => {
        entry.shown = true;
        if (barRef.current) barRef.current.dataset.state = "loading";
      }, 150);
      pendingRef.current = entry;
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return <div ref={barRef} className={styles.bar} data-state="idle" aria-hidden="true" />;
}
