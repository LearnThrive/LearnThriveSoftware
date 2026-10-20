import type { BillingConfig } from "./config";

/**
 * The few Stripe API calls the site makes, over plain `fetch` (no SDK, no Stripe.js: nothing new is loaded in a
 * browser and the Content Security Policy is unchanged). Server only. The secret key never leaves this file's request
 * headers and is never logged; an error carries the HTTP status and Stripe's error code, never the body.
 *
 * Stripe stays the source of truth: the webhook handler reads subscriptions BACK from Stripe rather than trusting a
 * possibly out-of-order event payload.
 */
export type StripeObject = Record<string, unknown>;

export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Stripe request failed (${status}${code ? ` ${code}` : ""})`);
  }
}

export interface CheckoutParams {
  priceId: string;
  clientId: string;
  /** Reuse the family's Stripe customer if there is one... */
  customerId: string | null;
  /** ...otherwise let Checkout create one for this address. */
  email: string;
  successUrl: string;
  cancelUrl: string;
  consentVersion: string;
  automaticTax: boolean;
}

export interface StripeApi {
  /** Returns the hosted Checkout page's URL. */
  createCheckoutSession(params: CheckoutParams): Promise<{ id: string; url: string }>;
  /** Returns the hosted Customer Portal's URL. */
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  retrieveSubscription(id: string): Promise<StripeObject>;
  retrieveInvoice(id: string): Promise<StripeObject>;
  /** The invoice a payment intent paid, or null. Newer API versions no longer put the invoice on the charge. */
  invoiceForPaymentIntent(paymentIntentId: string): Promise<string | null>;
  /** One page of every subscription (all statuses), for the reconciliation script. */
  listSubscriptions(startingAfter?: string): Promise<{ data: StripeObject[]; hasMore: boolean }>;
}

/** Stripe takes form-encoded bodies with bracketed keys: `a[b][0][c]=v`. */
export function formEncode(params: Record<string, unknown>): string {
  const out: string[] = [];
  const walk = (prefix: string, value: unknown) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) value.forEach((item, index) => walk(`${prefix}[${index}]`, item));
    else if (typeof value === "object") for (const [key, inner] of Object.entries(value)) walk(`${prefix}[${key}]`, inner);
    else out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  };
  for (const [key, value] of Object.entries(params)) walk(key, value);
  return out.join("&");
}

export class HttpStripeApi implements StripeApi {
  private readonly doFetch: typeof fetch;
  constructor(
    private readonly config: Pick<BillingConfig, "secretKey" | "apiVersion">,
    options: { fetch?: typeof fetch; timeoutMs?: number } = {},
  ) {
    this.doFetch = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }
  private readonly timeoutMs: number;

  private async call(method: "GET" | "POST", path: string, params?: Record<string, unknown>): Promise<StripeObject> {
    const query = method === "GET" && params ? `?${formEncode(params)}` : "";
    let response: Response;
    try {
      response = await this.doFetch(`https://api.stripe.com/v1${path}${query}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          "Stripe-Version": this.config.apiVersion,
          ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(method === "POST" ? { body: formEncode(params ?? {}) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
    } catch {
      throw new StripeError(0, "network");
    }
    const body = (await response.json().catch(() => null)) as StripeObject | null;
    if (!response.ok) {
      const error = (body?.error ?? {}) as StripeObject;
      throw new StripeError(response.status, typeof error.code === "string" ? error.code : typeof error.type === "string" ? error.type : "");
    }
    if (!body) throw new StripeError(response.status, "empty");
    return body;
  }

  async createCheckoutSession(p: CheckoutParams) {
    const body = await this.call("POST", "/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": p.priceId,
      "line_items[0][quantity]": 1,
      client_reference_id: p.clientId,
      ...(p.customerId ? { customer: p.customerId } : { customer_email: p.email }),
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
      locale: "en-GB",
      allow_promotion_codes: false,
      billing_address_collection: "auto",
      "subscription_data[metadata][client_id]": p.clientId,
      "metadata[client_id]": p.clientId,
      "metadata[consent_version]": p.consentVersion,
      "automatic_tax[enabled]": p.automaticTax,
    });
    if (typeof body.id !== "string" || typeof body.url !== "string") throw new StripeError(200, "bad_session");
    return { id: body.id, url: body.url };
  }

  async createPortalSession(customerId: string, returnUrl: string) {
    const body = await this.call("POST", "/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
    if (typeof body.url !== "string") throw new StripeError(200, "bad_session");
    return { url: body.url };
  }

  retrieveSubscription(id: string) {
    return this.call("GET", `/subscriptions/${encodeURIComponent(id)}`, { "expand[0]": "items.data.price" });
  }

  retrieveInvoice(id: string) {
    return this.call("GET", `/invoices/${encodeURIComponent(id)}`);
  }

  async invoiceForPaymentIntent(paymentIntentId: string) {
    const body = await this.call("GET", "/invoice_payments", { "payment[type]": "payment_intent", "payment[payment_intent]": paymentIntentId, limit: 1 });
    const first = Array.isArray(body.data) ? (body.data[0] as StripeObject | undefined) : undefined;
    const invoice = first?.invoice;
    return typeof invoice === "string" ? invoice : typeof (invoice as StripeObject | undefined)?.id === "string" ? ((invoice as StripeObject).id as string) : null;
  }

  async listSubscriptions(startingAfter?: string) {
    const body = await this.call("GET", "/subscriptions", { status: "all", limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    return { data: Array.isArray(body.data) ? (body.data as StripeObject[]) : [], hasMore: body.has_more === true };
  }
}

/** Hosts a customer may be sent to: Stripe's hosted pages only. Anything else in a reply is not followed. */
export function hostedUrl(url: unknown, hosts: readonly string[]): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && hosts.includes(parsed.hostname) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export const CHECKOUT_HOSTS = ["checkout.stripe.com"] as const;
export const PORTAL_HOSTS = ["billing.stripe.com"] as const;
