/// <reference lib="webworker" />
import { leadingZeroBits, powInput } from "./human-check-core";

/**
 * The Web Worker that does the human check's proof of work, so the page never freezes while it runs.
 * Started by components/careers/useHumanCheck.ts. Input: { challenge, bits }. Output: { solution } when
 * found, or { error } if this browser cannot do it (the form then falls back to a short sum).
 *
 * It tries numbers 0, 1, 2 ... in batches: the digests of a whole batch are requested together, which keeps
 * the browser's crypto busy instead of waiting on each result in turn. The first number whose hash has
 * enough leading zero bits is the answer.
 */
const BATCH = 256;

self.onmessage = async (event: MessageEvent<{ challenge: string; bits: number }>) => {
  const { challenge, bits } = event.data;
  try {
    const subtle = self.crypto?.subtle;
    if (!subtle) throw new Error("no-crypto");
    const encoder = new TextEncoder();
    for (let start = 0; ; start += BATCH) {
      const candidates = Array.from({ length: BATCH }, (_, i) => String(start + i));
      const digests = await Promise.all(candidates.map((candidate) => subtle.digest("SHA-256", encoder.encode(powInput(challenge, candidate)))));
      for (let i = 0; i < digests.length; i += 1) {
        if (leadingZeroBits(new Uint8Array(digests[i])) >= bits) {
          self.postMessage({ solution: candidates[i], attempts: start + i + 1 });
          return;
        }
      }
    }
  } catch {
    self.postMessage({ error: "unsupported" });
  }
};
