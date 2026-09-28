"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/motion/reducedMotion";

interface StatCounterProps {
  target: number;
  suffix?: string;
  className?: string;
}

/** A stat that counts up to its real value when it scrolls into view.
 *
 * The value React renders — on the server, and on the first client render — is always the real
 * one, and React never renders anything else: the JSX below is a constant. An earlier version
 * started at "0" and only reached the real number once the browser had hydrated, run an
 * IntersectionObserver and animated: the served HTML said "0+ students supported", which is what a
 * crawler, a reader view, or anyone whose JS hadn't run yet actually got. It also hydrated
 * inconsistently, because the initial state was computed from `prefers-reduced-motion` — false on
 * the server by definition, possibly true in the browser — so a visitor with reduced motion enabled
 * hit a hydration mismatch and React threw the subtree away and re-rendered it.
 *
 * Counting up is therefore something this adds *after* hydration, and only when it can do it
 * without ever showing a number that isn't true: if the element is already on screen when the page
 * loads there's nothing to reveal, so it simply stays at its real value rather than jumping back
 * to zero to animate at someone who is already reading it.
 *
 * The count itself is written straight to the text node from the animation-frame callback
 * (plan11.md task 4). It used to be `setState` on every frame — about fifty React renders to change
 * one number's text — and a number ticking up is exactly the case that does not need React: nothing
 * else depends on the intermediate values. Because the JSX never changes, React has nothing to
 * reconcile, so its text and the DOM's can never disagree; and cleanup always restores the real
 * value, so an interrupted count can't leave a wrong number behind. */
export function StatCounter({ target, suffix = "", className }: StatCounterProps) {
  const ref = useRef<HTMLElement>(null);
  const finalValue = `${target}${suffix}`;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return;
    // Already in view at load — see the note above.
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    el.textContent = `0${suffix}`;

    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        observer.disconnect();

        const duration = 900;
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = `${Math.round(target * eased)}${suffix}`;
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.18 },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      el.textContent = finalValue;
    };
  }, [target, suffix, finalValue]);

  return (
    <b ref={ref} className={className}>
      {finalValue}
    </b>
  );
}
