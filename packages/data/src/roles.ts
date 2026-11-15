// Roles, the permissions each one carries, and the rules for changing a person's roles. PURE: no I/O, so every rule has a table test
// (roles.test.ts) and the web app, the database functions and the in-memory store all answer from the same place.
//
// A person holds a SET of roles (docs/ROLE_PERMISSIONS.md). What they may do at the PAGE and ACTION layers is the UNION of what each role
// allows. That is all a union ever decides. The OBJECT layer (this lesson, this child, this family) is never widened by it: each role is
// scoped to its own record, and a person sees the union of what each of their roles reaches, never more than one role reaches alone.
// A student who is also a junior tutor therefore sees their own student data and the students they are assigned to as a tutor, not
// every student: see `lib/auth/scope.ts` in apps/web.

/** Stored and compared as upper case. `CLIENT` is the parent or guardian role (the word "parent" in the product). */
export const ROLES = ["ADMIN", "TUTOR", "JUNIOR_TUTOR", "CLIENT", "STUDENT"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  TUTOR: "Tutor",
  JUNIOR_TUTOR: "Junior tutor",
  CLIENT: "Parent",
  STUDENT: "Student",
};

/** Which role stands for a person where something still wants ONE (a header, a default landing page, a legacy column). Highest first. */
export const PRIMARY_ORDER: readonly Role[] = ["ADMIN", "TUTOR", "JUNIOR_TUTOR", "CLIENT", "STUDENT"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Roles that can never be held together. A junior tutor is a narrower tutor, so holding both would turn a junior into a full tutor by union.
 *  A learner cannot also own a family account (the database refuses it too: migration 0010). */
export const EXCLUSIVE_PAIRS: ReadonlyArray<readonly [Role, Role]> = [
  ["TUTOR", "JUNIOR_TUTOR"],
  ["CLIENT", "STUDENT"],
];

/** Sorted by `PRIMARY_ORDER`, without duplicates: one canonical form so two sets compare and store the same way. */
export function normaliseRoles(roles: Iterable<Role>): Role[] {
  const held = new Set(roles);
  return PRIMARY_ORDER.filter((r) => held.has(r));
}

export function primaryRole(roles: readonly Role[]): Role | null {
  return normaliseRoles(roles)[0] ?? null;
}

// ---- permissions -------------------------------------------------------------------------------------------------------------------

export const PERMISSIONS = [
  "admin.manage", // the admin screens and everything an administrator does to people, assignments and lessons
  "roles.assign", // add or remove another person's roles
  "attendance.mark",
  "lesson.complete",
  "report.draft", // write and save a lesson report (private notes included)
  "report.submit", // send a report on for approval
  "report.approve",
  "tutor.students", // the "My students" page
  "tutor.availability", // set when they can teach
  "concern.raise",
  "classroom.teach", // join a classroom as the tutor
  "classroom.learn", // join a classroom as a learner
  "family.view", // a parent's own children, reports and fees
  "learner.view", // a learner's own lessons and progress
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const TUTOR_PERMISSIONS: readonly Permission[] = [
  "attendance.mark", "lesson.complete", "report.draft", "report.submit", "tutor.students", "tutor.availability", "concern.raise", "classroom.teach",
];

/**
 * A junior tutor is a NARROWER tutor: everything a tutor can do except sending a report on and setting their own availability. This is
 * a proposal for the owners to confirm (no supervision rules exist yet: who checks a junior's work is undecided), and the narrowing is
 * deliberately in one list so it is one edit to change. `roles.test.ts` holds it to a strict subset of the tutor's.
 */
const JUNIOR_TUTOR_EXCLUDED: readonly Permission[] = ["report.submit", "tutor.availability"];

export const PERMISSIONS_BY_ROLE: Record<Role, readonly Permission[]> = {
  ADMIN: ["admin.manage", "roles.assign", "attendance.mark", "lesson.complete", "report.draft", "report.submit", "report.approve", "concern.raise"],
  TUTOR: TUTOR_PERMISSIONS,
  JUNIOR_TUTOR: TUTOR_PERMISSIONS.filter((p) => !JUNIOR_TUTOR_EXCLUDED.includes(p)),
  CLIENT: ["family.view"],
  STUDENT: ["learner.view", "classroom.learn"],
};

/** The union of what each held role allows. An unknown role contributes nothing. */
export function permissionsOf(roles: readonly Role[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const role of roles) for (const p of PERMISSIONS_BY_ROLE[role] ?? []) out.add(p);
  return out;
}

export function can(roles: readonly Role[], permission: Permission): boolean {
  return permissionsOf(roles).has(permission);
}

export const holdsAny = (roles: readonly Role[], allowed: readonly Role[]): boolean => roles.some((r) => allowed.includes(r));

// ---- a valid set of roles ------------------------------------------------------------------------------------------------------------

export type RoleSetProblem =
  | { code: "EMPTY"; message: string }
  | { code: "UNKNOWN_ROLE"; message: string }
  | { code: "EXCLUSIVE"; message: string };

/** A set of roles a person may hold, in canonical order, or why not. */
export function validateRoleSet(input: readonly unknown[]): { ok: true; roles: Role[] } | { ok: false; problem: RoleSetProblem } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, problem: { code: "EMPTY", message: "A person must keep at least one role." } };
  if (!input.every(isRole)) return { ok: false, problem: { code: "UNKNOWN_ROLE", message: "That is not a role." } };
  const roles = normaliseRoles(input as Role[]);
  for (const [a, b] of EXCLUSIVE_PAIRS) {
    if (roles.includes(a) && roles.includes(b)) {
      return { ok: false, problem: { code: "EXCLUSIVE", message: `${ROLE_LABELS[a]} and ${ROLE_LABELS[b].toLowerCase()} cannot be held by the same person.` } };
    }
  }
  return { ok: true, roles };
}

