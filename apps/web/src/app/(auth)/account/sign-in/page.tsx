import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountAuthPanel } from "@/components/account/AccountAuthPanel";
import { AccountShell } from "@/components/account/AccountShell";
import { currentSession } from "@/lib/account/pages";
import { libraryTermsHref } from "@/lib/billing/offer";
import { safeNextPath } from "@/lib/account/session";
import { createMetadata } from "@/lib/metadata";

export const metadata: Metadata = {
  ...createMetadata({ title: "Sign in to the Library", description: "Sign in to the LearnThrive Library.", path: "/account/sign-in" }),
  robots: { index: false, follow: false },
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).next;
  const next = safeNextPath(typeof raw === "string" ? raw : undefined);
  const { rt, state } = await currentSession();
  if (state.status === "ok") redirect(next);
  return (
    <AccountShell>
      {rt ? <AccountAuthPanel initialMode="sign-in" next={next} termsHref={libraryTermsHref()} /> : <p>Accounts are not open yet. Please check back soon.</p>}
    </AccountShell>
  );
}
