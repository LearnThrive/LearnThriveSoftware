import { createHash } from "node:crypto";
import { LEARNER_AI_CONSENT, directLoginAllowed, type AccessMode, type LinkStatus } from "@learnthrive/data/library";
import type { AccountRuntime } from "@/lib/account/runtime";
import { renewSession, safeNextPath, setSessionCookies, type CookieJar } from "@/lib/account/session";
import { parseDisplayName, parseEmail, emailError, passwordError } from "@/lib/account/validation";
import { SlidingWindowLimiter, clientAddress } from "@/lib/rate-limit";
import { jsonResponse, logOutcome, originAllowed, readBodyLimited } from "@/lib/request-guards";
import { SUPERVISED_COOKIE, SUPERVISED_MINUTES, hashToken, newToken } from "./resolve";

/**
 * The learner routes' logic (docs/IDENTITY.md): the guardian's side (add a student, invite them, choose how they get in, suspend,
 * revoke, consent, delete their chats) and the learner's side (accept an invitation, sign up from one, a guardian viewing as a learner).
 * The runtime and cookie jar are passed in so tests drive it without Next. Every handler: Origin check, session, then who the
 * person is, resolved on the server. Nothing in a body ever names a family, a role or an owner: a student id in a body is only ever a
 * lookup INSIDE the signed-in guardian's own family.
 *
 * Adult operations (everything under /api/learners, and billing) are refused while a supervised view is open: the guardian must leave
 * it with their password first, so a child using the guardian's browser cannot reach money or the guardian controls.
 */
