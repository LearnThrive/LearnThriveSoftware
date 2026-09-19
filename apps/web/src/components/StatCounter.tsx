"use client";

import { useEffect, useRef, useState } from "react";

interface StatCounterProps {
  target: number;
  suffix?: string;
  className?: string;
}

/** A stat that counts up to its real value when it scrolls into view.
 *
 * The value it renders on the server — and therefore its first client render — is always the real
 * one. An earlier version started at "0" and only reached the real number once the browser had
 * hydrated, run an IntersectionObserver and animated: the served HTML said "0+ students
 * supported", which is what a crawler, a reader view, or anyone whose JS hadn't run yet actually
 * got. It also hydrated inconsistently, because the initial state was computed from
 * `prefers-reduced-motion` — false on the server by definition, possibly true in the browser — so
 * a visitor with reduced motion enabled hit a hydration mismatch and React threw the subtree away
 * and re-rendered it.
 *
 * Counting up is therefore something this adds *after* hydration, and only when it can do it
 * without ever showing a number that isn't true: if the element is already on screen when the page
 * loads there's nothing to reveal, so it simply stays at its real value rather than jumping back
 * to zero to animate at someone who is already reading it. */
export function StatCounter({ target, suffix = "", className }: StatCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const finalValue = `${target}${suffix}`;
  const [display, setDisplay] = useState(finalValue);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Already in view at load — see the note above.
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    setDisplay(`0${suffix}`);

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
          setDisplay(`${Math.round(target * eased)}${suffix}`);
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
    };
  }, [target, suffix]);

  return (
    <b ref={ref} className={className}>
      {display}
    </b>
  );
}
