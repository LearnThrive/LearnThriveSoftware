import { renewSession, type CookieJar } from "@/lib/account/session";
import type { AccountRuntime } from "@/lib/account/runtime";
import { inSupervisedView } from "@/lib/learner/resolve";
import { libraryPhase } from "@/lib/library-config";
import { SlidingWindowLimiter, clientAddress } from "@/lib/rate-limit";
import { jsonResponse, logOutcome, originAllowed, readBodyLimited } from "@/lib/request-guards";
import { siteConfig } from "@/lib/site";
import { checkoutConfigured, contentReady, stripeConfig } from "./config";
import { consentHash } from "./consent";
import { CONSENT_KIND, CONSENT_VERSION } from "./consumer";
import { PermanentEventError, processStripeEvent, type Mailer } from "./events";
import { verifyStripeSignature } from "./signature";
import { CHECKOUT_HOSTS, hostedUrl, PORTAL_HOSTS, StripeError, type StripeApi, type StripeObject } from "./stripe";

/**
 * The billing routes' logic (plan19 phase E), with everything passed in so tests drive it without Next or Stripe.
 *
 *   POST /api/billing/create-checkout   a signed-in adult, the unticked-by-default acknowledgement ticked, a plan: a
 *                                       hosted Stripe Checkout session, then a redirect to Stripe's own page
 *   POST /api/billing/create-portal-session   the hosted Customer Portal (cancel, payment method, invoices)
 *   POST /api/billing/webhook           Stripe's events: signature checked, each event handled once
 *
 * Checkout fails CLOSED (config.ts): not the live phase, no Stripe settings, no VAT decision or no content threshold, and
 * it is not offered. No card detail ever touches this site: the customer is sent to Stripe's page.
 */
const FALLBACK = `Please email ${siteConfig.email} and we will help.`;

export const billingRateLimits = {
  checkout: { perClient: { max: 10, windowMs: 15 * 60 * 1000 }, global: { max: 300, windowMs: 15 * 60 * 1000 } },
  portal: { perClient: { max: 20, windowMs: 15 * 60 * 1000 }, global: { max: 600, windowMs: 15 * 60 * 1000 } },
} as const;

const limiters = {
  checkout: new SlidingWindowLimiter(billingRateLimits.checkout.perClient, billingRateLimits.checkout.global),
  portal: new SlidingWindowLimiter(billingRateLimits.portal.perClient, billingRateLimits.portal.global),
};

/** For tests. */
export function resetBillingLimiters(): void {
  for (const limiter of Object.values(limiters)) limiter.reset();
}

export interface BillingDeps {
  rt: AccountRuntime | null;
  jar: CookieJar;
  stripe: StripeApi | null;
  mailer: Mailer;
  env?: Record<string, string | undefined>;
  now?: () => Date;
}

type Reason = "signed_out" | "unavailable" | "acknowledge" | "already" | "failed" | "rate_limited" | "bad_request" | "adult_required" | "no_customer" | "catalogue_not_ready";

const STATUS: Record<Reason, number> = { signed_out: 401, unavailable: 503, acknowledge: 422, already: 409, failed: 502, rate_limited: 429, bad_request: 400, adult_required: 403, no_customer: 404, catalogue_not_ready: 503 };

const MESSAGE: Record<Reason, string> = {
  signed_out: "Please sign in to subscribe.",
  unavailable: `Subscriptions are not available right now. ${FALLBACK}`,
  acknowledge: "Please tick the box to confirm you understand before you continue.",
  already: "You already have a subscription. You can manage it from your account.",
  failed: `We could not start checkout just now. Please try again shortly. ${FALLBACK}`,
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  bad_request: "We could not read that request.",
  adult_required: "Subscriptions are for adult account holders.",
  no_customer: "There is no billing account to manage yet.",
  catalogue_not_ready: `Subscriptions are not available right now. ${FALLBACK}`,
};

const BACK: Record<Reason, string> = {
  signed_out: "/login?next=%2Fpricing",
  unavailable: "/pricing?checkout=unavailable",
  acknowledge: "/pricing?checkout=acknowledge",
  already: "/account?billing=already",
  failed: "/pricing?checkout=failed",
  rate_limited: "/pricing?checkout=wait",
  bad_request: "/pricing?checkout=unavailable",
  adult_required: "/account?billing=adult",
  no_customer: "/account?billing=none",
  catalogue_not_ready: "/pricing?checkout=unavailable",
};

const wantsPage = (request: Request) => (request.headers.get("accept") ?? "").includes("text/html");

function refuse(request: Request, event: string, reason: Reason, extra: Record<string, string> = {}): Response {
  logOutcome(event, reason);
  if (wantsPage(request)) return new Response(null, { status: 303, headers: { Location: BACK[reason], "Cache-Control": "no-store", ...extra } });
  return jsonResponse(STATUS[reason], { code: reason, error: MESSAGE[reason] }, { "Cache-Control": "no-store", ...extra });
}

