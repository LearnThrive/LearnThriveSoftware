/**
 * JS-side counterpart to the CSS custom properties in globals.css's "Motion system (plan8)"
 * block (:root, ~line 36) — Motion's `transition` prop takes numbers in seconds and cubic-bezier
 * arrays, so client components can't just read the CSS custom properties at runtime. Keep the
 * two in sync by hand; a mismatch here means a CSS-transitioned element and a Motion-animated one
 * would visibly move at different speeds for what's supposed to be the same "kind" of motion.
 *
 * `narrative`, the springs and the `stagger` values have no CSS-side counterpart — they only apply
 * to Motion-orchestrated sequences (the hero settle, staggered card entrances), so they're defined
 * here only.
 *
 * What each duration is FOR (plan15 Wave 2 — keep to the role, not the number):
 *   instant 100ms    a press releasing; :active states
 *   fast 160ms       hover, focus, one-property transitions
 *   standard 220ms   dropdowns, badges, a card settling in
 *   slow 380ms       dialogs, drawers, counted numbers — bigger moves that should feel weighty
 *   narrative 420ms  Motion-orchestrated multi-element sequences (JS only)
 *   emphasis 600ms   a section-level reveal that should be noticed; the editorial reveals
 *   hero 900ms       the one-shot arrival of the first screen's main objects
 *   cinematic 1400ms the one-shot choreography of a whole scene, or the hero sequence's total run
 * The three longest are for arrivals the visitor did not trigger by pressing something. They are
 * never a response to input (the "never delay an interaction to let a motion effect finish" rule
 * of plan11/12 still holds): a control that takes 1.4s to answer is broken.
 */
export const motionDuration = {
  instant: 0.1, // --duration-instant: 100ms
  fast: 0.16, // --duration-fast: 160ms
  standard: 0.22, // --duration-medium / --duration-standard: 220ms
  slow: 0.38, // --duration-slow: 380ms
  narrative: 0.42, // Motion-only: multi-element hero/product storytelling sequences
  emphasis: 0.6, // --duration-emphasis: 600ms
  hero: 0.9, // --duration-hero: 900ms
  cinematic: 1.4, // --duration-cinematic: 1400ms
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
  // Large surfaces arriving or being moved — a hero photo settling, a panel sliding in. Slower and
  // less stiff than `surface`, with enough damping that it settles without a visible wobble.
  soft: { type: "spring", stiffness: 170, damping: 26, mass: 1 },
  // Big panels and sheets that should feel like they have weight: still no overshoot worth
  // noticing, but a longer, heavier approach than `soft`.
  weighty: { type: "spring", stiffness: 120, damping: 24, mass: 1.25 },
} as const;

export const motionStagger = {
  tight: 0.045, // 2-5 closely related objects (e.g. a row of icons)
  content: 0.065, // a short hero copy/CTA sequence
  list: 0.08, // a column of rows or small cards revealing one after another
  cards: 0.09, // a grid of cards (subjects, levels, testimonials)
  editorial: 0.12, // large blocks of an editorial section (plan15: 80-140ms is the useful range)
} as const;

/** No item waits longer than this many steps, however long the list: a 12-card grid whose last
 * card appears a second after the first reads as slow, not as choreography. */
export const MAX_STAGGER_STEPS = 6;

/**
 * The delay (seconds) for item `index` of a staggered group. One helper instead of a hand-written
 * `delay={i * 0.09}` per page, so a group's rhythm is a named choice (`motionStagger.cards`) and the
 * cap above applies everywhere. `base` offsets the whole group (e.g. behind a heading's reveal).
 */
export function staggerDelay(index: number, step: number = motionStagger.list, base = 0): number {
  const steps = Math.min(Math.max(index, 0), MAX_STAGGER_STEPS);
  return Math.round((base + steps * step) * 1000) / 1000;
}
