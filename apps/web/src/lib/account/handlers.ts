import { accessFactsFor, destinationFor, platformAccess } from "@learnthrive/data/library";
import { asString } from "@/lib/forms-common";
import { humanCheckAvailable, verifyHumanCheck } from "@/lib/human-check";
import { SlidingWindowLimiter, clientAddress } from "@/lib/rate-limit";
import { jsonResponse, logOutcome, originAllowed, readBodyLimited } from "@/lib/request-guards";
import { siteConfig } from "@/lib/site";
import type { AccountRuntime } from "./runtime";
import { ACCESS_COOKIE, REFRESH_COOKIE, clearSessionCookies, forgetAccessToken, renewSession, safeNextPath, setSessionCookies, type CookieJar } from "./session";
import { sendResetLink } from "./resetEmail";
import { selfServiceAccounts } from "./selfService";
import { parseUsername, signInAddress, usernameFormatError } from "./username";
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
/**
 * The shortest a refused sign-in or a reset request takes in production. Auth answers an unknown address sooner than it can check a password,
 * and only a real account gets a reset email, so without a floor the time taken would say which usernames exist. Well above both.
 */
const ANSWER_FLOOR_MS = 900;
const FALLBACK = `Please email ${siteConfig.email} and we will help.`;

/** Per visitor address and for the whole route, as for the other forms (lib/rate-limit.ts). */
export const accountRateLimits = {
  signUp: { perClient: { max: 5, windowMs: 60 * 60 * 1000 }, global: { max: 300, windowMs: 60 * 60 * 1000 } },
  emailLink: { perClient: { max: 6, windowMs: 60 * 60 * 1000 }, global: { max: 300, windowMs: 60 * 60 * 1000 } },
  verify: { perClient: { max: 30, windowMs: 15 * 60 * 1000 }, global: { max: 600, windowMs: 15 * 60 * 1000 } },
  password: { perClient: { max: 10, windowMs: 15 * 60 * 1000 }, global: { max: 300, windowMs: 15 * 60 * 1000 } },
  profile: { perClient: { max: 20, windowMs: 15 * 60 * 1000 }, global: { max: 600, windowMs: 15 * 60 * 1000 } },
  /** Reset emails to one account, from anywhere: an inbox cannot be flooded by asking from many addresses. */
  resetPerAccount: { perClient: { max: 3, windowMs: 60 * 60 * 1000 }, global: { max: 600, windowMs: 60 * 60 * 1000 } },
} as const;

const limiters = {
  signUp: new SlidingWindowLimiter(accountRateLimits.signUp.perClient, accountRateLimits.signUp.global),
  emailLink: new SlidingWindowLimiter(accountRateLimits.emailLink.perClient, accountRateLimits.emailLink.global),
  verify: new SlidingWindowLimiter(accountRateLimits.verify.perClient, accountRateLimits.verify.global),
  password: new SlidingWindowLimiter(accountRateLimits.password.perClient, accountRateLimits.password.global),
  profile: new SlidingWindowLimiter(accountRateLimits.profile.perClient, accountRateLimits.profile.global),
  resetPerAccount: new SlidingWindowLimiter(accountRateLimits.resetPerAccount.perClient, accountRateLimits.resetPerAccount.global),
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
  /** Whether LearnThrive AI is open (the assistant is configured and approved): where a Library subscriber lands. Default closed. */
  studyBuddyOpen?: boolean;
  /** Whether the signed-in app (dashboard) is open: false in production until the portal opens. Default open. */
  dashboardOpen?: boolean;
  /** The floor on an answer that must not reveal an account. Default: ANSWER_FLOOR_MS in production, none elsewhere. */
  answerFloorMs?: number;
}

