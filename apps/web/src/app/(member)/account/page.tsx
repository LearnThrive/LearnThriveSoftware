import type { Metadata } from "next";
import Link from "next/link";
import { NameForm } from "@/components/account/NameForm";
import { BillingSection } from "@/components/account/BillingSection";
import { SignOutButton } from "@/components/account/SignOutButton";
import { requireAccountPage } from "@/lib/account/pages";
import { subscriptionOffer } from "@/lib/billing/offer";
import { libraryShows } from "@/lib/library-config";
import styles from "./account.module.css";

export const metadata: Metadata = { title: "Your account | LearnThrive", robots: { index: false, follow: false } };

const BILLING_MESSAGES: Record<string, string> = {
  already: "You already have a subscription. You can manage it here.",
  none: "There is no billing account to manage yet.",
  adult: "Subscriptions are for adult account holders.",
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { rt, user, account } = await requireAccountPage("/account");
  const raw = (await searchParams).billing;
  const message = typeof raw === "string" && Object.hasOwn(BILLING_MESSAGES, raw) ? BILLING_MESSAGES[raw] : null;
  const subscriptions = account.clientId ? await rt.store.billing.listSubscriptions(account.clientId) : [];
  const hasCustomer = account.clientId ? (await rt.store.billing.getStripeCustomerId(account.clientId)) !== null : false;
  const offer = await subscriptionOffer(rt.store);
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
      <BillingSection subscriptions={subscriptions} hasCustomer={hasCustomer} offerOpen={offer.open} now={new Date()} message={message} />
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
