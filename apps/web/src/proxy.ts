import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PORTAL_CLOSED_PATH, decide } from "@/lib/portal";

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
 *  - LIBRARY_ENABLED=true (plan19 phase C) additionally opens only the account and Library routes, listed in
 *    lib/portal.ts `decide`, which holds every rule above as a pure, tested function. The public /library and
 *    /pricing pages are static and always open.
 *
 * In development and in tests it does nothing (see lib/portal.ts), so no app behaviour changes there.
 * The matcher is a constant list because Next analyses it at build time.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Literal env reads so NODE_ENV and the NEXT_PUBLIC_ flag are fixed per build as before; LIBRARY_ENABLED is read per request.
  const { action, noindex } = decide(pathname, {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_PORTAL_ENABLED: process.env.NEXT_PUBLIC_APP_PORTAL_ENABLED,
    LIBRARY_ENABLED: process.env.LIBRARY_ENABLED,
  });
  if (action === "notFound") return notFound(pathname);
  if (action === "next") {
    const response = NextResponse.next();
    if (noindex) response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }
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
  matcher: [
    "/login", "/403", "/dashboard/:path*", "/api/auth/:path*", "/api/lessons/:path*", "/api/dev/:path*", "/dev/:path*",
    // plan19 phase C. ":path+" on /library so the public /library page itself never reaches the proxy.
    "/account/:path*", "/library/:path+", "/api/account/:path*", "/api/library/:path*", "/api/billing/:path*", "/api/assistant/:path*",
  ],
};
