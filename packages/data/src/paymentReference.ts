import { randomInt } from "node:crypto";

/**
 * A family's payment reference: what a parent quotes on a bank transfer so the money can be matched to them. `LT-` and six characters.
 *
 *   - It carries NO personal data: it is random, never derived from a name, an email, an id or a date.
 *   - The alphabet leaves out 0, O, 1 and I (and nothing else) so it cannot be misread or mistyped from a screen or a letter. 32 characters,
 *     so six of them are 32^6 (about a billion) references.
 *   - It is generated once, on the server, and then never changes (the database refuses a change). Uniqueness is the database's: the
 *     generator only tries again when a reference is already taken.
 */
export const PAYMENT_REFERENCE_PREFIX = "LT-";
export const PAYMENT_REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAYMENT_REFERENCE_LENGTH = 6;
export const PAYMENT_REFERENCE_PATTERN = /^LT-[A-HJ-NP-Z2-9]{6}$/;

/** A fresh random reference. `pick` is the source of randomness (a test passes a fixed one); the default is Node's cryptographic generator. */
export function generatePaymentReference(pick: (max: number) => number = (max) => randomInt(max)): string {
  let out = PAYMENT_REFERENCE_PREFIX;
  for (let i = 0; i < PAYMENT_REFERENCE_LENGTH; i += 1) out += PAYMENT_REFERENCE_ALPHABET[pick(PAYMENT_REFERENCE_ALPHABET.length)]!;
  return out;
}

export const isPaymentReference = (value: unknown): value is string => typeof value === "string" && PAYMENT_REFERENCE_PATTERN.test(value);

/** How many times to draw before giving up when references keep colliding (practically never: it would mean the space is nearly full). */
export const PAYMENT_REFERENCE_TRIES = 12;
