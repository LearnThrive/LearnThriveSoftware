import { asString } from "@/lib/forms-common";
import { humanCheckAvailable, verifyHumanCheck } from "@/lib/human-check";
import { SlidingWindowLimiter, clientAddress } from "@/lib/rate-limit";
import { jsonResponse, logOutcome, originAllowed, readBodyLimited } from "@/lib/request-guards";
import { siteConfig } from "@/lib/site";
import type { AccountRuntime } from "./runtime";
import { ACCESS_COOKIE, REFRESH_COOKIE, clearSessionCookies, forgetAccessToken, renewSession, setSessionCookies, type CookieJar } from "./session";
import { NAME_MAX, emailError, parseDisplayName, parseEmail, parseSignIn, parseSignUp, parseTokenHash, passwordError, validateSignUp } from "./validation";
import type { EmailLinkKind } from "./types";

/**
 * The account routes' logic, with the runtime and the cookie jar passed in so tests drive it without Next. Each
 * file under app/api/account/ is a three-line wrapper. Every handler: origin check first, then (where it applies)
 * a rate limit, a body size limit, validation, and only then the provider. Nothing here logs an address, a name or
 * a token: `logOutcome` events carry counters and reason codes.
 */
const MAX_BODY_BYTES = 8 * 1024;
const MIN_FILL_MS = 2_000;
const FALLBACK = `Please email ${siteConfig.email} and we will help.`;

/** Per visitor address and for the whole route, as for the other forms (lib/rate-limit.ts). */
export const accountRateLimits = {
  signUp: { perClient: { max: 5, windowMs: 60 * 60 * 1000 }, global: { max: 300, windowMs: 60 * 60 * 1000 } },
  emailLink: { perClient: { max: 6, windowMs: 60 * 60 * 1000 }, global: { max: 300, windowMs: 60 * 60 * 1000 } },
  verify: { perClient: { max: 30, windowMs: 15 * 60 * 1000 }, global: { max: 600, windowMs: 15 * 60 * 1000 } },
  password: { perClient: { max: 10, windowMs: 15 * 60 * 1000 }, global: { max: 300, windowMs: 15 * 60 * 1000 } },
  profile: { perClient: { max: 20, windowMs: 15 * 60 * 1000 }, global: { max: 600, windowMs: 15 * 60 * 1000 } },
} as const;

const limiters = {
  signUp: new SlidingWindowLimiter(accountRateLimits.signUp.perClient, accountRateLimits.signUp.global),
  emailLink: new SlidingWindowLimiter(accountRateLimits.emailLink.perClient, accountRateLimits.emailLink.global),
  verify: new SlidingWindowLimiter(accountRateLimits.verify.perClient, accountRateLimits.verify.global),
  password: new SlidingWindowLimiter(accountRateLimits.password.perClient, accountRateLimits.password.global),
  profile: new SlidingWindowLimiter(accountRateLimits.profile.perClient, accountRateLimits.profile.global),
};

/** For tests. */
export function resetAccountLimiters(): void {
  for (const limiter of Object.values(limiters)) limiter.reset();
}

export interface Deps {
  /** null = the account backend is not configured (production without Supabase settings). */
  rt: AccountRuntime | null;
  jar: CookieJar;
  env?: Record<string, string | undefined>;
}

type Gate = { ok: true; rt: AccountRuntime; body: Record<string, unknown>; address: string } | { ok: false; response: Response };

/** The checks every POST starts with. */
async function open(request: Request, deps: Deps, event: string, limiter?: SlidingWindowLimiter): Promise<Gate> {
  const env = deps.env ?? process.env;
  if (!originAllowed(request, env)) {
    logOutcome(event, "forbidden_origin");
    return { ok: false, response: jsonResponse(403, { error: "Forbidden." }) };
  }
  if (!deps.rt) {
    logOutcome(event, "unavailable", { reason: "backend-off" });
    return { ok: false, response: jsonResponse(503, { code: "unavailable", error: `Accounts are not open yet. ${FALLBACK}` }) };
  }
  const address = clientAddress(request.headers, env);
  if (limiter && !limiter.allow(address)) {
    logOutcome(event, "rate_limited");
    return { ok: false, response: jsonResponse(429, { error: "Too many requests from this connection. Please try again later." }) };
  }
  const read = await readBodyLimited(request, MAX_BODY_BYTES);
  let raw: unknown = null;
  if (read.ok) {
    try {
      raw = JSON.parse(new TextDecoder().decode(read.bytes));
    } catch {
      raw = null;
    }
  }
  if (!read.ok || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    logOutcome(event, "rejected", { reason: read.ok ? "not-json" : read.reason });
    return { ok: false, response: jsonResponse(read.ok ? 400 : 413, { error: "We could not read that. Please try again." }) };
  }
  return { ok: true, rt: deps.rt, body: raw as Record<string, unknown>, address };
}

