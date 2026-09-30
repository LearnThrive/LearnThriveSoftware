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
// Counts only FAILED attempts (standard account-lockout semantics), not every request: an
// earlier version counted every attempt including successes, and broke the full e2e suite —
// dozens of unrelated test files each log in with *correct* seeded-account credentials as their
// own setup step, and that legitimate traffic alone exceeded the limit long before any real
// brute-force behaviour would. Counting failures only means a string of correct logins never
// depletes the bucket, while repeated wrong-password guesses against one account still trip it.
// Keyed by ip:email (account lockout), not ip alone: an IP-only bucket would share one counter
// across every account behind the same NAT/proxy/missing-x-forwarded-for, locking out unrelated
// accounts' logins. Same in-memory sliding-window shape as
// apps/web/src/app/api/enquiry/route.ts's isRateLimited (this is a single-instance prototype
// backend; a real deployment needs a shared store).
const RATE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_MAX = 5; // max FAILED login attempts per window per ip:email

const failures = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (failures.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  return recent.length >= RATE_MAX;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const recent = (failures.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  failures.set(key, recent);
}

function clearFailures(key: string): void {
  failures.delete(key);
}

// Prune stale entries every 10 minutes to avoid unbounded growth.
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [key, timestamps] of failures) {
    const fresh = timestamps.filter((t) => t > cutoff);
    if (fresh.length === 0) failures.delete(key);
    else failures.set(key, fresh);
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
    recordFailure(rateLimitKey);
    // 401 either way — the message differs (account_disabled vs invalid_credentials) but the
    // status code doesn't, so a network tab alone can't distinguish "wrong password" from
    // "account exists but disabled" without reading the body.
    return Response.json({ error: MESSAGES[result.reason] }, { status: 401 });
  }

  clearFailures(rateLimitKey);
  await createSession(result.user, body.rememberMe === true);
  return Response.json({ user: result.user });
}
