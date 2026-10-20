import Link from "next/link";
import type { SubscriptionRecord } from "@learnthrive/data/library";
import styles from "./account.module.css";

/**
 * "Your plan" on the account page (plan19 phase E): what the mirror of Stripe says, in plain words, and the one button that
 * does everything else (Manage billing: change card, see invoices, cancel). Cancelling is never more than that button.
 */
const day = (date: Date | null): string => (date ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "Europe/London" }).format(date) : "");

export function describeSubscription(sub: SubscriptionRecord, now: Date): string {
  const plan = sub.planInterval === "year" ? "Yearly" : "Monthly";
  if (sub.refundedAt) return `${plan} plan. Refunded: access has ended.`;
  switch (sub.status) {
    case "active":
    case "trialing":
      return sub.cancelAtPeriodEnd
        ? `${plan} plan. Cancelled: you keep access until ${day(sub.currentPeriodEnd)}, and it will not renew.`
        : `${plan} plan. Active. Renews automatically on ${day(sub.currentPeriodEnd)}.`;
    case "past_due":
      return `${plan} plan. The latest payment failed. ${sub.currentPeriodEnd && sub.currentPeriodEnd > now ? `Your access continues until ${day(sub.currentPeriodEnd)}. ` : "Your access has paused. "}Use Manage billing to update your payment method.`;
    case "canceled":
      return `${plan} plan. Cancelled${sub.endedAt ? `: it ended on ${day(sub.endedAt)}` : ""}.`;
    default:
      return `${plan} plan. Not active.`;
  }
}

export function BillingSection({
  subscriptions,
  hasCustomer,
  offerOpen,
  now,
  message,
}: {
  subscriptions: SubscriptionRecord[];
  hasCustomer: boolean;
  offerOpen: boolean;
  now: Date;
  message: string | null;
}) {
  const latest = subscriptions[0] ?? null;
  return (
    <section className={styles.panel} aria-labelledby="plan-heading">
      <h2 id="plan-heading">Your plan</h2>
      {message ? (
        <p className={styles.error} role="status">
          {message}
        </p>
      ) : null}
      {latest ? <p>{describeSubscription(latest, now)}</p> : <p>You do not have a subscription.</p>}
      {hasCustomer ? (
        <form method="post" action="/api/billing/create-portal-session">
          <button type="submit" className="button button--secondary">
            <span>Manage billing and invoices</span>
          </button>
        </form>
      ) : null}
      {!latest && offerOpen ? (
        <p>
          <Link className="text-link" href="/pricing">
            See the plans <span aria-hidden="true">→</span>
          </Link>
        </p>
      ) : null}
      {hasCustomer ? <p className={styles.small}>Manage billing opens Stripe&rsquo;s secure page, where you can change your card, see your invoices and cancel.</p> : null}
    </section>
  );
}