/** Honeypot, minimum time and the human check, for the forms that anyone anonymous can submit. */
function botChecks(body: Record<string, unknown>, event: string, env: Record<string, string | undefined>): Response | "drop" | null {
  const production = env.NODE_ENV === "production";
  if (!humanCheckAvailable(env)) {
    logOutcome(event, "unavailable", { reason: "no-human-check" });
    return jsonResponse(503, { code: "unavailable", error: `This is not available right now. ${FALLBACK}` });
  }
  const tooFast = typeof body.elapsedMs === "number" ? production && body.elapsedMs < MIN_FILL_MS : production;
  if (asString(body.website).trim() !== "" || tooFast) {
    logOutcome(event, "dropped", { reason: asString(body.website).trim() !== "" ? "honeypot" : "too-fast" });
    return "drop";
  }
  const human = verifyHumanCheck(body.humanCheck, { env });
  if (!human.ok) {
    logOutcome(event, "rejected", { reason: `human-${human.reason}` });
    return jsonResponse(400, { code: "human-check", error: "We could not confirm that you are a person. Please wait a moment for the check to finish, then try again." });
  }
  return null;
}

const UNAVAILABLE = () => jsonResponse(503, { code: "unavailable", error: `We could not do that just now. Please try again shortly. ${FALLBACK}` });

export async function handleSignUp(request: Request, deps: Deps): Promise<Response> {
  const gate = await open(request, deps, "account-signup", limiters.signUp);
  if (!gate.ok) return gate.response;
  const bots = botChecks(gate.body, "account-signup", deps.env ?? process.env);
  if (bots === "drop") return jsonResponse(200, { success: true });
  if (bots) return bots;
  const fields = parseSignUp(gate.body);
  const errors = validateSignUp(fields);
  if (Object.keys(errors).length > 0) {
    logOutcome("account-signup", "invalid", { fields: Object.keys(errors).length });
    return jsonResponse(422, { error: "Please check your answers and try again.", errors });
  }
  const result = await gate.rt.auth.signUp({ email: fields.email, password: fields.password, displayName: fields.displayName, adultConfirmed: true });
  if (!result.ok) {
    logOutcome("account-signup", result.reason);
    if (result.reason === "weak_password") return jsonResponse(422, { error: "Please check your answers and try again.", errors: { password: "That password is too easy to guess or has appeared in a data breach. Choose a different one." } });
    if (result.reason === "invalid_email") return jsonResponse(422, { error: "Please check your answers and try again.", errors: { email: "Enter a valid email address." } });
    return UNAVAILABLE();
  }
  logOutcome("account-signup", "sent");
  return jsonResponse(200, { success: true });
}

export async function handleSignIn(request: Request, deps: Deps): Promise<Response> {
  const gate = await open(request, deps, "account-signin");
  if (!gate.ok) return gate.response;
  const { email, password } = parseSignIn(gate.body);
  if (emailError(email) || !password) return jsonResponse(400, { error: "Enter your email address and password." });
  const lockout = gate.rt.lockout;
  if (lockout.locked(email, gate.address)) {
    logOutcome("account-signin", "locked");
    return jsonResponse(429, { error: "Too many sign-in attempts. Please try again in a few minutes, or reset your password." });
  }
  const result = await gate.rt.auth.signIn(email, password);
  if (!result.ok) {
    if (result.reason === "unavailable") return UNAVAILABLE();
    lockout.recordFailure(email, gate.address);
    logOutcome("account-signin", result.reason);
    if (result.reason === "email_not_confirmed") {
      return jsonResponse(403, { code: "email_not_confirmed", error: "Please confirm your email address first. We sent you a link when you created the account." });
    }
    return jsonResponse(401, { error: "Email or password is not right." });
  }
  lockout.recordSuccess(email);
  setSessionCookies(deps.jar, result.tokens, deps.env ?? process.env);
  logOutcome("account-signin", "ok");
  return jsonResponse(200, { success: true, user: { displayName: result.user.displayName } });
}

export async function handleSignOut(request: Request, deps: Deps): Promise<Response> {
  if (!originAllowed(request, deps.env ?? process.env)) return jsonResponse(403, { error: "Forbidden." });
  const access = deps.jar.get(ACCESS_COOKIE);
  if (access) {
    forgetAccessToken(access);
    if (deps.rt) await deps.rt.auth.signOut(access);
  }
  clearSessionCookies(deps.jar);
  return jsonResponse(200, { success: true });
}

