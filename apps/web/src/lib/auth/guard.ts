import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { accountSessionExpired } from "@/lib/access/current";
import { safeNextPath } from "@/lib/account/session";
import { enforceCloseOut } from "@/lib/lessons/closeOutGate";
import { getSession } from "./session";
import type { Permission } from "@learnthrive/data/roles";
import { can, holdsAnyOf } from "./scope";
import { asTutor } from "./teaching";
import type { AuthenticatedUser, Role } from "./types";

/** The header the proxy (src/proxy.ts) stamps on every request it matches: the path and query being asked for. Re-validated on use. */
export const REQUESTED_PATH_HEADER = "x-learnthrive-path";

async function requestedPath(): Promise<string> {
  try {
    return safeNextPath((await headers()).get(REQUESTED_PATH_HEADER), "");
  } catch {
    return "";
  }
}

/** For Server Components (pages/layouts): redirects to the one sign-in (/login) if there's no valid session, carrying the page that was
 * asked for so signing in returns there (the sign-in sends a person who may not open it to their own home instead). A signed-in account
 * whose short-lived access token has lapsed goes through the renewing route first, which comes straight back.
 * Always call this server-side — role/identity here comes from the server-validated session,
 * never from a client-supplied value (see plan section 10).
 * A tutor with a lesson that is over but not closed out is sent to the close-out screen (lib/lessons/closeOutGate.ts). */
export async function requireSession(): Promise<AuthenticatedUser> {
  const user = await getSession();
  const path = await requestedPath();
  if (user) {
    await enforceCloseOut(user, path);
    return user;
  }
  if (await accountSessionExpired()) redirect(`/api/account/refresh?next=${encodeURIComponent(path || "/dashboard")}`);
  redirect(path ? `/login?next=${encodeURIComponent(path)}` : "/login");
}

/** As requireSession(), but also enforces role membership: ANY ONE of the person's roles being in `allowed` is enough (a person's page and
 * action permissions are the union of their roles'). Redirects to /403 (not /login) when the user is authenticated but not permitted —
 * a logged-in Student hitting an Admin route should see "you don't have access", not be bounced back to a sign-in form they already used. */
export async function requireRole(allowed: Role[]): Promise<AuthenticatedUser> {
  const user = await requireSession();
  if (!holdsAnyOf(user, allowed)) redirect("/403");
  return user;
}

/** As requireRole, but by what the person may DO rather than which role they hold: any of their roles giving the permission is enough. This
 * is how a junior tutor is let into attendance and report drafts but not into sending a report on or setting availability. */
export async function requirePermission(permission: Permission): Promise<AuthenticatedUser> {
  const user = await requireSession();
  if (!can(user, permission)) redirect("/403");
  return user;
}

/** For the tutor tools: anyone who teaches, whatever else they hold (lib/auth/teaching.ts), and holds `permission` (a junior tutor does not hold
 * every tutor permission). Returns the person scoped to their own teaching. */
export async function requireTutor(permission: Permission = "tutor.students"): Promise<AuthenticatedUser> {
  const user = await requireSession();
  const tutor = asTutor(user);
  if (!tutor || !can(user, permission)) redirect("/403");
  return tutor;
}

/** For API route handlers, where redirect() doesn't apply — returns null instead of throwing/
 * redirecting so the caller can shape its own JSON error response. */
export async function requireRoleForApi(allowed: Role[]): Promise<AuthenticatedUser | null> {
  const user = await getSession();
  if (!user || !holdsAnyOf(user, allowed)) return null;
  return user;
}

/** requireTutor() for a route handler. */
export async function requireTutorForApi(permission: Permission = "tutor.students"): Promise<AuthenticatedUser | null> {
  const user = await getSession();
  return user && can(user, permission) ? asTutor(user) : null;
}

/** requirePermission() for a route handler. */
export async function requirePermissionForApi(permission: Permission): Promise<AuthenticatedUser | null> {
  const user = await getSession();
  return user && can(user, permission) ? user : null;
}
