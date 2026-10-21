import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { accountSessionExpired } from "@/lib/access/current";
import { safeNextPath } from "@/lib/account/session";
import { getSession } from "./session";
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
 * never from a client-supplied value (see plan section 10). */
export async function requireSession(): Promise<AuthenticatedUser> {
  const user = await getSession();
  if (user) return user;
  const path = await requestedPath();
  if (await accountSessionExpired()) redirect(`/api/account/refresh?next=${encodeURIComponent(path || "/dashboard")}`);
  redirect(path ? `/login?next=${encodeURIComponent(path)}` : "/login");
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
