/**
 * The part of the human check that the server, the Web Worker and the form all share: the shapes that go
 * over the wire and the two tiny functions that define a valid proof. No Node imports, so it runs in the
 * browser and in the worker. The signing, verifying and one-use bookkeeping are in human-check.ts (server).
 *
 * How it works: the server hands out a random challenge and signs it. The visitor's browser (in a Web
 * Worker, so the page never freezes) looks for a number which, appended to the challenge, makes the
 * SHA-256 hash start with `bits` zero bits. That costs the visitor about a second and costs a script that
 * wants to send thousands of submissions thousands of seconds. No third party, no cookie, no storage.
 */

/** Separates the challenge from the solution in the hashed text. */
export const POW_SEPARATOR = ":";

export interface PowChallenge {
  kind: "pow";
  id: string;
  challenge: string;
  bits: number;
  /** Epoch milliseconds. */
  expires: number;
  signature: string;
}

/** The fallback when the browser cannot run the proof: a short sum, signed by the server. */
export interface TextChallenge {
  kind: "text";
  id: string;
  question: string;
  expires: number;
  signature: string;
}

export type HumanChallenge = PowChallenge | TextChallenge;

export interface PowAnswer {
  kind: "pow";
  id: string;
  challenge: string;
  bits: number;
  expires: number;
  signature: string;
  solution: string;
}

export interface TextAnswer {
  kind: "text";
  id: string;
  expires: number;
  signature: string;
  answer: string;
}

export type HumanCheckAnswer = PowAnswer | TextAnswer;

/** The text that is hashed for a candidate solution. */
export function powInput(challenge: string, solution: string): string {
  return `${challenge}${POW_SEPARATOR}${solution}`;
}

/** How many leading zero bits a hash starts with. */
export function leadingZeroBits(bytes: Uint8Array): number {
  let bits = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}
