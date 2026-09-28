/**
 * JS-side counterpart to the CSS custom properties in globals.css's "Motion system (plan8)"
 * block (:root, ~line 36) — Motion's `transition` prop takes numbers in seconds and cubic-bezier
 * arrays, so client components can't just read the CSS custom properties at runtime. Keep the
 * two in sync by hand; a mismatch here means a CSS-transitioned element and a Motion-animated one
 * would visibly move at different speeds for what's supposed to be the same "kind" of motion.
 *
 * `narrative` and the two `stagger` values have no CSS-side counterpart — they only apply to
 * Motion-orchestrated sequences (the hero settle, staggered card entrances), so they're defined
 * here only.
 */
export const motionDuration = {
  instant: 0.1, // --duration-instant: 100ms
  fast: 0.16, // --duration-fast: 160ms
  standard: 0.22, // --duration-medium / --duration-standard: 220ms
  slow: 0.38, // --duration-slow: 380ms
  narrative: 0.42, // Motion-only: multi-element hero/product storytelling sequences
} as const;

export const motionEase = {
  snappy: [0.22, 1, 0.36, 1], // --ease-snappy / --ease-out
  smooth: [0.4, 0, 0.2, 1], // --ease-smooth
  gentle: [0.16, 1, 0.3, 1], // --ease-gentle
} as const;

export const motionSpring = {
  // Small interface settling — a card/panel arriving, a hero surface locking into place.
  surface: { type: "spring", stiffness: 380, damping: 32, mass: 0.8 },
  // Immediate tactile response — hover lift, tap/press feedback.
  tactile: { type: "spring", stiffness: 520, damping: 36, mass: 0.6 },
} as const;

export const motionStagger = {
  tight: 0.045, // 2-5 closely related objects (e.g. a row of icons)
  content: 0.065, // a short hero copy/CTA sequence
} as const;
