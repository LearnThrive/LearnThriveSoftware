"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { cancelFrame, frame } from "framer-motion";
import { useFinePointer, useMotionTier } from "@/lib/motion/capabilities";
import {
  isTouchpadLikeWheel,
  shouldSmoothScroll,
  SMOOTH_SCROLL_BUILD_ENABLED,
  SMOOTH_SCROLL_OPTIONS,
  SMOOTH_SCROLL_QUERY,
  SMOOTH_SCROLL_STORAGE_KEY,
  smoothScrollEasing,
} from "@/lib/motion/smoothScroll";

/**
 * Smooth scrolling for the public marketing site (plan15 Wave 4), via Lenis, with guardrails.
 * Renders nothing. Mounted once in the (public) layout, so the authenticated app, the dashboard and
 * the classroom — data-dense tools — keep native scrolling.
 *
 * Tiers: full and standard, with a fine pointer; never on reduced motion, light, touch or
 * Save-Data (see lib/motion/smoothScroll.ts). The library is imported dynamically, so none of it
 * is in the page's critical path or in the bundle of a visitor who never qualifies.
 *
 * What makes it safe to add:
 *  - Lenis moves the browser's REAL scroll position. Motion's useScroll, `position: sticky`,
 *    IntersectionObserver reveals and every scene keep working unchanged.
 *  - ONE animation loop: Lenis is advanced from Motion's own frame scheduler (`frame.update`), not
 *    from a second requestAnimationFrame loop competing with it.
 *  - Native behaviour is left alone: keyboard scrolling, Tab-into-view, find-in-page, text-selection
 *    autoscroll, zoom, scrollbar dragging, middle-click autoscroll. Precision-touchpad wheel streams
 *    are handed back to the browser event by event (they already scroll smoothly).
 *  - Nested scrollers opt out (`data-lenis-prevent`, plus Lenis' own nested-scroll detection), and
 *    smoothing is paused while the mobile menu is open (`body.menu-open`).
 *  - In-page anchors scroll through Lenis to the document's `scroll-padding-top`, update the URL
 *    hash, and MOVE FOCUS to the target so keyboard and screen-reader users land where the page
 *    does. The FAQ's hash opener still hears the change.
 *  - Switchable off: NEXT_PUBLIC_SMOOTH_SCROLL=0 at build time, `?smooth=0` at run time.
 */
