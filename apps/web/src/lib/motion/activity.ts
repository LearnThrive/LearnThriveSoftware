"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import { useMotionTier } from "./capabilities";

/**
 * "Should continuous work be running right now?" — the question every ambient loop, marquee and
 * scroll-linked scene has to ask, answered once for the whole marketing site (plan11.md task 3).
 *
 * Two things decide it, and they are deliberately separate:
 *   1. the page: is the document visible at all (usePageActivity)?
 *   2. the element: is *this* scene anywhere near the viewport (useInViewport / observeInView)?
 * useSceneActivity is the conjunction, which is what a continuous decorative effect wants.
 *
 * Both are shared, not per-caller: one `visibilitychange` listener however many components read the
 * page state, and one IntersectionObserver per rootMargin however many elements are watched. Twenty
 * scenes each attaching their own observer and listener is exactly the kind of quiet, permanent
 * overhead a smooth-scrolling page can't afford.
 */

// ── Document visibility ────────────────────────────────────────────────────────────────────

const visibilityListeners = new Set<() => void>();
const notifyVisibility = () => visibilityListeners.forEach((listener) => listener());

function subscribeVisibility(listener: () => void) {
  visibilityListeners.add(listener);
  if (visibilityListeners.size === 1) document.addEventListener("visibilitychange", notifyVisibility);
  return () => {
    visibilityListeners.delete(listener);
    if (visibilityListeners.size === 0) document.removeEventListener("visibilitychange", notifyVisibility);
  };
}

const getVisible = () => document.visibilityState !== "hidden";
// Rendered on the server, and by the hydrating render: a page being served is, by definition, about
// to be visible. The real value follows immediately after hydration.
const getServerVisible = () => true;

/** Page visibility without React, sharing the same single `visibilitychange` listener. */
export { subscribeVisibility as subscribePageVisibility, getVisible as isPageVisible };

export interface PageActivity {
  /** The document is on screen (its tab is foregrounded, its window not minimised). */
  visible: boolean;
  /**
   * Continuous decorative work may run: the document is visible *and* the visitor has not asked for
   * reduced motion. A loop that gates on this needs no separate tier or reduced-motion check.
   */
  active: boolean;
}

export function usePageActivity(): PageActivity {
  const visible = useSyncExternalStore(subscribeVisibility, getVisible, getServerVisible);
  const tier = useMotionTier();
  return useMemo(() => ({ visible, active: visible && tier !== "reduced" }), [visible, tier]);
}

// ── Viewport activity ──────────────────────────────────────────────────────────────────────

interface Watcher {
  observer: IntersectionObserver;
  callbacks: Map<Element, Set<(inView: boolean) => void>>;
}

const watchers = new Map<string, Watcher>();

/**
 * Calls `callback(true|false)` whenever `element` enters or leaves the viewport (grown by
 * `rootMargin`, so a scene can start a little before it is visible). Returns the unsubscribe.
 * Framework-free on purpose: a scene driving MotionValues or direct DOM writes can use this
 * without a React state update in the loop.
 */
export function observeInView(
  element: Element,
  callback: (inView: boolean) => void,
  rootMargin = "0px",
): () => void {
  if (typeof IntersectionObserver === "undefined") return () => undefined;

  let watcher = watchers.get(rootMargin);
  if (!watcher) {
    const callbacks = new Map<Element, Set<(inView: boolean) => void>>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) callbacks.get(entry.target)?.forEach((notify) => notify(entry.isIntersecting));
      },
      { rootMargin },
    );
    watcher = { observer, callbacks };
    watchers.set(rootMargin, watcher);
  }

  let subscribers = watcher.callbacks.get(element);
  if (!subscribers) {
    subscribers = new Set();
    watcher.callbacks.set(element, subscribers);
    watcher.observer.observe(element);
  }
  subscribers.add(callback);

  return () => {
    const current = watchers.get(rootMargin);
    const remaining = current?.callbacks.get(element);
    if (!current || !remaining) return;
    remaining.delete(callback);
    if (remaining.size > 0) return;
    current.callbacks.delete(element);
    current.observer.unobserve(element);
    if (current.callbacks.size === 0) {
      current.observer.disconnect();
      watchers.delete(rootMargin);
    }
  };
}

/** Whether the referenced element is in (or within `rootMargin` of) the viewport. False until known. */
export function useInViewport(ref: RefObject<Element | null>, rootMargin = "0px"): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observeInView(element, setInView, rootMargin);
  }, [ref, rootMargin]);
  return inView;
}

/**
 * True while a continuous scene should be running: the page is active and the scene is on or
 * near the screen. The margin lets it spin up just before it is seen rather than after.
 */
export function useSceneActivity(ref: RefObject<Element | null>, rootMargin = "160px"): boolean {
  const { active } = usePageActivity();
  const inView = useInViewport(ref, rootMargin);
  return active && inView;
}
