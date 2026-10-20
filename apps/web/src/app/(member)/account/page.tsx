import type { Metadata } from "next";
import Link from "next/link";
import { NameForm } from "@/components/account/NameForm";
import { SignOutButton } from "@/components/account/SignOutButton";
import { requireAccountPage } from "@/lib/account/pages";
import { libraryShows } from "@/lib/library-config";
import styles from "./account.module.css";

export const metadata: Metadata = { title: "Your account | LearnThrive", robots: { index: false, follow: false } };

export default async function AccountPage() {
  const { rt, user, account } = await requireAccountPage("/account");
  const facts = account.clientId ? await rt.store.access.facts(account.clientId) : { enrolled: false, subscription: false, adminGrant: false };
  // What this account can download, in plain words. Free samples are open to every signed-in adult account.
  const access = facts.enrolled
    ? "Included: your family is enrolled with LearnThrive."
    : facts.subscription
      ? "Included: your subscription."
      : facts.adminGrant
        ? "Included: access granted by LearnThrive."
        : "Free samples only. The Library is included for enrolled students.";

  return (
    <main id="main-content" className={styles.page}>
      <h1>Your account</h1>
      <dl className={styles.details}>
        <dt>Email</dt>
        <dd>{user.email}</dd>
        <dt>Library</dt>
        <dd>{access}</dd>
      </dl>
      <NameForm initialName={account.displayName} />
      {libraryShows().catalogue ? (
        <p>
          <Link className="text-link" href="/library">
            Browse the Library <span aria-hidden="true">→</span>
          </Link>
        </p>
      ) : null}
      <SignOutButton />
    </main>
  );
}
