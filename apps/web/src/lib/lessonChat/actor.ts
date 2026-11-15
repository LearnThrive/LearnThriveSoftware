import type { ChatActor } from "@learnthrive/data/lessonChat";
import { toPlatformUser } from "@/lib/access/platformUser";
import { accountRuntime } from "@/lib/account/runtime";
import { recordFor, rolesOf } from "@/lib/auth/scope";
import type { AuthenticatedUser } from "@/lib/auth/types";

/** The linked emails of the safeguarding leads. */
export interface ChatLeads { emails: string[] }

/**
 * The leads, from the same environment variable the safeguarding pages use (SAFEGUARDING_LEAD_EMAILS). Read here, not through the safeguarding module,
 * because only the guarded safeguarding code may import that (tests/safeguardingAccess.test.mjs): the chat needs to know who a lead IS, never what
 * they read. A lead who reads a lesson's chat is audit-logged like an administrator.
 */
export function leadsFromEnv(env: Record<string, string | undefined> = process.env): ChatLeads {
  return { emails: (env.SAFEGUARDING_LEAD_EMAILS ?? "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) };
}

/**
 * Who is acting, as the chat's rules see them. Built on the server from the signed-in person, with each of their roles' own record (a person with
 * several roles has a tutor record, a student record and a family, and each is checked against the lesson separately: never "has the role, so may").
 */
export function chatActorFor(user: Pick<AuthenticatedUser, "id" | "name" | "email" | "role" | "roles" | "profileId" | "tutorId" | "clientId" | "studentId">, leads: ChatLeads): ChatActor {
  const holder = user as AuthenticatedUser;
  const roles = rolesOf(user);
  return {
    accountId: user.id,
    name: user.name,
    roles,
    // The tutor record behind a TUTOR or JUNIOR_TUTOR role. (A junior's record lets them READ their lesson; the rules stop them sending.)
    tutorId: recordFor(holder, "TUTOR") ?? recordFor(holder, "JUNIOR_TUTOR"),
    studentId: recordFor(holder, "STUDENT"),
    clientId: recordFor(holder, "CLIENT"),
    isSafeguardingLead: leads.emails.includes(user.email.trim().toLowerCase()),
  };
}

/**
 * The person behind an account id, looked up fresh: their roles and records as they are NOW. Used where the browser is not the caller (the classroom
 * server relays a chat message and names only the account id). Null if there is no such account or no backend.
 */
export async function userForAccount(accountId: string): Promise<AuthenticatedUser | null> {
  if (typeof accountId !== "string" || accountId.length === 0 || accountId.length > 100) return null;
  const rt = await accountRuntime();
  if (!rt) return null;
  const account = await rt.store.accounts.getAccount(accountId);
  if (!account) return null;
  const records = await rt.store.accounts.records(accountId);
  return toPlatformUser({ email: account.linkedEmail ?? "", displayName: account.displayName }, account, records);
}
