import { StripeError, type CheckoutParams, type StripeApi, type StripeObject } from "./stripe";

/**
 * A stand-in for Stripe's API, for unit tests and for the development server when STRIPE_FAKE=1 (never in production:
 * runtime.ts refuses). It records what it was asked and answers from state a test sets. It is not a model of Stripe,
 * only enough of one to drive the checkout, portal and webhook code paths. A real Stripe test-mode run is still needed
 * (docs/BILLING.md has the steps) and cannot be done here.
 */
export class FakeStripeApi implements StripeApi {
  readonly subscriptions = new Map<string, StripeObject>();
  readonly invoices = new Map<string, StripeObject>();
  readonly invoiceByPaymentIntent = new Map<string, string>();
  readonly sessions: CheckoutParams[] = [];
  readonly portals: Array<{ customerId: string; returnUrl: string }> = [];
  /** When set, the next call of any kind rejects with it, once. */
  failNext: StripeError | null = null;
  private counter = 0;

  private maybeFail() {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
  }

  async createCheckoutSession(params: CheckoutParams) {
    this.maybeFail();
    this.sessions.push(params);
    this.counter += 1;
    const id = `cs_test_fake${this.counter}`;
    return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
  }

  async createPortalSession(customerId: string, returnUrl: string) {
    this.maybeFail();
    this.portals.push({ customerId, returnUrl });
    return { url: `https://billing.stripe.com/p/session/test_fake${this.portals.length}` };
  }

  async retrieveSubscription(id: string) {
    this.maybeFail();
    const found = this.subscriptions.get(id);
    if (!found) throw new StripeError(404, "resource_missing");
    return structuredClone(found);
  }

  async retrieveInvoice(id: string) {
    this.maybeFail();
    const found = this.invoices.get(id);
    if (!found) throw new StripeError(404, "resource_missing");
    return structuredClone(found);
  }

  async invoiceForPaymentIntent(paymentIntentId: string) {
    this.maybeFail();
    return this.invoiceByPaymentIntent.get(paymentIntentId) ?? null;
  }

  async listSubscriptions(startingAfter?: string) {
    this.maybeFail();
    const all = [...this.subscriptions.values()];
    const from = startingAfter ? all.findIndex((s) => s.id === startingAfter) + 1 : 0;
    const page = all.slice(from, from + 2);
    return { data: structuredClone(page), hasMore: from + 2 < all.length };
  }
}

/** A subscription object shaped like Stripe's, for tests and the dev route. Newer API shape: the period is on the item. */
export function fakeSubscription(input: {
  id: string;
  customer: string;
  clientId?: string;
  status?: string;
  interval?: "month" | "year";
  priceId?: string;
  periodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  endedAt?: number | null;
  canceledAt?: number | null;
}): StripeObject {
  return {
    id: input.id,
    object: "subscription",
    customer: input.customer,
    status: input.status ?? "active",
    cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    canceled_at: input.canceledAt ?? null,
    ended_at: input.endedAt ?? null,
    metadata: input.clientId ? { client_id: input.clientId } : {},
    items: {
      data: [
        {
          current_period_end: input.periodEnd ?? Math.floor(Date.now() / 1000) + 30 * 86400,
          price: { id: input.priceId ?? "price_monthlyfake", recurring: { interval: input.interval ?? "month" } },
        },
      ],
    },
  };
}
