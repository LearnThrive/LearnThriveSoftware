"use client";

import * as m from "framer-motion/m";
import { useRef, useState, type ReactNode } from "react";
import { useInViewport } from "@/lib/motion/activity";
import { motionEase } from "@/lib/motion/tokens";
import styles from "./MaskedText.module.css";

/**
 * An oversized editorial statement that wipes into view via `clip-path`, for the "1-2 high-impact
 * editorial statements" plan12.md task 3 asks for — a stronger, more deliberate arrival than
 * `Reveal`'s `mask` variant (a gentle translate-behind-a-clip-line meant for ordinary headings, not
 * a flagship statement). Only `clip-path` and `opacity` ever animate, per the plan's own rule for
 * this primitive — never layout.
 *
 * Driven by plan11's own `useInViewport` (the same activity primitive `CinematicBackdrop` uses)
 * plus an explicit `animate` prop, not Framer's built-in `whileInView` — confirmed directly, on this
 * exact setup, that `whileInView` fails to fire at all for the second-or-later page opened by a
 * given browser process (reproducible regardless of the element's position, size or viewport
 * threshold; the very first page in a fresh process works every time). `useInViewport` has none of
 * that instability anywhere else in this codebase, so this sidesteps the problem rather than
 * chasing it further into Framer/Chromium internals with no product-facing payoff.
 *
 * Same safety net as `Reveal`: Motion server-renders the *start* state as an inline style
 * (`clip-path: inset(0 0 100% 0)`), so a visitor with `prefers-reduced-motion` or no JavaScript at
 * all needs a `!important` CSS rule to see the text at all — `MaskedText.module.css`'s
 * reduced-motion block and the `(public)` layout's `<noscript>` both cover
 * `[data-masked-text-inner]` for exactly that reason. Content is plain text in the server HTML
 * either way; only its clip animates.
 */
export type MaskedTextProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  once?: boolean;
};

const VARIANTS = {
  hidden: { clipPath: "inset(0 0 100% 0)", opacity: 0 },
  visible: { clipPath: "inset(0 0 0% 0)", opacity: 1 },
};

export function MaskedText({ children, className, delay = 0, once = true }: MaskedTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInViewport(ref, "-15% 0px -15% 0px");
  // "Adjusting state during render" (useDelayedUnmount.ts's own comment explains this project's
  // lint config's reasoning): a plain setState call inside a useEffect body is flagged as a
  // cascading-render risk even for a legitimate latch like this one, and a ref can't be read/
  // written during render either (react-hooks/refs) — so the corrected React-documented shape for
  // "remember this was ever true" is to compare and adjust mid-render, which re-renders once
  // before paint rather than after an effect commit.
  const [seen, setSeen] = useState(false);
  if (inView && !seen) {
    setSeen(true);
  }

  const revealed = once ? seen : inView;

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")} data-masked-text="">
      <m.div
        ref={ref}
        className={styles.inner}
        data-masked-text-inner=""
        initial="hidden"
        animate={revealed ? "visible" : "hidden"}
        variants={VARIANTS}
        transition={{ duration: 0.9, ease: motionEase.gentle, delay }}
      >
        {children}
      </m.div>
    </div>
  );
}
