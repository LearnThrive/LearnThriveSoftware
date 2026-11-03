import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountAuthPanel } from "@/components/account/AccountAuthPanel";
import { AccountShell } from "@/components/account/AccountShell";
import { currentSession } from "@/lib/account/pages";
import { selfServiceAccounts } from "@/lib/account/selfService";
import { libraryTermsHref } from "@/lib/billing/offer";
import { createMetadata } from "@/lib/metadata";

export const metadata: Metadata = {
  ...createMetadata({ title: "Create a Library account", description: "Create a LearnThrive Library account.", path: "/account/sign-up" }),
  robots: { index: false, follow: false },
};

export default async function SignUpPage() {
  // LearnThrive makes every account: in production there is nothing to sign up for.
  if (!selfServiceAccounts()) redirect("/login");
  const { rt, state } = await currentSession();
  if (state.status === "ok") redirect("/account");
  return (
    <AccountShell>
      {rt ? <AccountAuthPanel initialMode="sign-up" termsHref={libraryTermsHref()} /> : <p>Accounts are not open yet. Please check back soon.</p>}
    </AccountShell>
  );
}
