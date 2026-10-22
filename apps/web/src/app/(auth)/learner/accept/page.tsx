import type { Metadata } from "next";
import Link from "next/link";
import { AccountShell } from "@/components/account/AccountShell";
import { AcceptPanel } from "@/components/learner/AcceptPanel";
import { accountRuntime } from "@/lib/account/runtime";
import { currentSession } from "@/lib/account/pages";
import { hashToken } from "@/lib/learner/resolve";

// The invitation token is in this page's address, so no Referer may leave it and it is never indexed.
export const metadata: Metadata = { title: "Your invitation | LearnThrive", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AcceptPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" && raw.length > 0 && raw.length <= 200 ? raw : "";
  const rt = await accountRuntime();
  const peek = token && rt ? await rt.store.identity.peekInvitation(hashToken(token), new Date()) : ({ state: "invalid" } as const);
  const { state } = await currentSession();
  return (
    <AccountShell title="Your invitation" intro="A parent or guardian has set up a learner profile for you.">
      {peek.state === "open" ? (
        <AcceptPanel token={token} signedIn={state.status === "ok"} initial={{ state: "open", email: peek.email }} />
      ) : (
        <p>
          That invitation cannot be used. It may have expired, been used already, or been cancelled. Ask your parent or guardian for a new one. <Link href="/login">Sign in</Link>
        </p>
      )}
    </AccountShell>
  );
}
