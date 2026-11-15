import type { Account, AccountRecords } from "@learnthrive/data/library";
import { normaliseRoles, primaryRole } from "@learnthrive/data/roles";
import type { AuthUser } from "@/lib/account/types";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { devRecordsFor } from "@/lib/dev/accounts";

/**
 * An account as the signed-in app's user. The id is the account's own id (the same one in every table that mentions the person); the
 * name is the profile's (what the account page edits), then the sign-up name, then the address. A person holds a SET of roles (`roles`;
 * `role` is the highest of them), and each role that stands on a domain record has its own: `tutorId` (they teach as this tutor, as a TUTOR or
 * JUNIOR_TUTOR), `clientId` (the family a parent owns) and `studentId` (the learner they are). In development the seeded records of the
 * development accounts; everywhere else the person's real records from the database. A record is kept only for a role the person holds, so
 * a record can never outlive the role that gave it. `profileId` is the record of the highest role that has one (an administrator keeps their
 * account id, which matches nothing, so a lookup finds nothing rather than someone else's data). The email is the linked one, never the
 * internal address Auth holds.
 */
export function toPlatformUser(
  user: Pick<AuthUser, "email" | "displayName">,
  account: Pick<Account, "profileId" | "displayName"> & Partial<Pick<Account, "username" | "linkedEmail" | "role" | "roles">>,
  records: Partial<AccountRecords> = {},
  env: Record<string, string | undefined> = process.env,
): AuthenticatedUser {
  const dev = devRecordsFor(account.profileId, env);
  const roles = normaliseRoles(account.roles?.length ? account.roles : account.role ? [account.role] : []);
  const role = primaryRole(roles) ?? "STUDENT";
  const tutorId = roles.some((r) => r === "TUTOR" || r === "JUNIOR_TUTOR") ? (dev?.tutorId ?? records.tutorId ?? null) : null;
  const clientId = roles.includes("CLIENT") ? (dev?.clientId ?? records.clientId ?? null) : null;
  const studentId = roles.includes("STUDENT") ? (dev?.studentId ?? records.studentId ?? null) : null;
  const own = role === "TUTOR" || role === "JUNIOR_TUTOR" ? tutorId : role === "CLIENT" ? clientId : role === "STUDENT" ? studentId : null;
  return {
    id: account.profileId,
    email: account.linkedEmail ?? user.email,
    role,
    roles,
    name: account.displayName || user.displayName || account.username || user.email,
    profileId: own ?? account.profileId,
    ...(tutorId ? { tutorId } : {}),
    ...(clientId ? { clientId } : {}),
    ...(studentId ? { studentId } : {}),
  };
}