function redirectTo(request: Request, url: string): Response {
  if (wantsPage(request)) return new Response(null, { status: 303, headers: { Location: url, "Cache-Control": "no-store" } });
  return jsonResponse(200, { url }, { "Cache-Control": "no-store" });
}

/** The site's own base address, for the URLs Stripe sends people back to. */
export function siteBase(env: Record<string, string | undefined>): string {
  return (env.NEXT_PUBLIC_SITE_URL?.trim() || siteConfig.url).replace(/\/+$/, "");
}

async function readForm(request: Request): Promise<Record<string, string> | null> {
  const body = await readBodyLimited(request, 4096);
  if (!body.ok) return null;
  const text = new TextDecoder().decode(body.bytes);
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const raw = JSON.parse(text) as unknown;
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
      return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === "string" || typeof v === "boolean").map(([k, v]) => [k, String(v)]));
    }
    return Object.fromEntries(new URLSearchParams(text));
  } catch {
    return null;
  }
}

export async function handleCheckout(request: Request, deps: BillingDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  const event = "billing-checkout";
  if (!originAllowed(request, env)) {
    logOutcome(event, "forbidden_origin");
    return jsonResponse(403, { error: "Forbidden." });
  }
  const available = checkoutConfigured(libraryPhase(env), env);
  if (!available.ok || !deps.rt || !deps.stripe) {
    logOutcome(event, "not_configured", { reason: available.ok ? (deps.rt ? "no-stripe" : "no-backend") : available.reason });
    return refuse(request, event, "unavailable");
  }
  if (!limiters.checkout.allow(clientAddress(request.headers, env))) return refuse(request, event, "rate_limited");
  const rt = deps.rt;
  const now = (deps.now ?? (() => new Date()))();

  const session = await renewSession(deps.jar, rt);
  if (session.status !== "ok") return refuse(request, event, "signed_out");
  const account = await rt.store.accounts.getAccount(session.user.id);
  if (!account) return refuse(request, event, "signed_out");
  if (!account.adultConfirmed) return refuse(request, event, "adult_required");
  // Paying is an adult operation: not from inside a supervised learner view (the guardian leaves it with their password first).
  if (await inSupervisedView(rt, deps.jar, account.profileId)) return refuse(request, event, "adult_required");

  const form = await readForm(request);
  if (!form) return refuse(request, event, "bad_request");
  const priceId = form.plan === "monthly" ? available.config.prices.month : form.plan === "annual" ? available.config.prices.year : null;
  if (!priceId) return refuse(request, event, "bad_request");
  if (form.acknowledged !== "yes" && form.acknowledged !== "true") return refuse(request, event, "acknowledge");

  // The content gate: paid sign-up opens only once every required subject has its agreed minimum.
  const counts = (await rt.store.resources.facets(now)).subjects;
  if (!contentReady(available.gate, counts).ok) return refuse(request, event, "catalogue_not_ready");

  const clientId = account.clientId ?? (await rt.store.accounts.ensureClient(account.profileId));
  const facts = await rt.store.access.facts(clientId, now);
  if (facts.subscription) return refuse(request, event, "already");
  const live = (await rt.store.billing.listSubscriptions(clientId)).some((s) => s.refundedAt === null && ["active", "trialing", "past_due"].includes(s.status));
  if (live) return refuse(request, event, "already");

  // Evidence of the express consent: who, which wording (version and hash), when.
  await rt.store.billing.recordConsent({ profileId: account.profileId, kind: CONSENT_KIND, version: CONSENT_VERSION, textSha256: consentHash(), at: now });

  const base = siteBase(env);
  let created: { id: string; url: string };
  try {
    created = await deps.stripe.createCheckoutSession({
      priceId,
      clientId,
      customerId: await rt.store.billing.getStripeCustomerId(clientId),
      email: session.user.email,
      successUrl: `${base}/account/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/pricing?checkout=cancelled`,
      consentVersion: CONSENT_VERSION,
      automaticTax: available.config.automaticTax,
    });
  } catch (error) {
    logOutcome(event, "stripe_error", { code: error instanceof StripeError ? error.code || String(error.status) : "unknown" });
    return refuse(request, event, "failed");
  }
  const url = hostedUrl(created.url, CHECKOUT_HOSTS);
  if (!url) {
    logOutcome(event, "bad_session_url");
    return refuse(request, event, "failed");
  }
  logOutcome(event, "created", { plan: form.plan });
  return redirectTo(request, url);
}

