"use client";

import * as m from "framer-motion/m";
import type { ReactNode } from "react";
import { motionEase } from "@/lib/motion/tokens";
import styles from "./AnimatedUnderline.module.css";

/**
 * An underline that draws itself (plan11.md task 8): under a link on hover and keyboard focus, under
 * the current item in a navigation, or under a word as it scrolls into view. One primitive so the
 * site has one underline, with one curve and one duration, rather than a handful of near-misses.
 *
 * The line is a `scaleX` from the left edge — a transform, so it never touches layout — in a
 * `span` sized by the content. The hover/focus/active behaviour is plain CSS (no JavaScript, and
 * therefore no hydration to wait for); only `drawOnView` needs Motion. A scroll-drawn line starts
 * at scaleX(0) as an inline style, so — like Reveal's start states — it is forced to its finished
 * state for reduced motion (this file's stylesheet) and for visitors without JavaScript (the
 * (public) layout's <noscript>), keyed on `data-underline-draw` so hover-only lines are untouched.
 *
 * It carries no semantics of its own — wrap the link or heading you want underlined; the line is
 * `aria-hidden`. `active` is for state the caller already knows (the current page), and is
 * conveyed to assistive technology by the caller's own `aria-current`, not by this.
 */
export type AnimatedUnderlineProps = {
  children: ReactNode;
  /** Show the line regardless of hover — for the current item in a navigation. */
  active?: boolean;
  /** Draw the line once, when the text first scrolls into view. */
  drawOnView?: boolean;
  /** Seconds before a drawOnView line starts. */
  delay?: number;
  thickness?: number;
  className?: string;
};

export function AnimatedUnderline({
  children,
  active = false,
  drawOnView = false,
  delay = 0,
  thickness = 2,
  className,
}: AnimatedUnderlineProps) {
  const root = [styles.root, drawOnView ? styles.onView : "", className ?? ""].filter(Boolean).join(" ");

  return (
    <span className={root} data-underline="" data-active={active ? "true" : undefined} style={{ ["--underline-thickness" as string]: `${thickness}px` }}>
      {children}
      {drawOnView ? (
        <m.span
          className={styles.line}
          data-underline-line=""
          data-underline-draw=""
          aria-hidden="true"
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 0.7, delay, ease: motionEase.gentle }}
        />
      ) : (
        <span className={styles.line} data-underline-line="" aria-hidden="true" />
      )}
    </span>
  );
}
