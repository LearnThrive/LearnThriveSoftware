import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccountAuthPanel } from "@/components/account/AccountAuthPanel";
import { AccountShell } from "@/components/account/AccountShell";
import { currentSession } from "@/lib/account/pages";
import { createMetadata } from "@/lib/metadata";

export const metadata: Metadata = {
  ...createMetadata({ title: "Create a Library account", description: "Create a LearnThrive Library account.", path: "/account/sign-up" }),
  robots: { index: false, follow: false },
};

export default async function SignUpPage() {
  const { rt, state } = await currentSession();
  if (state.status === "ok") redirect("/account");
  return (
    <AccountShell>
      {rt ? <AccountAuthPanel initialMode="sign-up" /> : <p>Accounts are not open yet. Please check back soon.</p>}
    </AccountShell>
  );
}