export interface LearnerDeps {
  rt: AccountRuntime | null;
  jar: CookieJar;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY = 4 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX = 80;

export const LEARNER_CONSENT_TEXT =
  "I am this learner's parent or guardian. I agree that they may use LearnThrive AI, LearnThrive's AI study helper. I understand it is an AI that can make mistakes, that their conversations are private to them (I cannot read them, but I can delete them), and that I can withdraw this agreement at any time.";
// Bumped from "1" on 26 October 2026, when the product was renamed to LearnThrive AI: the text is hashed into every recorded
// consent (see consentHash below), so a consent given against "1" must not be read as agreement to "2".
export const LEARNER_CONSENT_VERSION = "2";
const consentHash = () => createHash("sha256").update(`${LEARNER_CONSENT_VERSION}\n${LEARNER_CONSENT_TEXT}`).digest("hex");

const limits = {
  invite: new SlidingWindowLimiter({ max: 20, windowMs: 60 * 60 * 1000 }, { max: 500, windowMs: 60 * 60 * 1000 }),
  signup: new SlidingWindowLimiter({ max: 5, windowMs: 60 * 60 * 1000 }, { max: 300, windowMs: 60 * 60 * 1000 }),
  accept: new SlidingWindowLimiter({ max: 20, windowMs: 15 * 60 * 1000 }, { max: 600, windowMs: 15 * 60 * 1000 }),
  leave: new SlidingWindowLimiter({ max: 10, windowMs: 15 * 60 * 1000 }, { max: 300, windowMs: 15 * 60 * 1000 }),
};
export function resetLearnerLimiters(): void {
  for (const l of Object.values(limits)) l.reset();
}

const clock = (deps: LearnerDeps) => (deps.now ?? (() => new Date()))();
const refuse = (status: number, code: string, error: string) => jsonResponse(status, { code, error }, NO_STORE);
const UNAVAILABLE = () => refuse(503, "unavailable", "We could not do that just now. Please try again shortly.");

/** Invitation lifetime and the day's cap, from the environment with conservative defaults. */
export function invitePolicy(env: Record<string, string | undefined>) {
  const hours = Number(env.LEARNER_INVITE_HOURS);
  const perDay = Number(env.LEARNER_INVITES_PER_DAY);
  const minYear = Number(env.LEARNER_DIRECT_MIN_YEAR);
  return {
    hours: Number.isFinite(hours) && hours >= 1 && hours <= 24 * 14 ? hours : 72,
    perDay: Number.isInteger(perDay) && perDay >= 1 && perDay <= 20 ? perDay : 5,
    minYear: Number.isInteger(minYear) && minYear >= 1 && minYear <= 13 ? minYear : 9,
  };
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const read = await readBodyLimited(request, MAX_BODY);
  if (!read.ok) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(read.bytes)) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type GuardianGate = { ok: true; rt: AccountRuntime; profileId: string; email: string; clientId: string; now: Date } | { ok: false; response: Response };

/** A signed-in adult account holder, not inside a supervised view. Used by every guardian-side route. */
async function guardianGate(request: Request, deps: LearnerDeps, event: string, mutating: boolean): Promise<GuardianGate> {
  const env = deps.env ?? process.env;
  if (mutating && !originAllowed(request, env)) {
    logOutcome(event, "forbidden_origin");
    return { ok: false, response: jsonResponse(403, { error: "Forbidden." }) };
  }
  if (!deps.rt) return { ok: false, response: refuse(503, "unavailable", "Accounts are not open yet.") };
  const session = await renewSession(deps.jar, deps.rt);
  if (session.status !== "ok") return { ok: false, response: refuse(401, "signed_out", "Please sign in again.") };
  const account = await deps.rt.store.accounts.getAccount(session.user.id);
  if (!account || account.role === "STUDENT" || account.learner) return { ok: false, response: refuse(403, "adult_required", "Only a parent or guardian can do that.") };
  if (!account.adultConfirmed) return { ok: false, response: refuse(403, "adult_required", "Only a parent or guardian can do that.") };
  const now = clock(deps);
  const token = deps.jar.get(SUPERVISED_COOKIE);
  if (token && (await deps.rt.store.identity.getSupervised(hashToken(token), account.profileId, now))) {
    return { ok: false, response: refuse(403, "leave_learner_view", "You are viewing as a learner. Leave that view (with your password) to manage your account.") };
  }
  const clientId = account.clientId ?? (await deps.rt.store.accounts.ensureClient(account.profileId));
  return { ok: true, rt: deps.rt, profileId: account.profileId, email: session.user.email, clientId, now };
}

const idOf = (value: string) => (UUID.test(value) ? value : null);

/** GET /api/learners: the family's students and where each stands. */
export async function handleListLearners(request: Request, deps: LearnerDeps): Promise<Response> {
  const g = await guardianGate(request, deps, "learners-list", false);
  if (!g.ok) return g.response;
  const policy = invitePolicy(deps.env ?? process.env);
  const students = await g.rt.store.identity.listFamilyStudents(g.clientId);
  const out = [];
  for (const s of students) {
    const open = s.invitationOpen ? (await g.rt.store.identity.listInvitations(g.clientId, s.id)).find((i) => !i.acceptedAt && !i.revokedAt) : undefined;
    out.push({
      openInvitationId: open?.id ?? null,
      id: s.id, displayName: s.displayName, yearGroup: s.yearGroup, isMinor: s.isMinor, accessMode: s.accessMode, learnerStatus: s.learnerStatus, invitationOpen: s.invitationOpen,
      canHaveOwnLogin: directLoginAllowed(s, policy.minYear), consent: await g.rt.store.identity.hasLearnerConsent(s.id),
    });
  }
  return jsonResponse(200, { students: out, consent: { version: LEARNER_CONSENT_VERSION, text: LEARNER_CONSENT_TEXT } }, NO_STORE);
}

/** POST /api/learners { displayName, yearGroup?, isMinor? }: add a student to the family. A first name only. */
export async function handleCreateLearner(request: Request, deps: LearnerDeps): Promise<Response> {
  const g = await guardianGate(request, deps, "learners-create", true);
  if (!g.ok) return g.response;
  const body = await readBody(request);
  if (!body) return refuse(400, "bad_request", "We could not read that.");
  const displayName = parseDisplayName(body.displayName);
  if (!displayName || displayName.length > NAME_MAX || displayName.includes("@") || /https?:\/\//i.test(displayName)) return refuse(422, "invalid", "Use a first name or nickname only (no email address or link).");
  const yearGroup = typeof body.yearGroup === "string" && body.yearGroup.trim() ? body.yearGroup.trim().slice(0, 40) : null;
  const isMinor = body.isMinor === false ? false : true;
  const student = await g.rt.store.identity.createStudent(g.clientId, { displayName, yearGroup, isMinor });
  logOutcome("learners-create", "ok");
  return jsonResponse(201, { student: { id: student.id, displayName: student.displayName } }, NO_STORE);
}

/** POST /api/learners/<id>/invite { email? }: the link a learner uses to get their own login. Shown once. */
export async function handleInvite(request: Request, deps: LearnerDeps, studentId: string): Promise<Response> {
  const g = await guardianGate(request, deps, "learners-invite", true);
  if (!g.ok) return g.response;
  const env = deps.env ?? process.env;
  if (!limits.invite.allow(`${g.profileId}`)) return refuse(429, "rate_limited", "Too many invitations. Please try again later.");
  const id = idOf(studentId);
  if (!id) return refuse(404, "not_found", "We could not find that learner.");
  const body = (await readBody(request)) ?? {};
  const email = typeof body.email === "string" && body.email.trim() ? parseEmail(body.email) : null;
  if (email !== null && emailError(email)) return refuse(422, "invalid_email", "Enter a valid email address, or leave it empty.");
  const student = await g.rt.store.identity.getFamilyStudent(g.clientId, id);
  if (!student) return refuse(404, "not_found", "We could not find that learner.");
  const policy = invitePolicy(env);
  if (!directLoginAllowed(student, policy.minYear)) {
    return refuse(422, "supervised_only", "This learner is too young for a login of their own. Use the supervised view instead: you sign in, and choose them.");
  }
  const token = newToken();
  const made = await g.rt.store.identity.createInvitation({
    clientId: g.clientId, studentId: id, invitedBy: g.profileId, email, tokenHash: hashToken(token), expiresAt: new Date(g.now.getTime() + policy.hours * 3_600_000), maxPerDay: policy.perDay, now: g.now,
  });
  if (!made.ok) {
    logOutcome("learners-invite", made.reason);
    if (made.reason === "limit") return refuse(429, "limit", "That is enough invitations for today. Please try again tomorrow.");
    if (made.reason === "already_learner") return refuse(409, "already_learner", "This learner already has a login. Suspend or revoke it first if you need a new one.");
    return refuse(404, "not_found", "We could not find that learner.");
  }
  logOutcome("learners-invite", "ok");
  const base = (env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "") || new URL(request.url).origin;
  return jsonResponse(201, { invitationId: made.invitation.id, expiresAt: made.invitation.expiresAt.toISOString(), link: `${base}/learner/accept?token=${token}` }, NO_STORE);
}

/** DELETE /api/learners/invitations/<id> */
export async function handleRevokeInvitation(request: Request, deps: LearnerDeps, invitationId: string): Promise<Response> {
  const g = await guardianGate(request, deps, "learners-revoke-invite", true);
  if (!g.ok) return g.response;
  const id = idOf(invitationId);
  const ok = id ? await g.rt.store.identity.revokeInvitation(g.clientId, id, g.profileId, g.now) : false;
  return ok ? jsonResponse(200, { success: true }, NO_STORE) : refuse(404, "not_found", "We could not find that invitation.");
}

/** POST /api/learners/<id>/access { mode: "none" | "supervised" }. "direct" only ever comes from an accepted invitation. */
export async function handleSetAccess(request: Request, deps: LearnerDeps, studentId: string): Promise<Response> {
  const g = await guardianGate(request, deps, "learners-access", true);
  if (!g.ok) return g.response;
  const body = await readBody(request);
  const mode = body?.mode;
  const id = idOf(studentId);
  if (!id || (mode !== "none" && mode !== "supervised")) return refuse(400, "bad_request", "We could not read that.");
  const student = await g.rt.store.identity.getFamilyStudent(g.clientId, id);
  // A learner with their own login keeps it ("direct") until it is suspended or revoked: this route never downgrades it silently.
  if (!student || student.accessMode === "direct") return refuse(student ? 409 : 404, student ? "has_login" : "not_found", student ? "This learner has a login of their own. Suspend or revoke it first." : "We could not find that learner.");
  const ok = await g.rt.store.identity.setAccessMode(g.clientId, id, mode as AccessMode, g.profileId, g.now);
  return ok ? jsonResponse(200, { accessMode: mode }, NO_STORE) : refuse(404, "not_found", "We could not find that learner.");
}

/** POST /api/learners/<id>/status { status: "active" | "suspended" | "revoked" } for a learner with their own login. */
export async function handleLearnerStatus(request: Request, deps: LearnerDeps, studentId: string): Promise<Response> {
  const g = await guardianGate(request, deps, "learners-status", true);
  if (!g.ok) return g.response;
  const body = await readBody(request);
  const status = body?.status;
  const id = idOf(studentId);
  if (!id || (status !== "active" && status !== "suspended" && status !== "revoked")) return refuse(400, "bad_request", "We could not read that.");
  const ok = await g.rt.store.identity.setLearnerStatus({ studentId: id, clientId: g.clientId, status: status as LinkStatus, actor: g.profileId, now: g.now });
  logOutcome("learners-status", ok ? status : "not_found");
  return ok ? jsonResponse(200, { status }, NO_STORE) : refuse(404, "not_found", "We could not find that learner's login.");
}

/** POST /api/learners/<id>/consent { granted: boolean }: the guardian's agreement that LearnThrive AI may be used. */
export async function handleConsent(request: Request, deps: LearnerDeps, studentId: string): Promise<Response> {
  const g = await guardianGate(request, deps, "learners-consent", true);
  if (!g.ok) return g.response;
  const body = await readBody(request);
  const id = idOf(studentId);
  if (!id || typeof body?.granted !== "boolean") return refuse(400, "bad_request", "We could not read that.");
  if (!(await g.rt.store.identity.getFamilyStudent(g.clientId, id))) return refuse(404, "not_found", "We could not find that learner.");
  if (body.granted) {
    const ok = await g.rt.store.identity.grantLearnerConsent({ studentId: id, guardianProfileId: g.profileId, version: LEARNER_CONSENT_VERSION, textSha256: consentHash(), now: g.now });
    return ok ? jsonResponse(200, { consent: true, kind: LEARNER_AI_CONSENT }, NO_STORE) : refuse(404, "not_found", "We could not find that learner.");
  }
  await g.rt.store.identity.withdrawLearnerConsent(id, g.now);
  return jsonResponse(200, { consent: false }, NO_STORE);
}

/** POST /api/learners/<id>/chats/delete: delete (never read) every conversation of this learner. */
export async function handleDeleteLearnerChats(request: Request, deps: LearnerDeps, studentId: string): Promise<Response> {
  const g = await guardianGate(request, deps, "learners-delete-chats", true);
  if (!g.ok) return g.response;
  const id = idOf(studentId);
  if (!id) return refuse(404, "not_found", "We could not find that learner.");
  const count = await g.rt.store.chat.requestLearnerDeletionAll(g.clientId, id, g.now);
  return jsonResponse(200, { deleted: count }, NO_STORE);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The learner's side
// ---------------------------------------------------------------------------------------------------------------------------------

const REFUSED_INVITATION = "That invitation cannot be used. Ask your parent or guardian for a new one.";

/** POST /api/learner/invitation { token }: what the invitation page may show before anyone signs in. Never the student's name. */
export async function handleInvitationPeek(request: Request, deps: LearnerDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  if (!originAllowed(request, env)) return jsonResponse(403, { error: "Forbidden." });
  if (!deps.rt) return UNAVAILABLE();
  if (!limits.accept.allow(clientAddress(request.headers, env))) return refuse(429, "rate_limited", "Too many attempts. Please try again later.");
  const body = await readBody(request);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token || token.length > 200) return refuse(400, "bad_request", REFUSED_INVITATION);
  const peek = await deps.rt.store.identity.peekInvitation(hashToken(token), clock(deps));
  if (peek.state !== "open") return refuse(410, peek.state, REFUSED_INVITATION);
  return jsonResponse(200, { open: true, email: peek.email }, NO_STORE);
}

/**
 * POST /api/learner/signup { token, email, password, displayName }: a learner makes the account the invitation will bind. No adult
 * declaration (they are not an adult account holder, and the account never becomes one); the address must match the invitation's if it
 * names one. The verification email Supabase sends proves they own the address; after it they open the invitation link again to accept.
 */
export async function handleLearnerSignUp(request: Request, deps: LearnerDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  if (!originAllowed(request, env)) return jsonResponse(403, { error: "Forbidden." });
  if (!deps.rt) return UNAVAILABLE();
  if (!limits.signup.allow(clientAddress(request.headers, env))) return refuse(429, "rate_limited", "Too many attempts. Please try again later.");
  const body = await readBody(request);
  if (!body) return refuse(400, "bad_request", "We could not read that.");
  const token = typeof body.token === "string" ? body.token : "";
  const peek = token ? await deps.rt.store.identity.peekInvitation(hashToken(token), clock(deps)) : ({ state: "invalid" } as const);
  if (peek.state !== "open") return refuse(410, peek.state, REFUSED_INVITATION);
  const email = parseEmail(body.email);
  const displayName = parseDisplayName(body.displayName);
  const password = typeof body.password === "string" ? body.password : "";
  const errors: Record<string, string> = {};
  if (emailError(email)) errors.email = "Enter a valid email address.";
  else if (peek.email && peek.email !== email.toLowerCase()) errors.email = "Use the email address your invitation was sent for.";
  const passwordProblem = passwordError(password);
  if (passwordProblem) errors.password = passwordProblem;
  if (displayName.length > NAME_MAX) errors.displayName = `Use at most ${NAME_MAX} characters.`;
  if (Object.keys(errors).length) return jsonResponse(422, { error: "Please check your answers and try again.", errors }, NO_STORE);
  const result = await deps.rt.auth.signUp({ email, password, displayName, adultConfirmed: false });
  if (!result.ok) {
    logOutcome("learner-signup", result.reason);
    if (result.reason === "weak_password") return jsonResponse(422, { error: "Please check your answers and try again.", errors: { password: "That password is too easy to guess or has appeared in a data breach. Choose a different one." } }, NO_STORE);
    if (result.reason === "invalid_email") return jsonResponse(422, { error: "Please check your answers and try again.", errors: { email: "Enter a valid email address." } }, NO_STORE);
    return UNAVAILABLE();
  }
  logOutcome("learner-signup", "sent");
  return jsonResponse(200, { success: true }, NO_STORE);
}

/** POST /api/learner/accept { token }: the signed-in account binds itself to the student the invitation names. */
export async function handleAcceptInvitation(request: Request, deps: LearnerDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  if (!originAllowed(request, env)) return jsonResponse(403, { error: "Forbidden." });
  if (!deps.rt) return UNAVAILABLE();
  if (!limits.accept.allow(clientAddress(request.headers, env))) return refuse(429, "rate_limited", "Too many attempts. Please try again later.");
  const session = await renewSession(deps.jar, deps.rt);
  if (session.status !== "ok") return refuse(401, "signed_out", "Please sign in first, then open your invitation link again.");
  const body = await readBody(request);
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token || token.length > 200) return refuse(400, "bad_request", REFUSED_INVITATION);
  const result = await deps.rt.store.identity.acceptInvitation({ tokenHash: hashToken(token), profileId: session.user.id, email: session.user.email, now: clock(deps) });
  if (!result.ok) {
    logOutcome("learner-accept", result.reason);
    if (result.reason === "email_mismatch") return refuse(403, "email_mismatch", "This invitation was sent to a different email address. Sign in with that address.");
    if (result.reason === "not_eligible") return refuse(403, "not_eligible", "This account cannot be used for a learner login. Use a new account made from the invitation.");
    return refuse(410, result.reason, REFUSED_INVITATION);
  }
  logOutcome("learner-accept", "ok");
  return jsonResponse(200, { success: true, next: safeNextPath("/library/study-buddy", "/account") }, NO_STORE);
}

/** POST /api/learner/view { studentId }: a guardian opens the supervised view of one of their learners. */
export async function handleStartView(request: Request, deps: LearnerDeps): Promise<Response> {
  const g = await guardianGate(request, deps, "learner-view", true);
  if (!g.ok) return g.response;
  const body = await readBody(request);
  const id = typeof body?.studentId === "string" ? idOf(body.studentId) : null;
  if (!id) return refuse(400, "bad_request", "We could not read that.");
  const token = newToken();
  const started = await g.rt.store.identity.startSupervised({ clientId: g.clientId, guardianProfileId: g.profileId, studentId: id, tokenHash: hashToken(token), expiresAt: new Date(g.now.getTime() + SUPERVISED_MINUTES * 60_000), now: g.now });
  if (!started) return refuse(404, "not_found", "That learner is not set up for the supervised view.");
  deps.jar.set(SUPERVISED_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: (deps.env ?? process.env).NODE_ENV === "production", path: "/" });
  logOutcome("learner-view", "started");
  return jsonResponse(200, { success: true, next: "/library/study-buddy" }, NO_STORE);
}

