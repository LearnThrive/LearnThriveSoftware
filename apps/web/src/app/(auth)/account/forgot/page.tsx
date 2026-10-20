import type { Metadata } from "next";
import { AccountAuthPanel } from "@/components/account/AccountAuthPanel";
import { AccountShell } from "@/components/account/AccountShell";
import { currentSession } from "@/lib/account/pages";
import { createMetadata } from "@/lib/metadata";

export const metadata: Metadata = {
  ...createMetadata({ title: "Reset your password", description: "Reset your LearnThrive Library password.", path: "/account/forgot" }),
  robots: { index: false, follow: false },
};

export default async function ForgotPage() {
  const { rt } = await currentSession();
  return (
    <AccountShell>
      {rt ? <AccountAuthPanel initialMode="reset" /> : <p>Accounts are not open yet. Please check back soon.</p>}
    </AccountShell>
  );
}
