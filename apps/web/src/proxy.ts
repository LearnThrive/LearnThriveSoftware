import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PORTAL_CLOSED_PATH, PORTAL_ENABLED } from "@/lib/portal";

/**
 * Production gate for everything that is not the public marketing site (plan15 Wave 12 section 16.1).
 *
 *  - /dev/** and /api/dev/** are development tools: always a 404 in production, portal on or off. (The
 *    pages and the route also guard themselves; this is the second lock, in one place.)
 *  - /login, /dashboard/** and /403 (the signed-in app and the classroom inside it) go to the branded
 *    "Portal opening soon" page while the portal is off.
 *  - /api/auth/** and /api/lessons/** (the app's own API: sign-in, calendar downloads) are a 404 while the
 *    portal is off: there is no auth provider to talk to yet.
 *
 * In development and in tests it does nothing (see lib/portal.ts), so no app behaviour changes there.
 * The matcher is a constant list because Next analyses it at build time.
 */
export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  const { pathname } = request.nextUrl;
  const isDevSurface = pathname === "/dev" || pathname.startsWith("/dev/") || pathname.startsWith("/api/dev/");
  if (isDevSurface) return notFound(pathname);

  if (PORTAL_ENABLED) return NextResponse.next();

  if (pathname.startsWith("/api/")) return notFound(pathname);

  const response = NextResponse.redirect(new URL(PORTAL_CLOSED_PATH, request.url), 307);
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
}

function notFound(pathname: string) {
  const body = pathname.startsWith("/api/") ? JSON.stringify({ error: "Not found." }) : "Not found.";
  return new NextResponse(body, {
    status: 404,
    headers: { "Content-Type": pathname.startsWith("/api/") ? "application/json" : "text/plain; charset=utf-8" },
  });
}

export const config = {
  matcher: ["/login", "/403", "/dashboard/:path*", "/api/auth/:path*", "/api/lessons/:path*", "/api/dev/:path*", "/dev/:path*"],
};