/**
 * POST /api/learner/view/leave { password }: leave the supervised view. The guardian proves it is them with their password (a fresh
 * sign-in that must be the same account), so a child using the guardian's open browser cannot get back to billing or the controls.
 */
export async function handleLeaveView(request: Request, deps: LearnerDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  if (!originAllowed(request, env)) return jsonResponse(403, { error: "Forbidden." });
  if (!deps.rt) return UNAVAILABLE();
  const session = await renewSession(deps.jar, deps.rt);
  if (session.status !== "ok") return refuse(401, "signed_out", "Please sign in again.");
  const address = clientAddress(request.headers, env);
  if (!limits.leave.allow(`${session.user.id}|${address}`) || deps.rt.lockout.locked(session.user.email, address)) return refuse(429, "rate_limited", "Too many attempts. Please try again in a few minutes.");
  const body = await readBody(request);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) return refuse(400, "bad_request", "Enter your password.");
  const result = await deps.rt.auth.signIn(session.user.email, password);
  if (!result.ok || result.user.id !== session.user.id) {
    deps.rt.lockout.recordFailure(session.user.email, address);
    logOutcome("learner-leave", "wrong_password");
    return refuse(401, "wrong_password", "That password is not right.");
  }
  deps.rt.lockout.recordSuccess(session.user.email);
  const token = deps.jar.get(SUPERVISED_COOKIE);
  if (token) await deps.rt.store.identity.endSupervised(hashToken(token), session.user.id, clock(deps));
  deps.jar.delete(SUPERVISED_COOKIE);
  setSessionCookies(deps.jar, result.tokens, env);
  logOutcome("learner-leave", "ok");
  return jsonResponse(200, { success: true, next: "/account/learners" }, NO_STORE);
}


