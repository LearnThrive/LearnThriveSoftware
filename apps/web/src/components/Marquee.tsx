"use client";

import { useEffect, useRef } from "react";
import { isPageVisible, observeInView, subscribePageVisibility } from "@/lib/motion/activity";
import { useMotionTier } from "@/lib/motion/capabilities";
import { subscribeScroll } from "@/lib/motion/scrollStore";
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
 *
 * Plan15 Wave 6 section 10.6: on the full and standard tiers the strip also quickens a little while
 * the page is being scrolled — playback rate rises with scroll speed (up to ~2.6x) and eases back to
 * 1 when scrolling stops. It is the Web Animations `playbackRate` of the one CSS animation, so it is
 * still compositor work; the scroll store listener exists only while the strip is on screen, and it
 * never reverses the strip. Light and reduced tiers keep the constant speed.
 */
const SPEED_UP_PER_PX_S = 1 / 1200; // +1x of playback rate per 1200 px/s of scroll
const MAX_EXTRA_RATE = 1.6;

export function Marquee({ items, direction = "left" }: MarqueeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tier = useMotionTier();
  const reactsToScroll = tier === "full" || tier === "standard";
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

    const track = element.firstElementChild as HTMLElement | null;
    let rate = 1;
    const setRate = (next: number) => {
      rate = next;
      track?.getAnimations().forEach((animation) => {
        if (typeof animation.updatePlaybackRate === "function") animation.updatePlaybackRate(next);
        else animation.playbackRate = next;
      });
    };
    let stopScroll: (() => void) | null = null;
    const syncScrollListener = () => {
      const wanted = reactsToScroll && onScreen && visible;
      if (wanted && !stopScroll) {
        stopScroll = subscribeScroll((snapshot) => {
          // Resting (or decayed to it) is exactly 1; otherwise ease toward the target rate.
          if (snapshot.velocity === 0) return setRate(1);
          const target = 1 + Math.min(MAX_EXTRA_RATE, Math.abs(snapshot.velocity) * SPEED_UP_PER_PX_S);
          setRate(rate + (target - rate) * 0.25);
        });
      } else if (!wanted && stopScroll) {
        stopScroll();
        stopScroll = null;
        if (rate !== 1) setRate(1);
      }
    };

    const stopWatchingViewport = observeInView(
      element,
      (inView) => {
        onScreen = inView;
        apply();
        syncScrollListener();
      },
      "160px",
    );
    const stopWatchingPage = subscribePageVisibility(() => {
      visible = isPageVisible();
      apply();
      syncScrollListener();
    });
    apply();
    syncScrollListener();

    return () => {
      stopWatchingViewport();
      stopWatchingPage();
      stopScroll?.();
      if (rate !== 1) setRate(1);
      delete element.dataset.paused;
    };
  }, [reactsToScroll]);

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