// ---- changing a person's roles --------------------------------------------------------------------------------------------------------

export type RoleChangeRefusal = "NOT_ADMIN" | "SELF" | "UNKNOWN_ROLE" | "EMPTY" | "EXCLUSIVE" | "LAST_ADMIN" | "UNCHANGED";

export type RoleChangePlan =
  | { ok: true; before: Role[]; after: Role[]; added: Role[]; removed: Role[] }
  | { ok: false; reason: RoleChangeRefusal; message: string };

const REFUSALS: Record<RoleChangeRefusal, string> = {
  NOT_ADMIN: "Only an administrator can change roles.",
  SELF: "You cannot change your own roles. Ask another administrator.",
  UNKNOWN_ROLE: "That is not a role.",
  EMPTY: "A person must keep at least one role.",
  EXCLUSIVE: "Those roles cannot be held together.",
  LAST_ADMIN: "This is the last administrator. Make someone else an administrator first.",
  UNCHANGED: "Nothing would change.",
};

const refuse = (reason: RoleChangeRefusal, message = REFUSALS[reason]): RoleChangePlan => ({ ok: false, reason, message });

/**
 * Decides a change of roles BEFORE anything is written. `actorRoles` is read from the store by the caller, never from the request.
 * `adminCount` is how many people hold ADMIN now, the target included. The same rules are enforced again inside the database function
 * that writes the change (migration 0025), so a caller that skipped this still cannot break them.
 *
 * Order matters: a person who is not an administrator is told only that, whatever they asked for.
 */
export function planRoleChange(input: {
  actorId: string;
  actorRoles: readonly Role[];
  targetId: string;
  targetRoles: readonly Role[];
  requested: readonly unknown[];
  adminCount: number;
}): RoleChangePlan {
  if (!input.actorRoles.includes("ADMIN")) return refuse("NOT_ADMIN");
  if (input.actorId === input.targetId) return refuse("SELF");
  const valid = validateRoleSet(input.requested);
  if (!valid.ok) return refuse(valid.problem.code, valid.problem.message);
  const before = normaliseRoles(input.targetRoles);
  const after = valid.roles;
  if (before.includes("ADMIN") && !after.includes("ADMIN") && input.adminCount <= 1) return refuse("LAST_ADMIN");
  const added = after.filter((r) => !before.includes(r));
  const removed = before.filter((r) => !after.includes(r));
  if (added.length === 0 && removed.length === 0) return refuse("UNCHANGED");
  return { ok: true, before, after, added, removed };
}

/** One line of the role audit: who changed whose roles, when, from what to what. Ids and role names only, never a name or an address. */
export interface RoleChangeRecord {
  at: Date;
  actorProfileId: string;
  targetProfileId: string;
  before: Role[];
  after: Role[];
}
