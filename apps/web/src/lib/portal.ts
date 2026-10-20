import { libraryEnabled } from "@/lib/library-config";

/**
 * Is the signed-in app (login, dashboards, classroom, the auth API) reachable? (plan15 Wave 12)
 *
 * In production it is NOT, until a real auth provider exists (the development provider refuses to run
 * under NODE_ENV=production by design), so the public marketing site can ship on its own first. It
 * is turned on by building with `NEXT_PUBLIC_APP_PORTAL_ENABLED=true`, and only then. Outside
 * production (local development, the test suites) it is always on, so none of the app's code or tests
 * change. A NEXT_PUBLIC_ variable so the header and footer, which are client components, read the same
 * value the proxy enforces; it is fixed per build.
 */
export const PORTAL_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_APP_PORTAL_ENABLED === "true";

/** Where a visitor to a closed portal URL is sent. */
export const PORTAL_CLOSED_PATH = "/portal-opening-soon";

/**
 * Library carve-out (plan19 phase C). `LIBRARY_ENABLED=true` (a server variable read at request time, NOT
 * NEXT_PUBLIC) opens exactly the account and Library routes in production while the portal stays closed.
 * `decide` is the proxy's whole rule set as a pure function so it can be tested without Next: src/proxy.ts only
 * turns its answer into a response. `env` carries NODE_ENV, NEXT_PUBLIC_APP_PORTAL_ENABLED and LIBRARY_ENABLED.
 *
 * Opened by the flag (production, portal closed): /login, /account, /account/**, /library/** (member routes; the
 * public /library and /pricing pages are always public), /api/account/**, /api/library/**, /api/billing/** (the
 * Stripe webhook included: no cookies are needed) and /api/assistant/**. Never opened by it: /dashboard/**, /403,
 * /api/auth/**, /api/lessons/**, the classroom, /dev/** and /api/dev/**.
 *
 * /login under the flag: the page must show the account sign-in and never the development login form. That is
 * enforced twice: /api/auth/** (what the development form posts to) stays a 404, and the development provider
 * refuses to run under NODE_ENV=production. The login page itself branches on PORTAL_ENABLED (false in
 * production until the portal opens, true in development and tests).
 */
export type GateDecision = { action: "next" | "notFound" | "redirect"; noindex?: boolean };

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

export function decide(pathname: string, env: Record<string, string | undefined>): GateDecision {
  if (env.NODE_ENV !== "production") return { action: "next" };
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

  if (under(path, "/dev") || under(path, "/api/dev")) return { action: "notFound" };
  if (env.NEXT_PUBLIC_APP_PORTAL_ENABLED === "true") return { action: "next" };
  if (path === "/library" || path === "/pricing") return { action: "next" };

  if (libraryEnabled(env)) {
    const open =
      path === "/login" || under(path, "/account") || path.startsWith("/library/") ||
      ["/api/account", "/api/library", "/api/billing", "/api/assistant"].some((base) => under(path, base));
    // The member pages are never search results (next.config.ts already does this for /login and /api/**).
    if (open) return { action: "next", noindex: true };
  }

  return { action: path.startsWith("/api/") ? "notFound" : "redirect" };
}
