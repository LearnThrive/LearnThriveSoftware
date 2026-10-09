import { randomInt } from "node:crypto";
import { siteConfig } from "@/lib/site";

/**
 * The checks and helpers the careers application, the safeguarding reconfirmation, the subject request and
 * the challenge route all share. Server only. Kept in one place so the four routes cannot drift apart on
 * what counts as an allowed origin, how a body is size-limited, or what a log line may contain.
 */
type Env = Record<string, string | undefined>;

/**
 * The origins a browser may post from: the real site (www and the bare domain), whatever ALLOWED_ORIGINS and
 * NEXT_PUBLIC_SITE_URL add, and, outside production only, any localhost address (development and the e2e
 * suite).
 */
export function allowedOrigins(env: Env = process.env): Set<string> {
  const origins = new Set<string>([siteConfig.url, siteConfig.url.replace("://www.", "://")]);
  for (const entry of (env.ALLOWED_ORIGINS ?? "").split(",")) if (entry.trim()) origins.add(entry.trim());
  const site = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) origins.add(site.replace(/\/+$/, ""));
  return origins;
}

const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/**
 * Whether a request may proceed. A browser always sends Origin on a cross-site POST, so a present-but-wrong
 * Origin (or a browser that says `Sec-Fetch-Site: cross-site`) is refused. A request with no Origin at all is
 * not a browser form post (a server-to-server call, a test), so it cannot be the cross-site forgery this
 * guards against; the human check, the rate limits and the honeypot are what stop scripts.
 */
export function originAllowed(request: Request, env: Env = process.env): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    if (allowedOrigins(env).has(origin)) return true;
    return env.NODE_ENV !== "production" && LOCAL_ORIGIN.test(origin);
  }
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

export function jsonResponse(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extraHeaders } });
}

export type BodyRead = { ok: true; bytes: Uint8Array } | { ok: false; reason: "too-large" | "unreadable" };

/**
 * Reads a request body, refusing anything over `maxBytes`. The declared Content-Length is checked first, so
 * an oversize upload is rejected without being read; the bytes are then counted as they arrive, so a request
 * that lies about its length (or has none, as with chunked encoding) is cut off at the limit too.
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<BodyRead> {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: "too-large" };
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too-large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/** Parses already-read multipart bytes back into FormData. Null if the body is not valid multipart. */
export async function parseMultipart(bytes: Uint8Array, contentType: string | null): Promise<FormData | null> {
  if (!contentType || !/^multipart\/form-data/i.test(contentType)) return null;
  try {
    return await new Response(bytes as BodyInit, { headers: { "content-type": contentType } }).formData();
  } catch {
    return null;
  }
}

const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0, 1, I, L or O: they are misread

/** `LT-APP-20261009-K7QX2M`: a date and six random characters, for correspondence without a database. */
export function newReference(prefix: "LT-APP" | "LT-RECONF", now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  let suffix = "";
  for (let i = 0; i < 6; i += 1) suffix += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `${prefix}-${date}-${suffix}`;
}

type LogValue = string | number | boolean;

/**
 * One structured line per outcome, for the host's log search. It carries NO personal data: only an event
 * name, an outcome, and short machine-readable values (counts, sizes, reasons). Anything else is dropped, so
 * a careless caller cannot put a name, an address or an answer in the logs.
 */
export function logOutcome(event: string, outcome: string, details: Record<string, LogValue> = {}): void {
  const safe: Record<string, LogValue> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "number" || typeof value === "boolean") safe[key] = value;
    else if (typeof value === "string" && /^[a-z0-9_.:-]{1,40}$/i.test(value)) safe[key] = value;
  }
  const line = JSON.stringify({ event, outcome, ...safe });
  if (outcome === "sent" || outcome === "received" || outcome === "dropped") console.info(line);
  else console.warn(line);
}
