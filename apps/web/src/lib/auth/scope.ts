import { can as canRoles, holdsAny, normaliseRoles, primaryRole, type Permission, type Role } from "@learnthrive/data/roles";
import type { AuthenticatedUser } from "./types";

/**
 * One person, several roles (docs/ROLE_PERMISSIONS.md). Two different questions, answered in two different ways, and kept apart on purpose:
 *
 *   PAGE and ACTION permissions are the UNION of what each role allows. `holds`, `holdsAny` and `can` answer them.
 *
 *   OBJECT access (this lesson, this child, this family) is NEVER widened by that union. Each role reaches only the records its OWN relationship
 *   gives: a tutor role reaches the students on that tutor's assignments, a student role reaches that student, a parent role reaches that
 *   family, an administrator reaches everyone. A person's view is the union of what each of their roles reaches separately, which is never more
 *   than any one of them reaches alone. `scopes` is how that is done: one copy of the person per role, each carrying ONLY that role's record, so
 *   the existing per-role queries run unchanged on each and their answers are merged. A student who is also a junior tutor thus sees their own
 *   student data and the students they are assigned to, and never another student's records.
 */

type Holder = Pick<AuthenticatedUser, "role" | "roles">;

/** Every role held, in canonical order. An object with only `role` (older code, tests) holds that one. */
export function rolesOf(user: Holder): Role[] {
  return normaliseRoles(user.roles?.length ? user.roles : [user.role]);
}

export const holds = (user: Holder, role: Role): boolean => rolesOf(user).includes(role);
export const holdsAnyOf = (user: Holder, allowed: readonly Role[]): boolean => holdsAny(rolesOf(user), allowed);
/** Page and action permissions: the union over the person's roles. */
export const can = (user: Holder, permission: Permission): boolean => canRoles(rolesOf(user), permission);

export { primaryRole };

/** The id of the record a role stands on: the tutor, the family or the student. null if the person has none for that role. An administrator has none. */
export function recordFor(user: AuthenticatedUser, role: Role): string | null {
  const explicit = role === "TUTOR" || role === "JUNIOR_TUTOR" ? user.tutorId : role === "CLIENT" ? user.clientId : role === "STUDENT" ? user.studentId : undefined;
  if (explicit) return explicit;
  // A person with ONE role (a hand-built user in a test, or a single-role copy from `asRole`) stands on `profileId`.
  if (rolesOf(user).length === 1 && role === user.role && role !== "ADMIN") return user.profileId ?? null;
  return null;
}

/**
 * The same person acting as ONE of their roles: the role set narrowed to that role and `profileId` set to that role's own record. null when the
 * role needs a record they do not have. Used to run the per-role queries; nothing may grant access on the strength of the copy.
 */
export function asRole(user: AuthenticatedUser, role: Role): AuthenticatedUser | null {
  if (!holds(user, role)) return null;
  if (role === "ADMIN") return { ...user, role, roles: [role] };
  const record = recordFor(user, role);
  if (!record) return null;
  return { ...user, role, roles: [role], profileId: record };
}

/** One scoped copy per role the person holds and can act as. The per-role queries run on each; `unionOver` merges them. */
export function scopes(user: AuthenticatedUser): AuthenticatedUser[] {
  return rolesOf(user).map((r) => asRole(user, r)).filter((u): u is AuthenticatedUser => u !== null);
}

/** Runs a per-role read for each of the person's roles and merges the results by id, first seen first. Never returns more than the roles reach one by one. */
export async function unionOver<T extends { id: string }>(user: AuthenticatedUser, read: (scoped: AuthenticatedUser) => Promise<T[]>): Promise<T[]> {
  const seen = new Map<string, T>();
  for (const scoped of scopes(user)) for (const item of await read(scoped)) if (!seen.has(item.id)) seen.set(item.id, item);
  return [...seen.values()];
}
