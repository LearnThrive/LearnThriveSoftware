import { NextResponse } from "next/server";
import { homePath } from "@learnthrive/data/library";
import { currentAccess } from "@/lib/access/current";
import { assistantClosed } from "@/lib/assistant/runtime";
import { getSession } from "@/lib/auth/session";
import { PORTAL_ENABLED } from "@/lib/portal";

/**
 * A minimal "who am I" endpoint for the public marketing header (plan6 sections 14 and 78).
 *
 * The public pages are statically generated for SEO (plan6 section 99), so they cannot read the
 * session cookie during rendering — doing that in the layout would make every marketing page
 * dynamic. Instead the header asks this endpoint after hydration and swaps "Login" for the person's
 * place if there's a session: "Dashboard" for staff and enrolled families, "Study Buddy" or "Library"
 * for a Library member, "Account" for someone signed in with nothing yet. Returns only a display name,
 * role and a path: never the email, never the session token, nothing an unauthenticated caller could use.
 */
export async function GET() {
  const headers = { "cache-control": "no-store" };
  const user = await getSession();
  const who = await currentAccess();
  if (!user && !who) return NextResponse.json({ signedIn: false }, { headers });

  const studyBuddyOpen = assistantClosed(process.env, true) === null;
  const home = who ? homePath(who.access, { studyBuddyOpen, dashboardOpen: PORTAL_ENABLED }) : "/dashboard";
  const homeLabel = home === "/dashboard" ? "Dashboard" : home === "/library/study-buddy" ? "Study Buddy" : home === "/library" ? "Library" : "Account";
  const name = user?.name ?? who?.account.displayName ?? who?.user.email ?? "Member";
  return NextResponse.json({ signedIn: true, name, role: user?.role ?? who?.account.role ?? "CLIENT", home, homeLabel }, { headers });
}
