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
