/**
 * One shared scroll store for the public site (plan15 Wave 4): scroll position, progress through
 * the page, velocity and direction, read by anything that wants them (the marquee's speed, the
 * header's shrink, a future scene) through one subscription instead of each primitive attaching its
 * own scroll listener and computing its own velocity.
 *
 * Design rules:
 *  - ONE source. A single passive `scroll` listener on `window` feeds it. Because smooth scrolling
 *    (Lenis) moves the browser's real scroll position, native scrolling and smooth scrolling look
 *    identical from here: this store never needs to know which one is active.
 *  - Coalesced to one notification per animation frame, however many scroll events fired.
 *  - Nothing runs at rest. The listener only exists while there is at least one subscriber, a frame
 *    is only scheduled when scroll actually moved, and velocity decays to zero through a single
 *    trailing frame, then the loop stops.
 *  - Values are plain numbers in a plain object, never React state; a subscriber that needs to
 *    render from them should write to a ref or a CSS variable, not call setState per frame (the
 *    rule plan11 established and tests/frame-loops.spec.ts enforces).
 *
 * `scrubProgress` is the small pure helper scenes use to turn the page scroll into 0..1 progress
 * through a range, so the arithmetic is shared and testable.
 */
export type ScrollDirection = -1 | 0 | 1;

export interface ScrollSnapshot {
  /** window.scrollY, in CSS px. */
  y: number;
  /** y / (scrollHeight - innerHeight), clamped 0..1; 0 on a page that does not scroll. */
  progress: number;
  /** Signed px per second, smoothed. 0 at rest. */
  velocity: number;
  /** 1 scrolling down, -1 up, 0 at rest. Keeps the last direction while velocity decays. */
  direction: ScrollDirection;
}

type Listener = (snapshot: ScrollSnapshot) => void;

const REST_VELOCITY = 4; // px/s under which the page is treated as stopped
const SMOOTHING = 0.35; // how much of each new velocity sample replaces the previous one

const listeners = new Set<Listener>();
let snapshot: ScrollSnapshot = { y: 0, progress: 0, velocity: 0, direction: 0 };
let lastY = 0;
let lastTime = 0;
let frameId = 0;
let attached = false;

function readProgress(y: number): number {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  return scrollable > 0 ? Math.min(1, Math.max(0, y / scrollable)) : 0;
}

function tick(now: number) {
  frameId = 0;
  const y = window.scrollY;
  const dt = Math.max(1, now - lastTime);
  const instant = ((y - lastY) / dt) * 1000;
  const velocity = Math.abs(instant) < 0.5 && Math.abs(snapshot.velocity) < REST_VELOCITY
    ? 0
    : snapshot.velocity + (instant - snapshot.velocity) * SMOOTHING;
  const resting = Math.abs(velocity) < REST_VELOCITY && y === lastY;
  snapshot = {
    y,
    progress: readProgress(y),
    velocity: resting ? 0 : velocity,
    direction: resting ? snapshot.direction : velocity > 0 ? 1 : velocity < 0 ? -1 : snapshot.direction,
  };
  lastY = y;
  lastTime = now;
  listeners.forEach((listener) => listener(snapshot));
  // Keep ticking only while there is motion left to report (including the decay to rest).
  if (!resting) schedule();
}

function schedule() {
  if (frameId === 0) frameId = requestAnimationFrame(tick);
}

function onScroll() {
  schedule();
}

function attach() {
  if (attached || typeof window === "undefined") return;
  attached = true;
  lastY = window.scrollY;
  lastTime = performance.now();
  snapshot = { y: lastY, progress: readProgress(lastY), velocity: 0, direction: 0 };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
}

function detach() {
  if (!attached) return;
  attached = false;
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", onScroll);
  if (frameId) cancelAnimationFrame(frameId);
  frameId = 0;
}

/** Subscribe to scroll updates (at most once per frame, only while scrolling). Returns unsubscribe. */
export function subscribeScroll(listener: Listener): () => void {
  listeners.add(listener);
  attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detach();
  };
}

/** The latest values, without subscribing. Safe to call from an event handler. */
export function getScrollSnapshot(): ScrollSnapshot {
  return snapshot;
}

/**
 * Progress 0..1 of `y` through the range [start, end], clamped. A degenerate range (end <= start)
 * is a step: 0 before it, 1 from it onward.
 */
export function scrubProgress(y: number, start: number, end: number): number {
  if (end <= start) return y >= start ? 1 : 0;
  return Math.min(1, Math.max(0, (y - start) / (end - start)));
}
