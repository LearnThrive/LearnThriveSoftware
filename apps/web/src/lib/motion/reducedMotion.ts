"use client";

import { userPrefersReducedMotion } from "./preference";

/**
 * The one place JS-driven motion (as opposed to a CSS transition/animation, which the blanket
 * `prefers-reduced-motion` rule in globals.css already catches automatically) checks whether it
 * should run at all — a delayed unmount, a counted-up number, a one-off ring/pulse triggered
 * from an effect. Re-reading `matchMedia` on every call rather than caching it is deliberate:
 * this fires rarely (on state changes, not on every render) and stays correct if the setting
 * changes while the page is open, which caching once at module load would miss.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || userPrefersReducedMotion();
}
