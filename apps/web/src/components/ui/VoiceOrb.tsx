"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useMotionCapabilities } from "@/lib/motion/capabilities";
import styles from "./VoiceOrb.module.css";

// From Uiverse.io by Cobp (the orb is rebuilt from the "Chat" component's .ai / .container / .glass / .rings).

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

/** False while the element is scrolled out of view, so its infinite animations can be paused. Only observes while `active`. */
export function useInView(ref: RefObject<Element | null>, active: boolean): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!active || !element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, active]);
  return visible;
}

/**
 * The animated orb of the voice overlay (plan19.md sections 5.4 and 7). Purely decorative: it is
 * aria-hidden, and the state it shows is always also written out as text by the overlay around it.
 *
 * Motion is layered so the cheap version is the default:
 * - every tier and every reduced-motion setting gets the same static orb (gradient, glass highlight,
 *   rings), with the state shown by how many pulse rings are drawn;
 * - only the "full" tier, with motion allowed, and only while the state is not idle, gets the infinite
 *   animations and the backdrop-filter lens (the heavy parts of the original);
 * - those animations are paused while the orb is scrolled out of view (IntersectionObserver).
 * The CSS repeats the reduced-motion checks (media query and the visitor's own toggle) so a stylesheet
 * cannot animate it even if the React side were wrong.
 */
export function VoiceOrb({ state }: { state: VoiceState }) {
  const { tier } = useMotionCapabilities();
  const animated = tier === "full" && state !== "idle";
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, animated);

  return (
    <div
      ref={ref}
      className={styles.orb}
      data-voice-orb=""
      data-state={state}
      data-animated={animated}
      data-paused={animated && !visible}
      aria-hidden="true"
    >
      <span className={`${styles.wave} ${styles.wave1}`} />
      <span className={`${styles.wave} ${styles.wave2}`} />
      <span className={styles.sphere}>
        <span className={`${styles.blob} ${styles.blob1}`} />
        <span className={`${styles.blob} ${styles.blob2}`} />
        <span className={`${styles.blob} ${styles.blob3}`} />
        <span className={`${styles.blob} ${styles.blob4}`} />
        <span className={styles.rings} />
      </span>
      <span className={styles.glass} />
    </div>
  );
}
