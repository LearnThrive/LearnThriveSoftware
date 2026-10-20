import type { LibraryStore, SubscriptionRecord } from "@learnthrive/data/library";
import { cancellationEmail, paymentFailedEmail, receiptEmail, renewalReminderEmail, welcomeEmail, type BuiltEmail } from "./emails";
import { clientHint, customerOf, idOf, subscriptionOfInvoice, toSubscriptionInput } from "./mapper";
import type { StripeApi, StripeObject } from "./stripe";

/**
 * What each Stripe event does (plan19 phase E). Stripe is the source of truth and webhooks can arrive late, twice or out of
 * order, so the rule is: an event says WHICH subscription changed, and the subscription's current state is then read
 * back from Stripe and mirrored. A stale payload can therefore never overwrite newer state. Every handler is safe to run
 * again (the mirror upserts; the entitlement is recomputed), and `claimEvent` in the route makes the side effects
 * (emails) happen once per event.
 *
 *   checkout.session.completed      link the customer to the family account, mirror the subscription, welcome email
 *   customer.subscription.created/updated/deleted   mirror; cancellation email when it is newly cancelled or ended
 *   invoice.paid                    mirror; receipt email (a link to Stripe's hosted invoice)
 *   invoice.payment_failed          mirror (status becomes past_due); payment-failed email
 *   invoice.upcoming                renewal reminder email
 *   charge.refunded                 a FULL refund ends access at once (the invoice leads to the subscription)
 *   anything else                   ignored
 */
export interface Mailer {
  /** Returns whether it was sent. Never throws. */
  send(to: string, mail: BuiltEmail): Promise<boolean>;
}

export interface EventDeps {
  store: LibraryStore;
  stripe: StripeApi;
  mailer: Mailer;
  now: () => Date;
}

/** An event that can never be handled (an unknown account, a customer that belongs to someone else). Not retried. */
export class PermanentEventError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export type EventOutcome = "ignored" | "mirrored" | "refunded" | "reminded" | "unresolved_client";

const obj = (value: unknown): StripeObject | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as StripeObject) : null);
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveClient(deps: EventDeps, customerId: string | null, hint: string | null): Promise<string | null> {
  if (customerId) {
    const linked = await deps.store.billing.getClientByStripeCustomer(customerId);
    if (linked) return linked;
  }
  if (hint && UUID.test(hint) && (await deps.store.accounts.getOwnerProfileId(hint))) {
    // The subscription event can arrive before the checkout event: link the customer now.
    if (customerId) await link(deps, hint, customerId);
    return hint;
  }
  return null;
}

async function link(deps: EventDeps, clientId: string, customerId: string): Promise<void> {
  try {
    await deps.store.billing.linkCustomer(clientId, customerId);
  } catch {
    throw new PermanentEventError("customer_conflict");
  }
}

/** Reads the subscription back from Stripe and mirrors it, with its entitlement. */
async function sync(deps: EventDeps, subscriptionId: string, clientHint_: string | null): Promise<SubscriptionRecord | null> {
  const raw = await deps.stripe.retrieveSubscription(subscriptionId);
  const input = toSubscriptionInput(raw);
  if (!input) throw new PermanentEventError("unreadable_subscription");
  const clientId = await resolveClient(deps, customerOf(raw), clientHint_ ?? clientHint(raw));
  if (!clientId) return null;
  let record: SubscriptionRecord;
  try {
    record = await deps.store.billing.upsertSubscription(clientId, input);
  } catch {
    throw new PermanentEventError("subscription_conflict");
  }
  await deps.store.billing.syncEntitlement(record, deps.now());
  return record;
}

async function emailFor(deps: EventDeps, clientId: string): Promise<string | null> {
  const owner = await deps.store.accounts.getOwnerProfileId(clientId);
  return owner ? deps.store.accounts.getEmail(owner) : null;
}

async function tell(deps: EventDeps, clientId: string, mail: BuiltEmail): Promise<void> {
  const to = await emailFor(deps, clientId);
  if (to) await deps.mailer.send(to, mail);
}