export function SmoothScroll() {
  const tier = useMotionTier();
  const finePointer = useFinePointer();
  const pathname = usePathname();

  useEffect(() => {
    // Evaluated in the effect (never during render): it reads window and remembers `?smooth=0` for
    // the tab, and nothing about it may differ between the server's HTML and the first client render.
    let storedOff = false;
    try {
      const params = new URLSearchParams(window.location.search);
      const asked = params.get(SMOOTH_SCROLL_QUERY);
      if (asked === "0") window.sessionStorage.setItem(SMOOTH_SCROLL_STORAGE_KEY, "0");
      else if (asked === "1") window.sessionStorage.removeItem(SMOOTH_SCROLL_STORAGE_KEY);
      storedOff = window.sessionStorage.getItem(SMOOTH_SCROLL_STORAGE_KEY) === "0";
    } catch {
      /* storage unavailable: just the query */
    }
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const qualifies = shouldSmoothScroll({
      tier,
      finePointer,
      saveData: connection?.saveData === true,
      buildEnabled: SMOOTH_SCROLL_BUILD_ENABLED,
      search: window.location.search,
      storedOff,
    });
    if (!qualifies) return;
    let cancelled = false;
    let teardown: (() => void) | undefined;

    void import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;

      const lenis = new Lenis({
        autoRaf: false,
        duration: SMOOTH_SCROLL_OPTIONS.duration,
        easing: smoothScrollEasing,
        wheelMultiplier: SMOOTH_SCROLL_OPTIONS.wheelMultiplier,
        syncTouch: SMOOTH_SCROLL_OPTIONS.syncTouch,
        smoothWheel: true,
        allowNestedScroll: true,
        // Returning false hands the event back to the browser: precision touchpads already scroll
        // smoothly and must not be smoothed twice.
        virtualScroll: ({ deltaX, deltaY, event }) => {
          if (event.type !== "wheel") return true;
          return !isTouchpadLikeWheel({ deltaX, deltaY, deltaMode: (event as WheelEvent).deltaMode });
        },
      });
      (window as unknown as { __lenis?: unknown }).__lenis = lenis;
      document.documentElement.setAttribute("data-smooth-scroll", "on");

      // One loop: Motion's frame scheduler drives Lenis. `keepAlive` re-runs it every frame while
      // the page is open, which is what Lenis needs to animate and to notice native scrolls.
      const onFrame = ({ timestamp }: { timestamp: number }) => lenis.raf(timestamp);
      frame.update(onFrame, true);

      // Pause while the mobile menu (or anything else that locks body scroll) is open.
      const syncLock = () => {
        // The mobile menu and any open dialog or command palette lock the page.
        if (document.body.classList.contains("menu-open") || document.body.classList.contains("has-dialog")) lenis.stop();
        else lenis.start();
      };
      const lockObserver = new MutationObserver(syncLock);
      lockObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      syncLock();

      // In-page anchors.
      const onClick = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!link || !link.hash || link.target === "_blank" || link.hasAttribute("download")) return;
        if (link.origin !== window.location.origin || link.pathname !== window.location.pathname) return;
        let target: HTMLElement | null = null;
        try {
          target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
        } catch {
          target = document.getElementById(link.hash.slice(1));
        }
        if (!target) return;

        // Ours, not the browser's and not Next's: a next/link hash link would otherwise run its own
        // jump (this listener is in the capture phase precisely to get there first).
        event.preventDefault();
        event.stopPropagation();
        // No explicit offset: Lenis already honours the document's scroll-padding-top (and the
        // target's scroll-margin), exactly as the native jump does. Passing one as well applied it twice.
        lenis.scrollTo(target);
        if (window.location.hash !== link.hash) {
          window.history.pushState(null, "", link.hash);
          // pushState fires no hashchange; the FAQ's hash opener (and anything else) listens for it.
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }
        // Keyboard and screen-reader users land where the page does.
        if (!target.hasAttribute("tabindex") && !/^(a|button|input|select|textarea|summary)$/i.test(target.tagName)) {
          target.setAttribute("tabindex", "-1");
        }
        target.focus({ preventScroll: true });
      };
      document.addEventListener("click", onClick, true);

      // Browser Back/Forward: the browser restores the scroll position itself, and an animation
      // Lenis still has in flight (a smooth scroll to an anchor, say) would otherwise carry on
      // toward its old destination and override the restored position. Drop the animation and adopt
      // wherever the browser put the page — once now, and again after the restore has settled
      // (it can land a frame after popstate).
      const adoptNativePosition = () => lenis.scrollTo(window.scrollY, { immediate: true, force: true });
      const onPopState = () => {
        adoptNativePosition();
        requestAnimationFrame(() => requestAnimationFrame(adoptNativePosition));
      };
      window.addEventListener("popstate", onPopState);

      teardown = () => {
        document.removeEventListener("click", onClick, true);
        window.removeEventListener("popstate", onPopState);
        lockObserver.disconnect();
        cancelFrame(onFrame);
        lenis.destroy();
        document.documentElement.removeAttribute("data-smooth-scroll");
        delete (window as unknown as { __lenis?: unknown }).__lenis;
      };
    });

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [tier, finePointer]);

  // A client-side navigation resets the scroll position (Next scrolls to the top): drop any inertia
  // still in flight so the new page does not keep gliding.
  useEffect(() => {
    const lenis = (window as unknown as { __lenis?: { scrollTo: (y: number, o: { immediate: boolean; force: boolean }) => void } }).__lenis;
    lenis?.scrollTo(window.scrollY, { immediate: true, force: true });
  }, [pathname]);

  return null;
}
