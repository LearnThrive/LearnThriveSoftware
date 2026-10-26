import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountAuthPanel } from "@/components/account/AccountAuthPanel";
import { AccountShell } from "@/components/account/AccountShell";
import { destinationFor } from "@learnthrive/data/library";
import { currentAccess } from "@/lib/access/current";
import { currentSession } from "@/lib/account/pages";
import { safeNextPath } from "@/lib/account/session";
import { assistantClosed } from "@/lib/assistant/runtime";
import { libraryTermsHref } from "@/lib/billing/offer";
import { createMetadata } from "@/lib/metadata";
import { PORTAL_ENABLED } from "@/lib/portal";

export const metadata: Metadata = {
  ...createMetadata({ title: "Sign in", description: "Sign in to LearnThrive.", path: "/login" }),
  robots: { index: false, follow: false },
};

/**
 * The one front door (plan: LearnThrive AI inside the platform). Everybody signs in here with the same account (the Library's real
 * sign-in: verified email, lockout, Supabase in production): tutors, administrators, enrolled families and Library members alike. What a
 * person finds after signing in is decided by `destinationFor` from their role and their Library standing, not by which page they used:
 * staff and enrolled families open the dashboard, a subscriber opens LearnThrive AI, and the page they originally asked for is kept when
 * their access includes it. Someone already signed in who arrives here is sent on at once.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined | string[]>> }) {
  const raw = (await searchParams).next;
  const requested = safeNextPath(typeof raw === "string" ? raw : undefined, "");
  const { rt, state } = await currentSession();

  // A lapsed access token (they last signed in more than an hour ago): renew it and come straight back, instead of showing a form.
  if (state.status === "refresh_needed") redirect(`/api/account/refresh?next=${encodeURIComponent("/login" + (requested ? `?next=${encodeURIComponent(requested)}` : ""))}`);

  if (state.status === "ok") {
    const who = await currentAccess();
    if (who) redirect(destinationFor(who.access, requested, { studyBuddyOpen: assistantClosed(process.env, true) === null, dashboardOpen: PORTAL_ENABLED }));
  }

  return (
    <AccountShell>
      {rt ? <AccountAuthPanel initialMode="sign-in" next={requested} termsHref={libraryTermsHref()} /> : <p>Accounts are not open yet. Please check back soon.</p>}
    </AccountShell>
  );
}