/** Spends an emailed link. A POST on purpose: a mail scanner that opens the link (a GET) must not use it up. */
export async function handleVerify(request: Request, deps: Deps): Promise<Response> {
  const gate = await open(request, deps, "account-verify", limiters.verify);
  if (!gate.ok) return gate.response;
  const tokenHash = parseTokenHash(gate.body.tokenHash);
  const type = gate.body.type;
  if (!tokenHash || (type !== "signup" && type !== "recovery")) return jsonResponse(400, { error: "That link is not valid." });
  const kind: EmailLinkKind = type;
  const result = await gate.rt.auth.verifyEmailLink(tokenHash, kind);
  if (!result.ok) {
    logOutcome("account-verify", result.reason);
    if (result.reason === "unavailable") return UNAVAILABLE();
    return jsonResponse(400, { code: "invalid_link", error: "That link has expired or has already been used. You can ask for a new one." });
  }
  setSessionCookies(deps.jar, result.tokens, deps.env ?? process.env);
  logOutcome("account-verify", "ok", { kind });
  return jsonResponse(200, { success: true, next: kind === "recovery" ? "/account/reset" : "/account" });
}

/** "Send me a link": forgot password, or resend the verification email. Same answer for every address. */
export async function handleEmailLink(request: Request, deps: Deps, purpose: "reset" | "verify"): Promise<Response> {
  const event = purpose === "reset" ? "account-forgot" : "account-resend";
  const gate = await open(request, deps, event, limiters.emailLink);
  if (!gate.ok) return gate.response;
  const bots = botChecks(gate.body, event, deps.env ?? process.env);
  if (bots === "drop") return jsonResponse(200, { success: true });
  if (bots) return bots;
  const email = parseEmail(gate.body.email);
  const problem = emailError(email);
  if (problem) return jsonResponse(422, { error: "Please check your answers and try again.", errors: { email: problem } });
  const result = purpose === "reset" ? await gate.rt.auth.requestPasswordReset(email) : await gate.rt.auth.resendVerification(email);
  if (!result.ok) return UNAVAILABLE();
  logOutcome(event, "sent");
  return jsonResponse(200, { success: true });
}

/** Chooses a new password. Needs the session an emailed recovery link opened, or a signed-in session. */
export async function handleSetPassword(request: Request, deps: Deps): Promise<Response> {
  const gate = await open(request, deps, "account-password", limiters.password);
  if (!gate.ok) return gate.response;
  const session = await renewSession(deps.jar, gate.rt);
  const access = deps.jar.get(ACCESS_COOKIE);
  if (session.status !== "ok" || !access) return jsonResponse(401, { code: "signed_out", error: "Your link has expired. Please ask for a new one." });
  const password = asString(gate.body.password);
  const problem = passwordError(password);
  if (problem) return jsonResponse(422, { error: "Please check your answers and try again.", errors: { password: problem } });
  const result = await gate.rt.auth.updatePassword(access, password);
  if (!result.ok) {
    logOutcome("account-password", result.reason);
    if (result.reason === "weak_password") return jsonResponse(422, { error: "Please check your answers and try again.", errors: { password: "That password is too easy to guess or has appeared in a data breach. Choose a different one." } });
    if (result.reason === "invalid_token") {
      clearSessionCookies(deps.jar);
      return jsonResponse(401, { code: "signed_out", error: "Your link has expired. Please ask for a new one." });
    }
    return UNAVAILABLE();
  }
  logOutcome("account-password", "ok");
  return jsonResponse(200, { success: true });
}

/** Changes the name printed on downloads. Needs a signed-in session. An empty name is allowed (the address is used instead). */
export async function handleSetName(request: Request, deps: Deps): Promise<Response> {
  const gate = await open(request, deps, "account-name", limiters.profile);
  if (!gate.ok) return gate.response;
  const session = await renewSession(deps.jar, gate.rt);
  if (session.status !== "ok") return jsonResponse(401, { code: "signed_out", error: "Please sign in again." });
  const displayName = parseDisplayName(gate.body.displayName);
  if (displayName.length > NAME_MAX) return jsonResponse(422, { error: "Please check your answers and try again.", errors: { displayName: `Use at most ${NAME_MAX} characters.` } });
  try {
    await gate.rt.store.accounts.updateDisplayName(session.user.id, displayName);
  } catch {
    logOutcome("account-name", "failed");
    return UNAVAILABLE();
  }
  logOutcome("account-name", "ok");
  return jsonResponse(200, { success: true, displayName });
}

/** GET /api/account/me: who is signed in, for the client components that need to know. No cookie, no answer. */
export async function handleMe(deps: Deps): Promise<Response> {
  if (!deps.rt) return jsonResponse(503, { code: "unavailable" });
  const session = await renewSession(deps.jar, deps.rt);
  if (session.status !== "ok") return jsonResponse(401, { code: "signed_out" }, { "Cache-Control": "no-store" });
  return jsonResponse(200, { user: { displayName: session.user.displayName } }, { "Cache-Control": "no-store" });
}

export { ACCESS_COOKIE, REFRESH_COOKIE };
