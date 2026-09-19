"use client";

import { useEffect, useState } from "react";
import { prefersReducedMotion } from "./reducedMotion";

/**
 * Keeps a conditionally-rendered subtree mounted for `exitMs` after it's told to close, so a
 * dialog/dropdown/toast/drawer can play a reverse ("closing") transition instead of the panel
 * simply vanishing on the frame `open` flips to false — the same pattern applied everywhere a
 * component today does `{open && <Panel/>}` (Dialog, the account menu, QuickCreateMenu, Toaster).
 *
 * Deliberately a hook, not a wrapper component: every caller already owns its own open/close
 * state and keyboard handling (Escape, focus trap, outside-click), and this only needs to answer
 * two questions for them — "is the subtree still in the DOM" and "should it render its `is-closing`
 * class right now" — without taking over anything else.
 *
 * The active↔closing transition is detected during render by comparing `active` against
 * `prevActive`, a second piece of *state* holding the previous value (the same paired-useState
 * "adjust state when a prop changes" pattern Toaster.tsx's own `handled`/`toast` pair already
 * uses) — deliberately not a ref (this project's lint config enforces react-hooks/refs: a
 * `.current` read or write during render isn't safe under Strict Mode/concurrent rendering) and
 * deliberately not inside a `useEffect` (react-hooks/set-state-in-effect: a bare synchronous
 * setState call as a top-level effect statement is a real anti-pattern, not just a style
 * preference, here). The one genuine effect below exists only to run the exit timer; the setState
 * call inside it lives in the timer's *callback*, which is exactly what effects are for.
 *
 * Under `prefers-reduced-motion`, closes immediately: nothing here is expressed as a CSS
 * transition the blanket reduced-motion rule could catch on its own, and per plan8 section 75/76,
 * a reduced-motion pass must never leave an element lingering in the DOM (and therefore in the
 * accessibility tree, still tab-reachable) waiting on an animation that isn't going to visibly run.
 */
export function useDelayedUnmount(active: boolean, exitMs: number): { rendered: boolean; closing: boolean } {
  const [closing, setClosing] = useState(false);
  const [prevActive, setPrevActive] = useState(active);

  if (active !== prevActive) {
    setPrevActive(active);
    if (!active && !prefersReducedMotion() && exitMs > 0) {
      setClosing(true);
    } else if (active && closing) {
      setClosing(false);
    }
  }

  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), exitMs);
    return () => clearTimeout(timer);
  }, [closing, exitMs]);

  return { rendered: active || closing, closing };
}
