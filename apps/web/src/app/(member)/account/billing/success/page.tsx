import type { Metadata } from "next";
import Link from "next/link";
import { requireAccountPage } from "@/lib/account/pages";
import styles from "../../account.module.css";

// Stripe puts the checkout session id in this address; nothing here uses it, and no Referer may carry it anywhere.
export const metadata: Metadata = { title: "Thank you | LearnThrive", referrer: "no-referrer", robots: { index: false, follow: false } };

/**
 * Where Stripe sends a customer after paying. Payment is confirmed by Stripe's webhook, not by this page, so the page asks
 * the database whether access is open yet: usually it is within seconds, and "Check again" is a plain link if it is not.
 * Nothing on this page grants anything.
 */
export default async function BillingSuccessPage() {
  const { rt, account } = await requireAccountPage("/account/billing/success");
  const facts = account.clientId ? await rt.store.access.facts(account.clientId) : null;
  const active = Boolean(facts?.subscription);
  return (
    <main id="main-content" className={styles.page}>
      <h1>Thank you</h1>
      {active ? (
        <p role="status">Your subscription is active. You can browse and download from the Library now.</p>
      ) : (
        <p role="status">We have your payment and are confirming it with Stripe. This usually takes a few seconds.</p>
      )}
      <p>
        {active ? (
          <Link className="button button--primary" href="/library">
            <span>Go to the Library</span>
          </Link>
        ) : (
          <Link className="button button--secondary" href="/account/billing/success">
            <span>Check again</span>
          </Link>
        )}{" "}
        <Link className="text-link" href="/account">
          Your account
        </Link>
      </p>
      <p className={styles.small}>A receipt will arrive by email. You can cancel any time from your account (Manage billing).</p>
    </main>
  );
}
