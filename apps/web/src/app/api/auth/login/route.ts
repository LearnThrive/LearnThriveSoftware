import { getAuthProvider } from "@/lib/auth/devProvider";
import { createSession } from "@/lib/auth/session";

interface LoginRequestBody {
  email?: unknown;
  password?: unknown;
  rememberMe?: unknown;
}

const MESSAGES = {
  invalid_credentials: "Incorrect email or password.",
  account_disabled: "This account has been disabled. Contact LearnThrive for help.",
  malformed: "Enter your email and password.",
  rate_limited: "Too many login attempts. Please try again in a few minutes.",
} as const;

// plan13.md task 11.6: unlike the enquiry route, this endpoint had no rate limiting at all —
// scrypt's own cost slows a single guess but does nothing against many parallel/automated ones.
// Keyed by ip:email (account lockout), not ip alone: an IP-only bucket means every login attempt
// from behind the same NAT/proxy/missing-x-forwarded-for shares one counter regardless of which
// account is targeted — a handful of people (or this suite's own tests, which share one "unknown"
// fallback locally) trying *different* accounts would lock each other out. Per-account-per-source
// is the standard pattern: it still stops credential-stuffing of any one target account, without
// that collateral lockout. Same in-memory sliding-window shape as
// apps/web/src/app/api/enquiry/route.ts's isRateLimited (this is a single-instance prototype
// backend; a real deployment needs a shared store).
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_MAX = 5; // max login attempts per window per ip:email

const hits = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const timestamps = hits.get(key) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);

  if (recent.length >= RATE_MAX) {
    hits.set(key, recent);
    return true;
  }

  recent.push(now);
  hits.set(key, recent);
  return false;
}

// Prune stale entries every 10 minutes to avoid unbounded growth.
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [key, timestamps] of hits) {
    const fresh = timestamps.filter((t) => t > cutoff);
    if (fresh.length === 0) hits.delete(key);
    else hits.set(key, fresh);
  }
}, 10 * 60 * 1000).unref?.();

export async function POST(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";

  let body: LoginRequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: MESSAGES.malformed }, { status: 400 });
  }

  if (typeof body.email !== "string" || typeof body.password !== "string" || !body.email.trim() || !body.password) {
    return Response.json({ error: MESSAGES.malformed }, { status: 400 });
  }

  const rateLimitKey = `${ip}:${body.email.trim().toLowerCase()}`;
  if (isRateLimited(rateLimitKey)) {
    return Response.json({ error: MESSAGES.rate_limited }, { status: 429 });
  }

  const result = await getAuthProvider().verifyCredentials(body.email, body.password);
  if (!result.ok) {
    // 401 either way — the message differs (account_disabled vs invalid_credentials) but the
    // status code doesn't, so a network tab alone can't distinguish "wrong password" from
    // "account exists but disabled" without reading the body.
    return Response.json({ error: MESSAGES[result.reason] }, { status: 401 });
  }

  await createSession(result.user, body.rememberMe === true);
  return Response.json({ user: result.user });
}
