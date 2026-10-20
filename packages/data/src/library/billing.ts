/**
 * Billing records and the one rule that turns a Stripe subscription into Library access (plan19 phase E).
 * Stripe is the source of truth; the database mirrors it, and `deriveEntitlement` is the only place the mirror
 * becomes an access window. Pure, so every status is covered by a table test (billing.test.ts).
 */
export const SUBSCRIPTION_STATUSES = ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type PlanInterval = "month" | "year";

/** What Stripe says about a subscription, reduced to what the mirror keeps. */
export interface SubscriptionInput {
  stripeSubscriptionId: string;
  stripePriceId: string;
  status: SubscriptionStatus;
  planInterval: PlanInterval;
  /** The end of the period already paid for. */
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  /** When Stripe ended it (status canceled). */
  endedAt: Date | null;
}

export interface SubscriptionRecord extends SubscriptionInput {
  id: string;
  clientId: string;
  /** When the mirror first saw it: the earliest an entitlement from it can start. */
  createdAt: Date;
  /** Set when a charge for it was fully refunded. A refunded subscription grants nothing. */
  refundedAt: Date | null;
}

export interface EntitlementWindow {
  startsAt: Date;
  /** null = open ended. */
  endsAt: Date | null;
}

/**
 * How long past its paid-through date an `active` or `trialing` subscription still counts, so a renewal whose
 * webhook is a few hours late does not lock a paying family out. Fails closed: if webhooks stop altogether, access
 * lapses this long after the period ends.
 */
export const ACTIVE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The access window a subscription grants, or null for none (the entitlement row is then removed).
 *
 *   active, trialing   paid-through date plus the grace above
 *   past_due           the paid-through date only: the renewal failed, the period already paid for still counts
 *   canceled           until Stripe ended it (the end of the paid period for a cancel-at-period-end; at once if
 *                      cancelled immediately), else the paid-through date
 *   everything else    none: unpaid, incomplete, incomplete_expired, paused
 *   refunded           none, whatever the status says
 *
 * A window that would end before it starts is no window.
 */
export function deriveEntitlement(
  sub: Pick<SubscriptionRecord, "status" | "currentPeriodEnd" | "endedAt" | "refundedAt" | "createdAt">,
  now: Date,
): EntitlementWindow | null {
  if (sub.refundedAt) return null;
  let endsAt: Date | null;
  switch (sub.status) {
    case "active":
    case "trialing":
      endsAt = new Date((sub.currentPeriodEnd ?? now).getTime() + ACTIVE_GRACE_MS);
      break;
    case "past_due":
      endsAt = sub.currentPeriodEnd;
      break;
    case "canceled":
      endsAt = sub.endedAt ?? sub.currentPeriodEnd;
      break;
    default:
      return null;
  }
  if (!endsAt) return null;
  // The window starts when the mirror first saw the subscription, but never after this sync (the caller's clock) and
  // never at or after its own end.
  const from = sub.createdAt.getTime() < now.getTime() ? sub.createdAt : now;
  const startsAt = from.getTime() < endsAt.getTime() ? from : new Date(endsAt.getTime() - 1);
  return { startsAt, endsAt };
}

export interface AdminGrantInput {
  clientId: string;
  reason: string;
  grantedBy?: string | null;
  startsAt?: Date;
  /** null or absent = open ended. */
  endsAt?: Date | null;
}

export interface AdminGrantRecord {
  id: string;
  clientId: string;
  reason: string;
  startsAt: Date;
  endsAt: Date | null;
  revokedAt: Date | null;
}

export type ClaimResult = "process" | "duplicate";
