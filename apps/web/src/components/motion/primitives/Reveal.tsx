"use client";

import * as m from "framer-motion/m";
import type { TargetAndTransition, Variants } from "framer-motion";
import type { ReactNode } from "react";
import { motionEase } from "@/lib/motion/tokens";
import styles from "./Reveal.module.css";

/**
 * The marketing site's reveal vocabulary (plan11.md task 6). Six ways for a block to arrive, so a
 * page can choose one that suits what is arriving instead of fading everything up the same 24px:
 *
 * - `soft`      a short, gentle rise and fade. The general-purpose default.
 * - `mask`      the content slides up from behind a clip line. For headings and short statements.
 * - `scale`     a slight grow-in. For cards, images and other self-contained objects.
 * - `side`      slides in from the left. For a column, a caption, a marginal note.
 * - `editorial` a longer rise with a rule that draws in above it. For section introductions.
 * - `static`    no motion at all — renders in place. The explicit opt-out.
 *
 * Only `transform` and `opacity` ever animate, so every variant runs on the compositor. (`mask`
 * gets its clipped look from a translating child inside an `overflow: hidden` parent rather than
 * from animating `clip-path`, which is a paint property.)
 *
 * Content is never at the mercy of the animation:
 * - For a visitor with `prefers-reduced-motion`, and for one whose JavaScript never runs, CSS
 *   (Reveal.module.css and the (public) layout's <noscript>) forces the final state with
 *   `!important`, which beats the inline start state Motion server-renders. That is deliberately a
 *   stylesheet rule, not a `useReducedMotion()` branch: the server cannot know the visitor's
 *   preference, so branching the rendered markup on it is exactly what caused this codebase's
 *   earlier hydration mismatches. The markup here is identical on the server and the client.
 * - `amount: 0.15` rather than "all" or a fixed pixel margin, so an unusually tall block still
 *   reveals (it only has to be 15% visible, which a viewport can always show unless the block is
 *   more than ~6.5 screens tall) and a short block at the very bottom of a page is not left waiting
 *   for a trigger line it can never cross.
 *
 * Observation is Motion's own viewport feature, which shares one IntersectionObserver between every
 * element that asks for the same options — not one observer and one timer per instance, which is
 * what the component this replaces did.
 *
 * Use it for below-the-fold content. A reveal starts once the page has hydrated, so anything in the
 * first viewport (and above all the largest contentful paint) should keep using the CSS entrance
 * keyframes, which begin on first paint without waiting for JavaScript.
 */
export type RevealVariant = "soft" | "mask" | "scale" | "side" | "editorial" | "static";

export type RevealProps = {
  variant?: RevealVariant;
  /** Seconds before the reveal starts, once it has been triggered. Use it to stagger siblings. */
  delay?: number;
  /** Reveal once and stay revealed (default), or replay each time it re-enters the viewport. */
  once?: boolean;
  children: ReactNode;
  className?: string;
};

type AnimatedVariant = Exclude<RevealVariant, "static">;

/** Where each variant starts from. Every variant ends at the element's natural, unstyled state. */
const START: Record<Exclude<AnimatedVariant, "mask">, TargetAndTransition> = {
  soft: { opacity: 0, y: 18 },
  scale: { opacity: 0, scale: 0.96 },
  side: { opacity: 0, x: -28 },
  editorial: { opacity: 0, y: 36 },
};

const END: TargetAndTransition = { opacity: 1, x: 0, y: 0, scale: 1 };

const DURATION: Record<AnimatedVariant, number> = {
  soft: 0.6,
  mask: 0.75,
  scale: 0.65,
  side: 0.65,
  editorial: 0.85,
};

const VIEWPORT_AMOUNT = 0.15;

function variantsFor(variant: AnimatedVariant, delay: number): Variants {
  const transition = { duration: DURATION[variant], delay, ease: motionEase.gentle };
  if (variant === "mask") {
    return { hidden: { y: "110%" }, visible: { y: 0, transition } };
  }
  return { hidden: START[variant], visible: { ...END, transition } };
}

export function Reveal({ variant = "soft", delay = 0, once = true, children, className }: RevealProps) {
  const joined = (...names: Array<string | undefined>) => names.filter(Boolean).join(" ");

  if (variant === "static") {
    return (
      <div className={className} data-reveal="static">
        {children}
      </div>
    );
  }

  const viewport = { once, amount: VIEWPORT_AMOUNT };
  const variants = variantsFor(variant, delay);

  if (variant === "mask") {
    return (
      <div className={joined(styles.mask, className)} data-reveal="mask">
        <m.div
          data-reveal-inner=""
          variants={variants}
          initial="hidden"
          whileInView="visible"
          viewport={viewport}
        >
          {children}
        </m.div>
      </div>
    );
  }

  if (variant === "editorial") {
    return (
      <m.div
        className={joined(styles.editorial, className)}
        data-reveal="editorial"
        variants={variants}
        initial="hidden"
        whileInView="visible"
        viewport={viewport}
      >
        <m.span
          className={styles.rule}
          data-reveal-rule=""
          aria-hidden="true"
          variants={{
            hidden: { scaleX: 0 },
            visible: {
              scaleX: 1,
              transition: { duration: DURATION.editorial, delay: delay + 0.1, ease: motionEase.gentle },
            },
          }}
        />
        {children}
      </m.div>
    );
  }

  return (
    <m.div
      className={className}
      data-reveal={variant}
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
    >
      {children}
    </m.div>
  );
}
