import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe's webhook signature (https://docs.stripe.com/webhooks#verify-manually), done by hand so no SDK is needed:
 * the header is `t=<unix seconds>,v1=<hex>[,v1=<hex>...]`; the signed text is `<t>.<raw body>`; the signature is
 * HMAC-SHA256 of it keyed with the endpoint secret. The check is over the RAW bytes as received, a timestamp more than
 * five minutes from now is refused (a captured request cannot be replayed later), comparisons take constant time, and
 * several secrets are accepted so one can be rotated without downtime.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureResult = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

export function signPayload(payload: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
}

export function verifyStripeSignature(payload: string, header: string | null, secrets: readonly string[], nowSeconds: number, tolerance = SIGNATURE_TOLERANCE_SECONDS): SignatureResult {
  if (!header) return { ok: false, reason: "missing" };
  let timestamp: number | null = null;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at < 1) return { ok: false, reason: "malformed" };
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === "t") timestamp = /^\d{1,12}$/.test(value) ? Number(value) : null;
    else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) candidates.push(value.toLowerCase());
  }
  if (timestamp === null || candidates.length === 0) return { ok: false, reason: "malformed" };
  if (Math.abs(nowSeconds - timestamp) > tolerance) return { ok: false, reason: "stale" };
  for (const secret of secrets) {
    const expected = Buffer.from(signPayload(payload, secret, timestamp), "hex");
    for (const candidate of candidates) {
      const given = Buffer.from(candidate, "hex");
      if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
    }
  }
  return { ok: false, reason: "mismatch" };
}
