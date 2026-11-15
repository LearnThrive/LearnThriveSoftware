import { isRole, type Role } from "@learnthrive/data/roles";
import type { RoleChangeResult, RoleChangeStatus } from "@learnthrive/data/library";
import { can } from "@/lib/auth/scope";
import type { AuthenticatedUser } from "@/lib/auth/types";

/**
 * Changing a person's roles (docs/ROLE_PERMISSIONS.md, "Changing roles"). The ONE place a request becomes a role change, used by the API
 * route and by the admin screen's action, so the two cannot differ.
 *
 *   WHO       only a signed-in person whose own roles give `roles.assign` (an administrator). Read from the SESSION, never from the request.
 *   WHAT      exactly two fields are read: `profileId` and `roles`. Any other field is a 400, never ignored and never applied: a request cannot
 *             set a role by sneaking `role`, `roles`-shaped extras, `isAdmin` or anything else in alongside (mass assignment).
 *   THE RULES the store applies them again under a lock, in the database: not your own, never the last administrator, no tutor with a junior
 *             tutor, a person keeps at least one role, every change written to the audit log with who, when, before and after.
 *
 * Nothing else in the app can set roles: signup, profile, learner and provisioning handlers take no role from the browser (tests/roleAssignment).
 */

export type RoleActor = Pick<AuthenticatedUser, "id" | "role" | "roles">;

export interface RolesStore {
  changeRoles(input: { actor: string; profileId: string; roles: Role[]; now: Date }): Promise<RoleChangeResult>;
}

export type RoleHandlerResult =
  | { status: 200; body: { ok: true; before: Role[]; after: Role[] } }
  | { status: 400 | 401 | 403 | 404 | 409; body: { ok: false; code: string; message: string } };

const FIELDS = new Set(["profileId", "roles"]);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROLES = 8;

const bad = (message: string, code = "bad_request"): RoleHandlerResult => ({ status: 400, body: { ok: false, code, message } });

const STATUS_FOR: Record<RoleChangeStatus, 400 | 403 | 404 | 409> = {
  NOT_ADMIN: 403, SELF: 403, NOT_FOUND: 404, UNKNOWN_ROLE: 400, EMPTY: 400, EXCLUSIVE: 400, LAST_ADMIN: 409, UNCHANGED: 409, NEEDS_RECORD: 409,
};

/** Checks the request, then asks the store. `actor` is who is signed in (null: nobody). `input` is untrusted. */
export async function changeRolesFor(
  actor: RoleActor | null,
  input: unknown,
  store: RolesStore,
  now: () => Date = () => new Date(),
): Promise<RoleHandlerResult> {
  if (!actor) return { status: 401, body: { ok: false, code: "signed_out", message: "Sign in first." } };
  if (!can(actor, "roles.assign")) return { status: 403, body: { ok: false, code: "NOT_ADMIN", message: "Only an administrator can change roles." } };

  if (typeof input !== "object" || input === null || Array.isArray(input)) return bad("Send an object with profileId and roles.");
  const body = input as Record<string, unknown>;
  const extra = Object.keys(body).filter((key) => !FIELDS.has(key));
  if (extra.length > 0) return bad("Only profileId and roles can be sent.", "unexpected_field");
  const { profileId, roles } = body;
  if (typeof profileId !== "string" || !ID.test(profileId)) return bad("Choose a person.");
  if (!Array.isArray(roles) || roles.length > MAX_ROLES || !roles.every((r): r is string => typeof r === "string")) return bad("Roles must be a list of role names.");
  if (!roles.every(isRole)) return bad("That is not a role.", "UNKNOWN_ROLE");

  const result = await store.changeRoles({ actor: actor.id, profileId, roles: [...new Set(roles)], now: now() });
  if (result.status === "changed") return { status: 200, body: { ok: true, before: result.before, after: result.after } };
  return { status: STATUS_FOR[result.reason], body: { ok: false, code: result.reason, message: result.message } };
}