function answerFloor(deps: Deps): number {
  return deps.answerFloorMs ?? ((deps.env ?? process.env).NODE_ENV === "production" ? ANSWER_FLOOR_MS : 0);
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

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

/** LearnThrive makes every account: what the public sign-up and its relatives answer in production. */
export const accountsAreMadeForYou = () => jsonResponse(403, { code: "accounts_closed", error: `LearnThrive sets up every account for you. ${FALLBACK}` });

export async function handleSignUp(request: Request, deps: Deps): Promise<Response> {
  const gate = await open(request, deps, "account-signup", limiters.signUp);
  if (!gate.ok) return gate.response;
  if (!selfServiceAccounts(deps.env)) return accountsAreMadeForYou();
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

/**
 * The name to show for a person. public.profiles is the source of truth (it is what the account page edits and what is printed on
 * downloads); Auth keeps only the name given at sign-up, which goes stale after a rename (found on the real stack). Falls back to
 * that name if the profile cannot be read.
 */
async function shownName(rt: AccountRuntime, user: { id: string; displayName: string }): Promise<string> {
  try {
    const account = await rt.store.accounts.getAccount(user.id);
    return account ? account.displayName : user.displayName;
  } catch {
    return user.displayName;
  }
}

/**
 * Where a person goes after signing in: the page they asked for (`next`, reduced to a path on this site) if their access includes it,
 * otherwise their home: the dashboard for staff and enrolled families, LearnThrive AI (or the Library) for a subscriber, the account page
 * for someone with nothing yet. The one rule, `destinationFor`, is the same one the navigation and the assistant's routes use.
 * If their access cannot be read, the page asked for or the account page: signing in never fails over this.
 */
async function destinationAfterSignIn(rt: AccountRuntime, profileId: string, requested: string, deps: Deps): Promise<string> {
  try {
    const account = await rt.store.accounts.getAccount(profileId);
    if (!account) return requested || "/account";
    if (account.mustChangePassword) return "/account/reset";
    const facts = await accessFactsFor(rt.store, account);
    return destinationFor(platformAccess(account.role, facts), requested, { studyBuddyOpen: deps.studyBuddyOpen ?? false, dashboardOpen: deps.dashboardOpen ?? true });
  } catch {
    return requested || "/account";
  }
}

export async function handleSignIn(request: Request, deps: Deps): Promise<Response> {
  const startedAt = Date.now();
  const gate = await open(request, deps, "account-signin");
  if (!gate.ok) return gate.response;
  const { username, password } = parseSignIn(gate.body);
  const address = signInAddress(username, deps.env ?? process.env);
  if (!address || !password) return jsonResponse(400, { error: "Enter your username and password." });
  const lockout = gate.rt.lockout;
  if (lockout.locked(username, gate.address)) {
    logOutcome("account-signin", "locked");
    return jsonResponse(429, { error: "Too many sign-in attempts. Please try again in a few minutes, or reset your password." });
  }
  const result = await gate.rt.auth.signIn(address, password);
  if (!result.ok) {
    if (result.reason === "unavailable") return UNAVAILABLE();
    lockout.recordFailure(username, gate.address);
    logOutcome("account-signin", result.reason);
    await pause(startedAt + answerFloor(deps) - Date.now());
    if (result.reason === "email_not_confirmed") {
      return jsonResponse(403, { code: "email_not_confirmed", error: "Please confirm your email address first. We sent you a link when you created the account." });
    }
    if (result.reason === "account_disabled") return jsonResponse(403, { code: "account_disabled", error: `This account has been disabled. ${FALLBACK}` });
    return jsonResponse(401, { error: "Username or password is not right." });
  }
  lockout.recordSuccess(username);
  setSessionCookies(deps.jar, result.tokens, deps.env ?? process.env);
  logOutcome("account-signin", "ok");
  const next = await destinationAfterSignIn(gate.rt, result.user.id, safeNextPath(asString(gate.body.next), ""), deps);
  return jsonResponse(200, { success: true, user: { displayName: await shownName(gate.rt, result.user) }, next });
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

/**
 * "Send me a link": a forgotten password, or the verification email again. For a reset a person gives their username and the link goes to
 * the address linked to it (a child's to their parent). The answer and the time it takes are the same for every username; in production
 * the sending carries on after the answer if it runs long. An email address is only for the accounts of a local server's public sign-up.
 */
export async function handleEmailLink(request: Request, deps: Deps, purpose: "reset" | "verify"): Promise<Response> {
  const event = purpose === "reset" ? "account-forgot" : "account-resend";
  const gate = await open(request, deps, event, limiters.emailLink);
  if (!gate.ok) return gate.response;
  const env = deps.env ?? process.env;
  if (purpose === "verify" && !selfServiceAccounts(env)) return accountsAreMadeForYou();
  const bots = botChecks(gate.body, event, env);
  if (bots === "drop") return jsonResponse(200, { success: true });
  if (bots) return bots;
  const identifier = parseUsername(gate.body.username ?? gate.body.email);
  if (purpose === "reset" && !usernameFormatError(identifier)) {
    logOutcome(event, "sent");
    if (!limiters.resetPerAccount.allow(identifier)) return jsonResponse(200, { success: true });
    const sending = sendResetLink(gate.rt, identifier, env).catch(() => logOutcome(event, "failed", { reason: "threw" }));
    const floor = answerFloor(deps);
    await (floor > 0 ? pause(floor) : sending);
    return jsonResponse(200, { success: true });
  }
  if (!selfServiceAccounts(env)) return jsonResponse(422, { error: "Please check your answers and try again.", errors: { email: "Enter your username." } });
  const email = parseEmail(identifier);
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
  // The one route that accepts a session on a temporary password: it is what ends one.
  if ((session.status !== "ok" && session.status !== "password_change") || !access) return jsonResponse(401, { code: "signed_out", error: "Your link has expired. Please ask for a new one." });
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
  try {
    await gate.rt.store.accounts.setMustChangePassword(session.user.id, false);
  } catch {
    logOutcome("account-password", "failed");
    return UNAVAILABLE();
  }
  forgetAccessToken(access);
  await gate.rt.auth.signOutOthers(access);
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
  return jsonResponse(200, { user: { displayName: await shownName(deps.rt, session.user) } }, { "Cache-Control": "no-store" });
}

export { ACCESS_COOKIE, REFRESH_COOKIE };
