import { redirect } from "next/navigation";
import { getSession } from "./session";
import type { AuthenticatedUser, Role } from "./types";

/** For Server Components (pages/layouts): redirects to /login if there's no valid session.
 * Always call this server-side — role/identity here comes from the server-validated session,
 * never from a client-supplied value (see plan section 10). */
export async function requireSession(): Promise<AuthenticatedUser> {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

/** As requireSession(), but also enforces role membership. Redirects to /403 (not /login) when
 * the user is authenticated but not permitted — a logged-in Student hitting an Admin route
 * should see "you don't have access", not be bounced back to a sign-in form they already used. */
export async function requireRole(allowed: Role[]): Promise<AuthenticatedUser> {
  const user = await requireSession();
  if (!allowed.includes(user.role)) redirect("/403");
  return user;
}

/** For API route handlers, where redirect() doesn't apply — returns null instead of throwing/
 * redirecting so the caller can shape its own JSON error response. */
export async function requireRoleForApi(allowed: Role[]): Promise<AuthenticatedUser | null> {
  const user = await getSession();
  if (!user || !allowed.includes(user.role)) return null;
  return user;
}
