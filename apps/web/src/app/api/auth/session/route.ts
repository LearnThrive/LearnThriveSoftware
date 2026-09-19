import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

/**
 * A minimal "who am I" endpoint for the public marketing header (plan6 sections 14 and 78).
 *
 * The public pages are statically generated for SEO (plan6 section 99), so they cannot read the
 * session cookie during rendering — doing that in the layout would make every marketing page
 * dynamic. Instead the header asks this endpoint after hydration and swaps "Login" for
 * "Dashboard" if there's a session. Returns only a display name and role: never the email, never
 * the session token, nothing an unauthenticated caller could use.
 */
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ signedIn: false }, { headers: { "cache-control": "no-store" } });
  return NextResponse.json(
    { signedIn: true, name: user.name, role: user.role },
    { headers: { "cache-control": "no-store" } },
  );
}
