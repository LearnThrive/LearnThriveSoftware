import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountShell } from "@/components/account/AccountShell";
import { ResetPasswordForm } from "@/components/account/ResetPasswordForm";
import { currentSession } from "@/lib/account/pages";

export const metadata: Metadata = { title: "New password | LearnThrive", robots: { index: false, follow: false } };

export default async function ResetPage() {
  const { state } = await currentSession();
  if (state.status === "refresh_needed") redirect("/api/account/refresh?next=%2Faccount%2Freset");
  // A person on a temporary password arrives here from anywhere they try to go, and may do nothing else until it is done.
  const temporary = state.status === "password_change";
  return (
    <AccountShell title="Choose a new password">
      {temporary ? <p>You signed in with a temporary password. Choose your own to carry on.</p> : null}
      {state.status === "ok" || temporary ? (
        <ResetPasswordForm />
      ) : (
        <p>
          Your link has expired. <Link href="/account/forgot">Ask for a new one</Link>.
        </p>
      )}
    </AccountShell>
  );
}
