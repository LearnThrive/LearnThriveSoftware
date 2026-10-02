import { Children, type ReactNode } from "react";
import { staggerDelay, motionStagger } from "@/lib/motion/tokens";
import { Reveal, type RevealVariant } from "./Reveal";

/**
 * Reveals each direct child in turn (plan15 Wave 6 section 10.1): one container instead of a
 * hand-written `delay={i * 0.09}` per item, so a group's rhythm is a named choice and the cap in
 * `staggerDelay` (no item waits more than six steps) applies everywhere.
 *
 * It composes `Reveal` rather than reimplementing it, so every guarantee Reveal makes — content is
 * never hidden for reduced motion or without JavaScript, only transform and opacity animate,
 * `once` by default — holds here unchanged. A server component: it adds no JavaScript of its own.
 *
 *   <Stagger step="cards" variant="scale">{subjects.map(...)}</Stagger>
 *
 * Items that must not be wrapped in an extra element (a grid cell, a list item) should pass
 * `as` wrappers themselves; Stagger wraps each child in Reveal's own div, which is what the pages
 * it replaces already did.
 */
export type StaggerProps = {
  children: ReactNode;
  variant?: RevealVariant;
  /** Which named rhythm: `motionStagger` keys, or a number of seconds. Default "list" (80ms). */
  step?: keyof typeof motionStagger | number;
  /** Delay before the whole group starts, in seconds. */
  base?: number;
  once?: boolean;
  className?: string;
  /** Applied to every item's Reveal wrapper (e.g. a grid cell class). */
  itemClassName?: string;
};

export function Stagger({ children, variant = "soft", step = "list", base = 0, once = true, className, itemClassName }: StaggerProps) {
  const seconds = typeof step === "number" ? step : motionStagger[step];
  const items = Children.toArray(children);
  const group = items.map((child, index) => (
    <Reveal key={index} variant={variant} delay={staggerDelay(index, seconds, base)} once={once} className={itemClassName}>
      {child}
    </Reveal>
  ));
  return className ? <div className={className}>{group}</div> : <>{group}</>;
}
