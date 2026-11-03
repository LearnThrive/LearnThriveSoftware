import type { AccountRole } from "@learnthrive/data/library";
import { generateTemporaryPassword } from "./credentials";
import type { AccountRuntime } from "./runtime";
import { internalEmailFor, usernameError } from "./username";
import { NAME_MAX, emailError } from "./validation";

/**
 * Making and looking after logins (docs/AUTHENTICATION.md, "Accounts are made, not signed up for"). Nobody signs themselves up, so this is
 * the only way a login comes to exist: the Auth Admin API makes it, then one database transaction binds it to its username, linked email,
 * role and record. If that refuses, the login is deleted again, so a person is never half made. Callers check the caller is an
 * administrator first (lib/actions/accounts.ts); the operator script does the same work for the first administrators.
 *
 * ADMIN is refused here: promotion stays a controlled script, never a screen, whatever a form posts.
 */
export type RefusalReason = "bad_username" | "bad_email" | "bad_name" | "username_taken" | "not_eligible" | "weak_password" | "unavailable";

export interface Refused {
  status: "refused";
  reason: RefusalReason;
  message: string;
}

export interface Created {
  status: "created";
  profileId: string;
  username: string;
  /** Shown once to the administrator. Never stored, logged or put in a URL. */
  temporaryPassword: string;
}

export interface NewLogin {
  username: string;
  linkedEmail: string;
  displayName: string;
  role: AccountRole;
  tutorId?: string | null;
  studentId?: string | null;
  actor: string;
}

const refused = (reason: RefusalReason, message: string): Refused => ({ status: "refused", reason, message });
const UNAVAILABLE = "That could not be done just now. Nothing was changed. Please try again shortly.";

export async function createLogin(rt: AccountRuntime, input: NewLogin): Promise<Created | Refused> {
  if (input.role === "ADMIN") return refused("not_eligible", "Administrators are made by the operator script, never here.");
  const usernameProblem = usernameError(input.username);
  if (usernameProblem) return refused("bad_username", usernameProblem);
  const emailProblem = emailError(input.linkedEmail);
  if (emailProblem) return refused("bad_email", emailProblem);
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > NAME_MAX) return refused("bad_name", `Enter a name of at most ${NAME_MAX} characters.`);
  if (!rt.admin) return refused("unavailable", "Accounts cannot be created here: the server has no Auth admin key.");
  if (await rt.store.accounts.findByUsername(input.username)) return refused("username_taken", "That username is already in use. Choose another.");

  const temporaryPassword = generateTemporaryPassword();
  const made = await rt.admin.createUser({ email: internalEmailFor(input.username), password: temporaryPassword, displayName, adultConfirmed: input.role !== "STUDENT" });
  if (!made.ok) {
    if (made.reason === "exists") return refused("username_taken", "That username is already in use. Choose another.");
    return refused(made.reason, UNAVAILABLE);
  }

  let bound: Awaited<ReturnType<AccountRuntime["store"]["accounts"]["provision"]>> | null = null;
  try {
    bound = await rt.store.accounts.provision({
      profileId: made.id,
      username: input.username,
      linkedEmail: input.linkedEmail,
      displayName,
      role: input.role,
      tutorId: input.tutorId ?? null,
      studentId: input.studentId ?? null,
      actor: input.actor,
    });
  } finally {
    if (bound !== "ok") await rt.admin.deleteUser(made.id);
  }
  if (bound === "username_taken") return refused("username_taken", "That username is already in use. Choose another.");
  if (bound !== "ok") return refused("not_eligible", "That record already has a login, or cannot have one.");
  return { status: "created", profileId: made.id, username: input.username, temporaryPassword };
}

/** The fallback when a person cannot use the emailed link: a new temporary password, which every session must replace. Audited. */
export async function issueTemporaryPassword(rt: AccountRuntime, profileId: string, actor: string): Promise<Created | Refused> {
  if (!rt.admin) return refused("unavailable", "Passwords cannot be reset here: the server has no Auth admin key.");
  const account = await rt.store.accounts.getAccount(profileId);
  if (!account?.username) return refused("not_eligible", "That person has no login to reset.");
  const temporaryPassword = generateTemporaryPassword();
  // Flag first: if the second step fails the person is asked to change a password that still works, not left on one nobody was told about.
  await rt.store.accounts.setMustChangePassword(profileId, true);
  const set = await rt.admin.setPassword(profileId, temporaryPassword);
  if (!set.ok) return refused(set.reason, UNAVAILABLE);
  await rt.store.identity.recordAudit({ actor, action: "temporary_password_issued", clientId: account.clientId, studentId: account.learner?.studentId ?? null, now: new Date() });
  return { status: "created", profileId, username: account.username, temporaryPassword };
}

/** Disables a login so it cannot sign in, or restores it (3.2.6). Auth holds the ban; the profile is what the site reads. Audited. */
export async function setLoginDisabled(rt: AccountRuntime, profileId: string, disabled: boolean, actor: string): Promise<boolean> {
  const account = await rt.store.accounts.getAccount(profileId);
  if (!rt.admin || !account) return false;
  if (!(await rt.admin.setDisabled(profileId, disabled))) return false;
  await rt.store.accounts.setLoginDisabled(profileId, disabled ? new Date() : null);
  await rt.store.identity.recordAudit({ actor, action: disabled ? "login_disabled" : "login_enabled", clientId: account.clientId, studentId: account.learner?.studentId ?? null, now: new Date() });
  return true;
}

/** Corrects a linked address. A parent's change carries to their children, whose resets go to it. Audited: ids only, never the address. */
export async function changeLinkedEmail(rt: AccountRuntime, profileId: string, email: string, actor: string): Promise<Refused | { status: "changed" }> {
  const problem = emailError(email);
  if (problem) return refused("bad_email", problem);
  const account = await rt.store.accounts.getAccount(profileId);
  if (!account) return refused("not_eligible", "That person has no login.");
  await rt.store.accounts.setLinkedEmail(profileId, email);
  await rt.store.identity.recordAudit({ actor, action: "linked_email_changed", clientId: account.clientId, studentId: account.learner?.studentId ?? null, now: new Date() });
  return { status: "changed" };
}
