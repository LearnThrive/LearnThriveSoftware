import { SUBSCRIPTION_STATUSES, type PlanInterval, type SubscriptionInput, type SubscriptionStatus } from "@learnthrive/data/library";
import type { StripeObject } from "./stripe";

/**
 * Stripe's subscription and invoice objects, read defensively into what the mirror keeps. Stripe moved a few fields
 * between API versions (the period end now lives on the subscription ITEM in recent versions, on the subscription
 * in older ones; an invoice's subscription moved under `parent`), so each is read from either place. Anything
 * missing or odd gives null: the caller refuses to mirror what it cannot read, rather than guess.
 */
const obj = (value: unknown): StripeObject | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as StripeObject) : null);
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const secondsToDate = (value: unknown): Date | null => (typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null);

/** An id that may arrive as a string or as an expanded object with an `id`. */
export function idOf(value: unknown): string | null {
  return str(value) ?? str(obj(value)?.id);
}

export function toSubscriptionInput(sub: StripeObject): SubscriptionInput | null {
  const id = str(sub.id);
  const status = str(sub.status);
  const item = obj((Array.isArray(obj(sub.items)?.data) ? (obj(sub.items)!.data as unknown[]) : [])[0]);
  const price = obj(item?.price) ?? obj(sub.plan);
  const priceId = str(price?.id);
  const interval = str(obj(price?.recurring)?.interval) ?? str(price?.interval);
  if (!id || !status || !priceId || !(SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) return null;
  if (interval !== "month" && interval !== "year") return null;
  return {
    stripeSubscriptionId: id,
    stripePriceId: priceId,
    status: status as SubscriptionStatus,
    planInterval: interval as PlanInterval,
    currentPeriodEnd: secondsToDate(item?.current_period_end) ?? secondsToDate(sub.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    canceledAt: secondsToDate(sub.canceled_at),
    endedAt: secondsToDate(sub.ended_at),
  };
}

export function customerOf(sub: StripeObject): string | null {
  return idOf(sub.customer);
}

/** The client id this site put in the subscription's metadata at checkout (a hint; the customer link wins). */
export function clientHint(sub: StripeObject): string | null {
  const hint = str(obj(sub.metadata)?.client_id);
  return hint && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hint) ? hint.toLowerCase() : null;
}

/** An invoice's subscription: `subscription` in older API versions, `parent.subscription_details.subscription` in newer. */
export function subscriptionOfInvoice(invoice: StripeObject): string | null {
  return idOf(invoice.subscription) ?? idOf(obj(obj(invoice.parent)?.subscription_details)?.subscription);
}
