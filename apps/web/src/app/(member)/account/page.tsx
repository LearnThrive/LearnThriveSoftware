import type { Metadata } from "next";
import { SignOutButton } from "@/components/account/SignOutButton";
import { requireAccountPage } from "@/lib/account/pages";
import styles from "./account.module.css";

export const metadata: Metadata = { title: "Your account | LearnThrive", robots: { index: false, follow: false } };

export default async function AccountPage() {
  const { user, account } = await requireAccountPage("/account");
  return (
    <main id="main-content" className={styles.page}>
      <h1>Your account</h1>
      <dl className={styles.details}>
        <dt>Name</dt>
        <dd>{account.displayName || "Not set"}</dd>
        <dt>Email</dt>
        <dd>{user.email}</dd>
      </dl>
      <SignOutButton />
    </main>
  );
}