export async function handlePortal(request: Request, deps: BillingDeps): Promise<Response> {
  const env = deps.env ?? process.env;
  const event = "billing-portal";
  if (!originAllowed(request, env)) {
    logOutcome(event, "forbidden_origin");
    return jsonResponse(403, { error: "Forbidden." });
  }
  if (!deps.rt || !deps.stripe) return refuse(request, event, "unavailable");
  if (!limiters.portal.allow(clientAddress(request.headers, env))) return refuse(request, event, "rate_limited");
  const rt = deps.rt;
  const session = await renewSession(deps.jar, rt);
  if (session.status !== "ok") return refuse(request, event, "signed_out");
  const account = await rt.store.accounts.getAccount(session.user.id);
  if (!account?.clientId) return refuse(request, event, "no_customer");
  if (await inSupervisedView(rt, deps.jar, account.profileId)) return refuse(request, event, "adult_required");
  const customerId = await rt.store.billing.getStripeCustomerId(account.clientId);
  if (!customerId) return refuse(request, event, "no_customer");
  let created: { url: string };
  try {
    created = await deps.stripe.createPortalSession(customerId, `${siteBase(env)}/account`);
  } catch (error) {
    logOutcome(event, "stripe_error", { code: error instanceof StripeError ? error.code || String(error.status) : "unknown" });
    return refuse(request, event, "failed");
  }
  const url = hostedUrl(created.url, PORTAL_HOSTS);
  if (!url) return refuse(request, event, "failed");
  logOutcome(event, "created");
  return redirectTo(request, url);
}

const WEBHOOK_MAX_BYTES = 1024 * 1024;

/**
 * Stripe's webhook. No cookie and no Origin: the signature over the raw body is the authentication. 400 for a bad
 * signature or a body that is not an event, 200 for an event handled, ignored or already handled, 500 for a failure
 * that is worth Stripe trying again (its retries are why every step is repeat-safe).
 */
export async function handleWebhook(request: Request, deps: Pick<BillingDeps, "rt" | "stripe" | "mailer" | "env" | "now">): Promise<Response> {
  const env = deps.env ?? process.env;
  const event = "billing-webhook";
  const config = stripeConfig(env);
  if (!deps.rt || !deps.stripe || !config) {
    logOutcome(event, "unavailable");
    return jsonResponse(503, { error: "Not available." });
  }
  const body = await readBodyLimited(request, WEBHOOK_MAX_BYTES);
  if (!body.ok) return jsonResponse(body.reason === "too-large" ? 413 : 400, { error: "Bad request." });
  const payload = new TextDecoder().decode(body.bytes);
  const now = (deps.now ?? (() => new Date()))();
  const verified = verifyStripeSignature(payload, request.headers.get("stripe-signature"), config.webhookSecrets, Math.floor(now.getTime() / 1000));
  if (!verified.ok) {
    logOutcome(event, "bad_signature", { reason: verified.reason });
    return jsonResponse(400, { error: "Invalid signature." });
  }
  let parsed: StripeObject;
  try {
    const raw = JSON.parse(payload) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("not an object");
    parsed = raw as StripeObject;
  } catch {
    return jsonResponse(400, { error: "Bad request." });
  }
  const id = typeof parsed.id === "string" ? parsed.id : "";
  const type = typeof parsed.type === "string" ? parsed.type : "";
  if (!/^evt_[A-Za-z0-9_]+$/.test(id) || !type || type.length > 100) return jsonResponse(400, { error: "Bad request." });
  const livemode = parsed.livemode === true;
  if (livemode !== (config.mode === "live")) {
    // A test event sent to a live endpoint (or the reverse) is a misconfiguration, not something to act on.
    logOutcome(event, "mode_mismatch");
    return jsonResponse(400, { error: "Wrong mode." });
  }

  const store = deps.rt.store;
  if ((await store.billing.claimEvent(id, type, livemode, now)) === "duplicate") {
    logOutcome(event, "duplicate", { type });
    return jsonResponse(200, { received: true, duplicate: true });
  }
  try {
    const outcome = await processStripeEvent(parsed, { store, stripe: deps.stripe, mailer: deps.mailer, now: () => now });
    await store.billing.completeEvent(id, now);
    logOutcome(event, outcome, { type });
    return jsonResponse(200, { received: true });
  } catch (error) {
    if (error instanceof PermanentEventError) {
      // Never going to succeed: record it, answer 200 so Stripe stops retrying, and leave the log line for a person.
      await store.billing.failEvent(id, error.code);
      await store.billing.completeEvent(id, now);
      logOutcome(event, "permanent_failure", { type, code: error.code });
      return jsonResponse(200, { received: true });
    }
    const code = error instanceof StripeError ? `stripe_${error.status}` : "error";
    await store.billing.failEvent(id, code);
    logOutcome(event, "failed", { type, code });
    return jsonResponse(500, { error: "Try again." });
  }
}