export async function processStripeEvent(event: StripeObject, deps: EventDeps): Promise<EventOutcome> {
  const type = str(event.type) ?? "";
  const object = obj(obj(event.data)?.object);
  if (!object) return "ignored";

  switch (type) {
    case "checkout.session.completed": {
      if (object.mode !== "subscription") return "ignored";
      const clientId = str(object.client_reference_id);
      if (!clientId || !UUID.test(clientId) || !(await deps.store.accounts.getOwnerProfileId(clientId))) throw new PermanentEventError("unknown_client");
      const customerId = idOf(object.customer);
      if (customerId) await link(deps, clientId, customerId);
      const subscriptionId = idOf(object.subscription);
      if (!subscriptionId) throw new PermanentEventError("no_subscription");
      const record = await sync(deps, subscriptionId, clientId);
      if (record) await tell(deps, clientId, welcomeEmail({ interval: record.planInterval, nextDate: record.currentPeriodEnd }));
      return "mirrored";
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const id = str(object.id);
      if (!id) return "ignored";
      const record = await sync(deps, id, null);
      if (!record) return "unresolved_client";
      const previous = obj(obj(event.data)?.previous_attributes);
      const newlyCancelling = type === "customer.subscription.updated" && object.cancel_at_period_end === true && previous?.cancel_at_period_end === false;
      if (type === "customer.subscription.deleted") await tell(deps, record.clientId, cancellationEmail({ accessUntil: null, endedNow: true }));
      else if (newlyCancelling) await tell(deps, record.clientId, cancellationEmail({ accessUntil: record.currentPeriodEnd, endedNow: false }));
      return "mirrored";
    }

    case "invoice.paid":
    case "invoice.payment_failed": {
      const subscriptionId = subscriptionOfInvoice(object);
      if (!subscriptionId) return "ignored";
      const record = await sync(deps, subscriptionId, null);
      if (!record) return "unresolved_client";
      if (type === "invoice.payment_failed") await tell(deps, record.clientId, paymentFailedEmail());
      else if (typeof object.amount_paid === "number" && object.amount_paid > 0) {
        const url = str(object.hosted_invoice_url);
        await tell(deps, record.clientId, receiptEmail({ amountPaid: object.amount_paid, currency: object.currency, hostedInvoiceUrl: url && url.startsWith("https://") ? url : null }));
      }
      return "mirrored";
    }

    case "invoice.upcoming": {
      const subscriptionId = subscriptionOfInvoice(object);
      if (!subscriptionId) return "ignored";
      const record = await deps.store.billing.getSubscriptionByStripeId(subscriptionId);
      if (!record) return "unresolved_client";
      const next = typeof object.next_payment_attempt === "number" ? new Date(object.next_payment_attempt * 1000) : record.currentPeriodEnd;
      await tell(deps, record.clientId, renewalReminderEmail({ amountDue: object.amount_due, currency: object.currency, renewsOn: next }));
      return "reminded";
    }

    case "charge.refunded": {
      // Only a FULL refund ends access; a partial one is a goodwill gesture and changes nothing.
      if (object.refunded !== true) return "ignored";
      let invoiceId = idOf(object.invoice);
      const paymentIntent = idOf(object.payment_intent);
      if (!invoiceId && paymentIntent) invoiceId = await deps.stripe.invoiceForPaymentIntent(paymentIntent);
      if (!invoiceId) return "ignored";
      const subscriptionId = subscriptionOfInvoice(await deps.stripe.retrieveInvoice(invoiceId));
      if (!subscriptionId) return "ignored";
      const record = await deps.store.billing.getSubscriptionByStripeId(subscriptionId);
      if (!record) return "unresolved_client";
      await deps.store.billing.markRefunded(subscriptionId, deps.now());
      await deps.store.billing.syncEntitlement(record, deps.now());
      return "refunded";
    }

    default:
      return "ignored";
  }
}
