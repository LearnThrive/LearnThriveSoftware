"use client";

import { useEffect, useRef } from "react";
import { isPageVisible, observeInView, subscribePageVisibility } from "@/lib/motion/activity";
import styles from "./Marquee.module.css";

interface MarqueeProps {
  items: string[];
  /** Which way the strip travels: "left" drifts the content leftwards (the default), "right" the other way. */
  direction?: "left" | "right";
}

/**
 * The strip loops by sliding the track exactly half its own width, so each half has to be wider
 * than the widest screen or an empty gap opens at the edge for part of every cycle. One copy of the
 * homepage items is only ~930px, which left a blank run on any desktop wider than that. Repeating
 * the items this many times per half covers screens up to roughly 3500px; Marquee.module.css scales
 * the animation duration by the same number so the on-screen speed stays what it always was.
 */
const REPEATS = 6;

/**
 * A decorative scrolling strip. The scrolling is a pure CSS transform animation, so it costs
 * almost nothing per frame — but it is also infinite, and an infinite animation that runs while
 * the strip is far off screen or the tab is in the background stops the page from ever idling.
 * So it is paused (plan11.md tasks 3 and 5) whenever it is more than a screenful away or the
 * document is hidden.
 *
 * The pause is a `data-paused` attribute written straight onto the element from the shared
 * viewport observer and the shared visibility listener — no React state, no re-render, and no
 * attribute at all until the client takes over, so a visitor without JavaScript still gets the
 * animation exactly as before. It assumes "on screen" until the observer says otherwise, which
 * means it never starts a page paused and then un-pauses.
 */
export function Marquee({ items, direction = "left" }: MarqueeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const half = Array.from({ length: REPEATS }, () => items).flat();
  const looped = [...half, ...half];

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let onScreen = true;
    let visible = isPageVisible();
    const apply = () => {
      element.dataset.paused = onScreen && visible ? "false" : "true";
    };

    const stopWatchingViewport = observeInView(
      element,
      (inView) => {
        onScreen = inView;
        apply();
      },
      "160px",
    );
    const stopWatchingPage = subscribePageVisibility(() => {
      visible = isPageVisible();
      apply();
    });
    apply();

    return () => {
      stopWatchingViewport();
      stopWatchingPage();
      delete element.dataset.paused;
    };
  }, []);

  return (
    <div ref={ref} className={styles.marquee} aria-hidden="true">
      <div className={styles.track} data-direction={direction}>
        {looped.map((item, i) => (
          <span key={i}>{item}</span>
        ))}
      </div>
    </div>
  );
}
