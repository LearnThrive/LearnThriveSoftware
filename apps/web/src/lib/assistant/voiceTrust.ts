/**
 * Whether the words a recogniser returned may be sent without asking (plan19 section 5.4).
 *
 * This moved out of `useVoice.ts` when the recogniser changed (docs/VOICE_PARAKEET_KOKORO_MIGRATION.md): Parakeet CTC through
 * NVIDIA's runtime reports per-word confidences, and when it cannot measure one it says **null** - never a made-up 1.0. Three rules,
 * in the order that matters for a student:
 *
 *  - a measured confidence below `CONFIRM_BELOW`: show the words and ask (exactly what the panel always did);
 *  - a transcript that is *mathematically ambiguous* - a power, a sign, a number that sounds like another, a fraction, calculus
 *    notation - is held to the higher `RISKY_BELOW`, because sending "x cubed" when she said "x squared" teaches the wrong thing.
 *    This can only make the page ask *more* often, never less;
 *  - a transcript with **no** measured confidence passes for ordinary sentences (the browser's own silence check has already run)
 *    but an ambiguous maths one is never sent unseen.
 *
 * Pure and dependency-free, so the browser can use it and the tests can pin every branch.
 */
import type { Transcript } from "./voice";

export const CONFIRM_BELOW = 0.55;
/** Reading/writing confidence a maths question with a confusable word must clear before it is sent unseen. */
export const RISKY_BELOW = 0.85;

const RISKY: Array<[RegExp, string]> = [
  [/\bsquared\b|\bcubed\b|\bto the power\b/, "a power"],
  [/\bsine\b|\bsign\b|\bcosine\b|\btangent\b|\bcos\b|\btan\b/, "a trigonometric word"],
  [/\bfifteen\b|\bfifty\b|\bthirteen\b|\bthirty\b|\bfourteen\b|\bforty\b|\bsixteen\b|\bsixty\b|\bseventeen\b|\bseventy\b|\beighteen\b|\beighty\b|\bnineteen\b|\bninety\b/, "a number that sounds like another"],
  [/\bplus\b|\bminus\b|\bnegative\b/, "a sign"],
  [/\bover\b|\bnumerator\b|\bdenominator\b|\breciprocal\b/, "a fraction read aloud"],
  [/\bprime\b|\bintegral\b|\blimit\b|\bnatural log\b|\bdifferential\b|\bdy by dx\b/, "calculus notation"],
];

/** The reason this text is easy to mishear as a different question, or null when it is not. */
export function ambiguousMaths(text: string): string | null {
  const padded = ` ${text.toLowerCase()} `;
  for (const [pattern, why] of RISKY) if (pattern.test(padded)) return why;
  return null;
}

export interface Verdict {
  /** Send the words as a normal message. */
  send: boolean;
  /** Show the words first and wait (Send / Try again / Edit). */
  ask: boolean;
  why: "unsure" | "ambiguous" | null;
}

export function judgeTranscript(input: { text: string; confidence: Transcript["confidence"] }): Verdict {
  const { text, confidence } = input;
  if (confidence !== null && confidence < CONFIRM_BELOW) return { send: false, ask: true, why: "unsure" };
  const risky = ambiguousMaths(text);
  if (risky && (confidence === null || confidence < RISKY_BELOW)) return { send: false, ask: true, why: "ambiguous" };
  return { send: true, ask: false, why: null };
}
