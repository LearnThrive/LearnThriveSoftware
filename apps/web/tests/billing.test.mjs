import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment, jsonRequest, quiet } from "./_routeHelpers.mjs";

// Phase E: configuration, the webhook signature, Stripe requests, the mapping, every event, the emails, and the three routes.

const cfg = loadTsFrom(import.meta.url, "../src/lib/billing/config.ts");
const sig = loadTsFrom(import.meta.url, "../src/lib/billing/signature.ts");
const stripe = loadTsFrom(import.meta.url, "../src/lib/billing/stripe.ts");
const fake = loadTsFrom(import.meta.url, "../src/lib/billing/devStripe.ts");
const map = loadTsFrom(import.meta.url, "../src/lib/billing/mapper.ts");
const mail = loadTsFrom(import.meta.url, "../src/lib/billing/emails.ts");
const events = loadTsFrom(import.meta.url, "../src/lib/billing/events.ts");
const consumer = loadTsFrom(import.meta.url, "../src/lib/billing/consumer.ts");
const { consentHash } = loadTsFrom(import.meta.url, "../src/lib/billing/consent.ts");
const h = loadTsFrom(import.meta.url, "../src/lib/billing/handlers.ts");
const session = loadTsFrom(import.meta.url, "../src/lib/account/session.ts");
const { MemoryAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/memoryAuth.ts");
const { SignInLockout } = loadTsFrom(import.meta.url, "../src/lib/account/lockout.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

const SECRET = "whsec_testsecret0123456789abcdef";
const KEY = "sk_test_abcdefghijklmnop";
const ENV = {
  STRIPE_SECRET_KEY: KEY,
  STRIPE_WEBHOOK_SECRET: SECRET,
  STRIPE_PRICE_MONTHLY: "price_monthly123",
  STRIPE_PRICE_ANNUAL: "price_annual123",
  LIBRARY_VAT_STATUS: "not_registered",
  LIBRARY_MIN_PER_SUBJECT: "1",
  LIBRARY_REQUIRED_SUBJECTS: "Maths",
  LIBRARY_TERMS_APPROVED: "true",
  LIBRARY_PHASE: "live",
};
const GOOD = "correct horse battery staple";
const DAY = 86_400_000;
const NOW = new Date("2026-10-20T12:00:00Z");
const sec = (ms) => Math.floor(ms / 1000);

// ---- configuration ---------------------------------------------------------------------------------------------

test("stripeConfig: every setting is checked and a missing or mis-typed one closes billing", () => {
  const ok = cfg.stripeConfig(ENV);
  assert.equal(ok.mode, "test");
  assert.deepEqual(ok.prices, { month: "price_monthly123", year: "price_annual123" });
  assert.equal(ok.apiVersion, cfg.DEFAULT_STRIPE_API_VERSION);
  assert.equal(cfg.stripeConfig({ ...ENV, STRIPE_SECRET_KEY: "sk_live_abcdefghijklmnop" }).mode, "live");
  assert.equal(cfg.stripeConfig({ ...ENV, STRIPE_SECRET_KEY: "rk_test_abcdefghijklmnop" }).mode, "test", "a restricted key works");
  for (const bad of [{ STRIPE_SECRET_KEY: "" }, { STRIPE_SECRET_KEY: "pk_test_abcdefghijklmnop" }, { STRIPE_SECRET_KEY: "sk_test_short" }, { STRIPE_WEBHOOK_SECRET: "" }, { STRIPE_WEBHOOK_SECRET: "nope" }, { STRIPE_WEBHOOK_SECRET: `${SECRET},nope` }]) {
    assert.equal(cfg.stripeConfig({ ...ENV, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(cfg.stripeConfig({ ...ENV, STRIPE_PRICE_MONTHLY: "9.99" }).prices.month, null, "a price must be a price id, never an amount");
  assert.deepEqual(cfg.stripeConfig({ ...ENV, STRIPE_WEBHOOK_SECRET: `${SECRET}, whsec_second0123456789abc` }).webhookSecrets.length, 2);
  assert.equal(cfg.stripeConfig({ ...ENV, STRIPE_AUTOMATIC_TAX: "true" }).automaticTax, true);
  assert.equal(cfg.stripeConfig({ ...ENV, STRIPE_AUTOMATIC_TAX: "yes" }).automaticTax, false);
});

test("checkoutConfigured: live phase, Stripe, a price, a VAT decision and a content gate, and the first missing piece is named", () => {
  const ok = cfg.checkoutConfigured("live", ENV);
  assert.equal(ok.ok, true);
  assert.equal(ok.vat, "not_registered");
  assert.deepEqual(ok.gate, { minPerSubject: 1, subjects: ["Maths"] });
  for (const phase of ["info", "enrolled", ""]) assert.deepEqual(cfg.checkoutConfigured(phase, ENV), { ok: false, reason: "phase" });
  assert.equal(cfg.checkoutConfigured("live", { ...ENV, STRIPE_SECRET_KEY: undefined }).reason, "stripe");
  assert.equal(cfg.checkoutConfigured("live", { ...ENV, STRIPE_PRICE_MONTHLY: undefined, STRIPE_PRICE_ANNUAL: undefined }).reason, "price");
  assert.equal(cfg.checkoutConfigured("live", { ...ENV, LIBRARY_VAT_STATUS: undefined }).reason, "vat", "no VAT decision is no checkout");
  assert.equal(cfg.checkoutConfigured("live", { ...ENV, LIBRARY_VAT_STATUS: "maybe" }).reason, "vat");
  assert.equal(cfg.checkoutConfigured("live", { ...ENV, LIBRARY_MIN_PER_SUBJECT: "0" }).reason, "gate");
  assert.equal(cfg.checkoutConfigured("live", { ...ENV, LIBRARY_REQUIRED_SUBJECTS: "" }).reason, "gate");
  assert.equal(cfg.checkoutConfigured("live", { ...ENV, LIBRARY_TERMS_APPROVED: undefined }).reason, "legal", "terms not approved is no checkout");
  assert.equal(cfg.checkoutConfigured("live", { ...ENV, LIBRARY_TERMS_APPROVED: "yes" }).reason, "legal");
  assert.equal(cfg.checkoutConfigured("live", { ...ENV, LIBRARY_VAT_STATUS: " Registered " }).vat, "registered");
});

test("contentReady: every required subject needs its minimum", () => {
  const gate = { minPerSubject: 2, subjects: ["Maths", "English"] };
  assert.equal(cfg.contentReady(gate, [{ value: "Maths", count: 5 }, { value: "English", count: 2 }]).ok, true);
  const short = cfg.contentReady(gate, [{ value: "Maths", count: 5 }, { value: "English", count: 1 }, { value: "Science", count: 99 }]);
  assert.equal(short.ok, false);
  assert.deepEqual(short.short, [{ subject: "English", have: 1, need: 2 }]);
  assert.deepEqual(cfg.contentReady(gate, []).short.map((s) => s.have), [0, 0]);
  assert.equal(cfg.contentReady({ minPerSubject: null, subjects: ["Maths"] }, [{ value: "Maths", count: 9 }]).ok, false);
  assert.equal(cfg.contentReady({ minPerSubject: 1, subjects: [] }, [{ value: "Maths", count: 9 }]).ok, false);
});

// ---- the signature ---------------------------------------------------------------------------------------------

const header = (payload, secret = SECRET, ts = sec(NOW.getTime())) => `t=${ts},v1=${sig.signPayload(payload, secret, ts)}`;

test("signature: valid, tampered, wrong secret, stale, malformed, missing, and secret rotation", () => {
  const body = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
  const now = sec(NOW.getTime());
  assert.deepEqual(sig.verifyStripeSignature(body, header(body), [SECRET], now), { ok: true });
  assert.equal(sig.verifyStripeSignature(`${body} `, header(body), [SECRET], now).reason, "mismatch", "a changed body");
  assert.equal(sig.verifyStripeSignature(body, header(body, "whsec_other0123456789abcdef"), [SECRET], now).reason, "mismatch");
  assert.equal(sig.verifyStripeSignature(body, header(body, SECRET, now - 301), [SECRET], now).reason, "stale");
  assert.equal(sig.verifyStripeSignature(body, header(body, SECRET, now + 301), [SECRET], now).reason, "stale");
  assert.deepEqual(sig.verifyStripeSignature(body, header(body, SECRET, now - 299), [SECRET], now), { ok: true });
  assert.equal(sig.verifyStripeSignature(body, null, [SECRET], now).reason, "missing");
  for (const bad of ["", "garbage", "t=abc,v1=00", `t=${now}`, `t=${now},v1=zz`, `v1=${"a".repeat(64)}`, `t=${now},v1`]) assert.equal(sig.verifyStripeSignature(body, bad, [SECRET], now).ok, false, bad);
  const second = "whsec_second0123456789abcdef";
  assert.deepEqual(sig.verifyStripeSignature(body, header(body, second), [SECRET, second], now), { ok: true }, "either secret while rotating");
  const both = `${header(body, SECRET)},v1=${sig.signPayload(body, second, now)}`;
  assert.deepEqual(sig.verifyStripeSignature(body, both, [second], now), { ok: true }, "several v1 values in one header");
  assert.equal(sig.verifyStripeSignature(body, header(body), [], now).ok, false, "no secret configured: nothing verifies");
});

// ---- Stripe requests -------------------------------------------------------------------------------------------

test("formEncode: nested keys, arrays, and no undefined", () => {
  assert.equal(stripe.formEncode({ a: 1, b: { c: "x y", d: [1, 2] }, e: undefined, f: null, g: false }), "a=1&b%5Bc%5D=x%20y&b%5Bd%5D%5B0%5D=1&b%5Bd%5D%5B1%5D=2&g=false");
});

test("HttpStripeApi: request shapes, the key only in the header, error codes without the body", async () => {
  const calls = [];
  const reply = (status, body) => async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status });
  };
  const api = (fetch) => new stripe.HttpStripeApi({ secretKey: KEY, apiVersion: "2025-09-30.clover" }, { fetch, timeoutMs: 500 });
  const session = await api(reply(200, { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" })).createCheckoutSession({
    priceId: "price_monthly123", clientId: "11111111-1111-4111-8111-111111111111", customerId: null, email: "p@example.com",
    successUrl: "https://x.test/ok?session_id={CHECKOUT_SESSION_ID}", cancelUrl: "https://x.test/no", consentVersion: "v1", automaticTax: false,
  });
  assert.equal(session.url, "https://checkout.stripe.com/c/pay/cs_test_1");
  const call = calls[0];
  assert.equal(call.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(call.init.headers["Stripe-Version"], "2025-09-30.clover");
  assert.equal(call.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  const body = new URLSearchParams(call.init.body);
  assert.equal(body.get("mode"), "subscription");
  assert.equal(body.get("line_items[0][price]"), "price_monthly123");
  assert.equal(body.get("line_items[0][quantity]"), "1");
  assert.equal(body.get("client_reference_id"), "11111111-1111-4111-8111-111111111111");
  assert.equal(body.get("customer_email"), "p@example.com");
  assert.equal(body.get("customer"), null, "an address only when there is no customer yet");
  assert.equal(body.get("subscription_data[metadata][client_id]"), "11111111-1111-4111-8111-111111111111");
  assert.equal(body.get("allow_promotion_codes"), "false", "no discounts");
  assert.equal(body.get("success_url"), "https://x.test/ok?session_id={CHECKOUT_SESSION_ID}");
  assert.equal(body.get("automatic_tax[enabled]"), "false");
  assert.ok(!call.init.body.includes(KEY), "the key is never in the body");

  await api(reply(200, { id: "cs_test_2", url: "https://checkout.stripe.com/x" })).createCheckoutSession({ priceId: "price_a1", clientId: "c", customerId: "cus_ABC123", email: "p@example.com", successUrl: "s", cancelUrl: "c", consentVersion: "v", automaticTax: true });
  const again = new URLSearchParams(calls[1].init.body);
  assert.equal(again.get("customer"), "cus_ABC123");
  assert.equal(again.get("customer_email"), null, "an existing customer, not a new one");
  assert.equal(again.get("automatic_tax[enabled]"), "true");

  assert.deepEqual(await api(reply(200, { url: "https://billing.stripe.com/p/session/x" })).createPortalSession("cus_ABC123", "https://x.test/account"), { url: "https://billing.stripe.com/p/session/x" });
  assert.equal(calls.at(-1).url, "https://api.stripe.com/v1/billing_portal/sessions");
  await api(reply(200, { id: "sub_1" })).retrieveSubscription("sub_1");
  assert.match(calls.at(-1).url, /^https:\/\/api\.stripe\.com\/v1\/subscriptions\/sub_1\?expand/);
  assert.equal(calls.at(-1).init.method, "GET");
  assert.equal(calls.at(-1).init.body, undefined);
  const listed = await api(reply(200, { data: [{ id: "sub_1" }], has_more: true })).listSubscriptions("sub_0");
  assert.deepEqual(listed, { data: [{ id: "sub_1" }], hasMore: true });
  assert.match(calls.at(-1).url, /status=all&limit=100&starting_after=sub_0/);
  assert.equal(await api(reply(200, { data: [{ invoice: "in_9" }] })).invoiceForPaymentIntent("pi_1"), "in_9");
  assert.equal(await api(reply(200, { data: [] })).invoiceForPaymentIntent("pi_1"), null);

  await assert.rejects(() => api(reply(402, { error: { code: "card_declined", message: "secret detail 4242" } })).retrieveInvoice("in_1"), (e) => e instanceof stripe.StripeError && e.status === 402 && e.code === "card_declined" && !e.message.includes("4242"));
  await assert.rejects(() => api(async () => { throw new Error("offline"); }).retrieveInvoice("in_1"), (e) => e.status === 0 && e.code === "network");
  await assert.rejects(() => api(reply(200, { id: "cs", url: 5 })).createCheckoutSession({ priceId: "p", clientId: "c", customerId: null, email: "e", successUrl: "s", cancelUrl: "c", consentVersion: "v", automaticTax: false }), (e) => e.code === "bad_session");
});

test("hostedUrl: only Stripe's own hosted pages over https are followed", () => {
  assert.equal(stripe.hostedUrl("https://checkout.stripe.com/c/pay/x", stripe.CHECKOUT_HOSTS), "https://checkout.stripe.com/c/pay/x");
  for (const bad of ["http://checkout.stripe.com/x", "https://evil.example/x", "https://checkout.stripe.com.evil.example/x", "javascript:alert(1)", "//checkout.stripe.com/x", "", null, 5, "https://billing.stripe.com/x"]) assert.equal(stripe.hostedUrl(bad, stripe.CHECKOUT_HOSTS), null, String(bad));
  assert.ok(stripe.hostedUrl("https://billing.stripe.com/p/x", stripe.PORTAL_HOSTS));
});

// ---- mapping ---------------------------------------------------------------------------------------------------

test("mapper: the period end is read from the item (new API) or the subscription (old), and anything unreadable is refused", () => {
  const end = sec(NOW.getTime() + 30 * DAY);
  const newer = fake.fakeSubscription({ id: "sub_n1", customer: "cus_1", periodEnd: end });
  const parsed = map.toSubscriptionInput(newer);
  assert.equal(parsed.stripeSubscriptionId, "sub_n1");
  assert.equal(parsed.planInterval, "month");
  assert.equal(parsed.currentPeriodEnd.getTime(), end * 1000);
  const older = { id: "sub_o1", customer: { id: "cus_2" }, status: "past_due", current_period_end: end, cancel_at_period_end: true, canceled_at: end - 5, ended_at: null, items: { data: [{ price: { id: "price_x1", recurring: { interval: "year" } } }] } };
  const o = map.toSubscriptionInput(older);
  assert.equal(o.status, "past_due");
  assert.equal(o.planInterval, "year");
  assert.equal(o.currentPeriodEnd.getTime(), end * 1000);
  assert.equal(o.cancelAtPeriodEnd, true);
  assert.equal(o.canceledAt.getTime(), (end - 5) * 1000);
  assert.equal(map.customerOf(older), "cus_2", "an expanded customer object");
  for (const bad of [{}, { ...newer, status: "weird" }, { ...newer, id: undefined }, { ...newer, items: { data: [] } }, { ...newer, items: { data: [{ price: { id: "price_x1", recurring: { interval: "week" } } }] } }]) assert.equal(map.toSubscriptionInput(bad), null);
  assert.equal(map.clientHint({ metadata: { client_id: "11111111-1111-4111-8111-111111111111" } }), "11111111-1111-4111-8111-111111111111");
  assert.equal(map.clientHint({ metadata: { client_id: "not-a-uuid" } }), null);
  assert.equal(map.subscriptionOfInvoice({ subscription: "sub_a" }), "sub_a");
  assert.equal(map.subscriptionOfInvoice({ parent: { subscription_details: { subscription: "sub_b" } } }), "sub_b");
  assert.equal(map.subscriptionOfInvoice({}), null);
});

// ---- the emails ------------------------------------------------------------------------------------------------

test("emails: escaped, plain-text twins, links only to this site or Stripe's invoice page, never a card detail", () => {
  const evil = 'https://invoice.stripe.com/i/x"><script>alert(1)</script>';
  const all = [
    mail.welcomeEmail({ interval: "year", nextDate: new Date("2027-10-20T12:00:00Z") }),
    mail.receiptEmail({ amountPaid: 999, currency: "gbp", hostedInvoiceUrl: evil }),
    mail.paymentFailedEmail(),
    mail.renewalReminderEmail({ amountDue: 999, currency: "gbp", renewsOn: new Date("2026-11-20T12:00:00Z") }),
    mail.cancellationEmail({ accessUntil: new Date("2026-11-20T12:00:00Z"), endedNow: false }),
    mail.cancellationEmail({ accessUntil: null, endedNow: true }),
  ];
  for (const m of all) {
    assert.ok(m.subject && m.html && m.text);
    assert.ok(!m.html.includes("<script>"), "no raw markup from a value");
    assert.ok(!/4242|card number|cvc/i.test(m.html + m.text));
    assert.ok(m.html.includes("<html") && m.html.includes("LearnThrive"));
    assert.match(m.text, /Kind regards/);
  }
  assert.match(all[0].html, /yearly/);
  assert.match(all[0].text, /Next renewal: 20 October 2027/);
  assert.match(all[1].text, /£9\.99/);
  assert.ok(all[1].html.includes("&quot;&gt;&lt;script&gt;"), "a hostile link is escaped");
  assert.match(all[3].text, /renews automatically on 20 November 2026/);
  assert.match(all[3].text, /£9\.99/);
  assert.match(all[4].text, /until 20 November 2026/);
  assert.match(all[5].text, /has ended/);
  assert.match(all[2].text, /Manage billing/);
});

// ---- the events ------------------------------------------------------------------------------------------------

function world(t, { now = NOW } = {}) {
  environment(t, {});
  const lines = quiet(t);
  session.resetSessionCache();
  h.resetBillingLimiters();
  const store = new InMemoryLibraryStore();
  const auth = new MemoryAccountAuth({ onUserCreated: (u) => store.seedProfile({ id: u.id, displayName: u.displayName, email: u.email }) });
  const rt = { backend: "memory", auth, store, lockout: new SignInLockout(), outbox: auth.outbox, memory: store };
  const api = new fake.FakeStripeApi();
  const sent = [];
  const mailer = { send: async (to, m) => (sent.push({ to, subject: m.subject, text: m.text }), true) };
  const deps = { store, stripe: api, mailer, now: () => now };

  async function family(email = `fam${Math.random().toString(36).slice(2)}@example.com`) {
    await auth.signUp({ email, password: GOOD, displayName: "Pat Example", adultConfirmed: true });
    const jarMap = new Map();
    const jar = { get: (n) => jarMap.get(n), set: (n, v) => jarMap.set(n, v), delete: (n) => jarMap.delete(n) };
    const opened = await auth.verifyEmailLink(auth.outbox.findLast((m) => m.to === email).tokenHash, "signup");
    session.setSessionCookies(jar, opened.tokens, {});
    const clientId = await store.accounts.ensureClient(opened.user.id);
    return { email, jar, userId: opened.user.id, clientId };
  }
  const evt = (type, object, extra = {}) => ({ id: `evt_${Math.random().toString(36).slice(2, 12)}`, object: "event", type, livemode: false, data: { object, ...extra } });
  const periodEnd = sec(now.getTime() + 30 * DAY);
  const putSub = (over) => {
    const s = fake.fakeSubscription({ periodEnd, ...over });
    api.subscriptions.set(s.id, s);
    return s;
  };
  return { store, auth, rt, api, sent, mailer, deps, family, evt, putSub, lines, periodEnd, now };
}

test("events: checkout completed links the customer, mirrors the subscription, opens access and welcomes once", async (t) => {
  const w = world(t);
  const fam = await w.family("pat@example.com");
  w.putSub({ id: "sub_a1", customer: "cus_A1", clientId: fam.clientId });
  const outcome = await events.processStripeEvent(w.evt("checkout.session.completed", { mode: "subscription", client_reference_id: fam.clientId, customer: "cus_A1", subscription: "sub_a1" }), w.deps);
  assert.equal(outcome, "mirrored");
  assert.equal(await w.store.billing.getStripeCustomerId(fam.clientId), "cus_A1");
  assert.equal((await w.store.billing.getSubscriptionByStripeId("sub_a1")).clientId, fam.clientId);
  assert.equal((await w.store.access.facts(fam.clientId, w.now)).subscription, true);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].to, "pat@example.com");
  assert.match(w.sent[0].subject, /Welcome/);
  assert.equal(await events.processStripeEvent(w.evt("checkout.session.completed", { mode: "payment", client_reference_id: fam.clientId }), w.deps), "ignored", "not a subscription");
  assert.equal(await events.processStripeEvent({ type: "x", data: {} }, w.deps), "ignored");
  assert.equal(await events.processStripeEvent(w.evt("customer.created", { id: "cus_1" }), w.deps), "ignored", "an event this site does not use");
});

test("events: permanent failures (unknown client, a customer that belongs to someone else, an unreadable subscription) are named, not retried", async (t) => {
  const w = world(t);
  const fam = await w.family();
  const other = await w.family();
  w.putSub({ id: "sub_b1", customer: "cus_B1" });
  const bad = (object) => events.processStripeEvent(w.evt("checkout.session.completed", { mode: "subscription", subscription: "sub_b1", customer: "cus_B1", ...object }), w.deps);
  await assert.rejects(() => bad({ client_reference_id: "22222222-2222-4222-8222-222222222222" }), (e) => e instanceof events.PermanentEventError && e.code === "unknown_client");
  await assert.rejects(() => bad({ client_reference_id: "not-a-uuid" }), (e) => e.code === "unknown_client");
  await assert.rejects(() => bad({ client_reference_id: undefined }), (e) => e.code === "unknown_client");
  await assert.rejects(() => bad({ client_reference_id: fam.clientId, subscription: undefined }), (e) => e.code === "no_subscription");
  await bad({ client_reference_id: fam.clientId });
  await assert.rejects(() => bad({ client_reference_id: other.clientId }), (e) => e.code === "customer_conflict", "cus_B1 is already linked to the first family");
  w.api.subscriptions.set("sub_junk", { id: "sub_junk", status: "active" });
  await assert.rejects(() => bad({ client_reference_id: fam.clientId, subscription: "sub_junk" }), (e) => e.code === "unreadable_subscription");
  assert.equal(await w.store.billing.getSubscriptionByStripeId("sub_junk"), null);
});

test("events: the subscription event can arrive before the checkout event, and a Stripe state read back beats a stale payload", async (t) => {
  const w = world(t);
  const fam = await w.family();
  w.putSub({ id: "sub_c1", customer: "cus_C1", clientId: fam.clientId, status: "active" });
  const created = w.evt("customer.subscription.created", { id: "sub_c1", customer: "cus_C1", status: "incomplete" });
  assert.equal(await events.processStripeEvent(created, w.deps), "mirrored");
  assert.equal(await w.store.billing.getClientByStripeCustomer("cus_C1"), fam.clientId, "linked through the metadata hint");
  assert.equal((await w.store.billing.getSubscriptionByStripeId("sub_c1")).status, "active", "Stripe's current state, not the event's stale one");
  assert.equal((await w.store.access.facts(fam.clientId, w.now)).subscription, true);

  w.putSub({ id: "sub_c2", customer: "cus_UNKNOWN", status: "active" });
  assert.equal(await events.processStripeEvent(w.evt("customer.subscription.updated", { id: "sub_c2", customer: "cus_UNKNOWN" }), w.deps), "unresolved_client", "a subscription for nobody this site knows is left alone");
  assert.equal(await w.store.billing.getSubscriptionByStripeId("sub_c2"), null);
});

test("events: cancelling emails once when newly requested, and access runs to the paid end then stops", async (t) => {
  const w = world(t);
  const fam = await w.family("pat@example.com");
  w.putSub({ id: "sub_d1", customer: "cus_D1", clientId: fam.clientId });
  await events.processStripeEvent(w.evt("customer.subscription.created", { id: "sub_d1", customer: "cus_D1" }), w.deps);
  w.sent.length = 0;
  w.putSub({ id: "sub_d1", customer: "cus_D1", clientId: fam.clientId, cancelAtPeriodEnd: true, canceledAt: sec(w.now.getTime()) });
  await events.processStripeEvent(w.evt("customer.subscription.updated", { id: "sub_d1", customer: "cus_D1", cancel_at_period_end: true }, { previous_attributes: { cancel_at_period_end: false } }), w.deps);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].subject, /cancelled/);
  assert.match(w.sent[0].text, /will not renew/);
  await events.processStripeEvent(w.evt("customer.subscription.updated", { id: "sub_d1", customer: "cus_D1", cancel_at_period_end: true }, { previous_attributes: { items: {} } }), w.deps);
  assert.equal(w.sent.length, 1, "another update that is not a new cancellation says nothing");
  assert.equal((await w.store.access.facts(fam.clientId, w.now)).subscription, true, "still open until the end");

  w.putSub({ id: "sub_d1", customer: "cus_D1", clientId: fam.clientId, status: "canceled", cancelAtPeriodEnd: true, endedAt: sec(w.now.getTime() + 2 * DAY) });
  await events.processStripeEvent(w.evt("customer.subscription.deleted", { id: "sub_d1", customer: "cus_D1" }), w.deps);
  assert.match(w.sent.at(-1).text, /has ended/);
  assert.equal((await w.store.access.facts(fam.clientId, w.now)).subscription, true, "ended two days from now: still open today");
  assert.equal((await w.store.access.facts(fam.clientId, new Date(w.now.getTime() + 3 * DAY))).subscription, false, "and closed after");
});

test("events: payment failed emails and keeps access only to the paid date; a paid invoice sends a receipt link", async (t) => {
  const w = world(t);
  const fam = await w.family("pat@example.com");
  w.putSub({ id: "sub_e1", customer: "cus_E1", clientId: fam.clientId });
  await events.processStripeEvent(w.evt("customer.subscription.created", { id: "sub_e1", customer: "cus_E1" }), w.deps);
  w.sent.length = 0;

  w.putSub({ id: "sub_e1", customer: "cus_E1", clientId: fam.clientId, status: "past_due", periodEnd: sec(w.now.getTime() + DAY) });
  await events.processStripeEvent(w.evt("invoice.payment_failed", { id: "in_1", subscription: "sub_e1", customer: "cus_E1" }), w.deps);
  assert.match(w.sent[0].subject, /could not take/);
  assert.equal((await w.store.billing.getSubscriptionByStripeId("sub_e1")).status, "past_due");
  assert.equal((await w.store.access.facts(fam.clientId, w.now)).subscription, true, "inside the period already paid for");
  assert.equal((await w.store.access.facts(fam.clientId, new Date(w.now.getTime() + 2 * DAY))).subscription, false, "past it, no access while the payment is failing");

  w.putSub({ id: "sub_e1", customer: "cus_E1", clientId: fam.clientId, status: "active" });
  await events.processStripeEvent(w.evt("invoice.paid", { id: "in_2", parent: { subscription_details: { subscription: "sub_e1" } }, amount_paid: 999, currency: "gbp", hosted_invoice_url: "https://invoice.stripe.com/i/acct_1/test_1" }), w.deps);
  assert.match(w.sent.at(-1).subject, /receipt/);
  assert.match(w.sent.at(-1).text, /https:\/\/invoice\.stripe\.com\/i\/acct_1\/test_1/);
  assert.equal((await w.store.access.facts(fam.clientId, w.now)).subscription, true, "paid again: open again");
  const before = w.sent.length;
  await events.processStripeEvent(w.evt("invoice.paid", { id: "in_3", subscription: "sub_e1", amount_paid: 0, currency: "gbp" }), w.deps);
  assert.equal(w.sent.length, before, "a zero invoice needs no receipt");
  assert.equal(await events.processStripeEvent(w.evt("invoice.paid", { id: "in_4" }), w.deps), "ignored", "an invoice with no subscription");
});

test("events: the renewal reminder, and refunds (full ends access, partial changes nothing, both API shapes)", async (t) => {
  const w = world(t);
  const fam = await w.family("pat@example.com");
  w.putSub({ id: "sub_f1", customer: "cus_F1", clientId: fam.clientId });
  await events.processStripeEvent(w.evt("customer.subscription.created", { id: "sub_f1", customer: "cus_F1" }), w.deps);
  w.sent.length = 0;
  assert.equal(await events.processStripeEvent(w.evt("invoice.upcoming", { subscription: "sub_f1", amount_due: 999, currency: "gbp", next_payment_attempt: sec(w.now.getTime() + 7 * DAY) }), w.deps), "reminded");
  assert.match(w.sent[0].text, /renews automatically on 27 October 2026/);
  assert.equal(await events.processStripeEvent(w.evt("invoice.upcoming", { subscription: "sub_unknown" }), w.deps), "unresolved_client");

  assert.equal(await events.processStripeEvent(w.evt("charge.refunded", { id: "ch_1", refunded: false, amount_refunded: 100, invoice: "in_9" }), w.deps), "ignored", "partial");
  assert.equal((await w.store.access.facts(fam.clientId, w.now)).subscription, true);
  w.api.invoices.set("in_9", { id: "in_9", subscription: "sub_f1" });
  assert.equal(await events.processStripeEvent(w.evt("charge.refunded", { id: "ch_2", refunded: true, invoice: "in_9" }), w.deps), "refunded");
  assert.equal((await w.store.access.facts(fam.clientId, w.now)).subscription, false, "a full refund ends access at once");
  w.putSub({ id: "sub_f1", customer: "cus_F1", clientId: fam.clientId, status: "active" });
  await events.processStripeEvent(w.evt("customer.subscription.updated", { id: "sub_f1", customer: "cus_F1" }), w.deps);
  assert.equal((await w.store.access.facts(fam.clientId, w.now)).subscription, false, "Stripe still says active; the refund wins");

  const g = await w.family();
  w.putSub({ id: "sub_f2", customer: "cus_F2", clientId: g.clientId });
  await events.processStripeEvent(w.evt("customer.subscription.created", { id: "sub_f2", customer: "cus_F2" }), w.deps);
  w.api.invoices.set("in_10", { id: "in_10", parent: { subscription_details: { subscription: "sub_f2" } } });
  w.api.invoiceByPaymentIntent.set("pi_77", "in_10");
  assert.equal(await events.processStripeEvent(w.evt("charge.refunded", { id: "ch_3", refunded: true, payment_intent: "pi_77" }), w.deps), "refunded", "newer API: the invoice found through the payment intent");
  assert.equal((await w.store.access.facts(g.clientId, w.now)).subscription, false);
  assert.equal(await events.processStripeEvent(w.evt("charge.refunded", { id: "ch_4", refunded: true }), w.deps), "ignored", "a charge with no invoice (a one-off) is not ours");
});

// ---- the webhook route -----------------------------------------------------------------------------------------

function hook(w, event, { secret = SECRET, ts = sec(NOW.getTime()), raw, env = ENV, headers = {} } = {}) {
  const payload = raw ?? JSON.stringify(event);
  return h.handleWebhook(
    new Request("http://localhost:3100/api/billing/webhook", { method: "POST", headers: { "stripe-signature": header(payload, secret, ts), ...headers }, body: payload }),
    { rt: w.rt, stripe: w.api, mailer: w.mailer, env, now: () => NOW },
  );
}

test("webhook: a signed event is handled once, a duplicate is acknowledged, and nothing personal is logged", async (t) => {
  const w = world(t);
  const fam = await w.family("pat@example.com");
  w.putSub({ id: "sub_g1", customer: "cus_G1", clientId: fam.clientId });
  const event = w.evt("checkout.session.completed", { mode: "subscription", client_reference_id: fam.clientId, customer: "cus_G1", subscription: "sub_g1" });
  const first = await hook(w, event);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { received: true });
  assert.equal(w.sent.length, 1);
  const again = await hook(w, event);
  assert.equal(again.status, 200);
  assert.deepEqual(await again.json(), { received: true, duplicate: true });
  assert.equal(w.sent.length, 1, "no second welcome email");
  const log = w.lines.join("\n");
  assert.ok(!log.includes("pat@example.com") && !log.includes("Pat Example") && !log.includes("cus_G1") && !log.includes("sub_g1") && !log.includes(SECRET) && !log.includes(KEY));
});

test("webhook: refuses a bad or missing signature, a stale one, a wrong mode, a body that is not an event; closed without settings", async (t) => {
  const w = world(t);
  const event = w.evt("invoice.paid", { id: "in_1" });
  const status = async (response) => response.status;
  assert.equal(await status(await hook(w, event, { secret: "whsec_other0123456789abcdef" })), 400);
  assert.equal(await status(await hook(w, event, { ts: sec(NOW.getTime()) - 400 })), 400);
  const unsigned = await h.handleWebhook(new Request("http://localhost/x", { method: "POST", body: JSON.stringify(event) }), { rt: w.rt, stripe: w.api, mailer: w.mailer, env: ENV, now: () => NOW });
  assert.equal(unsigned.status, 400);
  const tampered = JSON.stringify(event);
  const swapped = await h.handleWebhook(new Request("http://localhost/x", { method: "POST", headers: { "stripe-signature": header(tampered) }, body: tampered.replace("invoice.paid", "invoice.void") }), { rt: w.rt, stripe: w.api, mailer: w.mailer, env: ENV, now: () => NOW });
  assert.equal(swapped.status, 400, "a changed body fails its signature");
  assert.equal(await status(await hook(w, { ...event, livemode: true })), 400, "a live event on a test-key server");
  assert.equal(await status(await hook(w, null, { raw: "[1,2]" })), 400);
  assert.equal(await status(await hook(w, null, { raw: "not json" })), 400);
  assert.equal(await status(await hook(w, { ...event, id: "bad id" })), 400);
  assert.equal(await status(await hook(w, { ...event, type: "" })), 400);
  assert.equal(await status(await hook(w, event, { env: {} })), 503, "no Stripe settings: closed");
  const huge = await h.handleWebhook(new Request("http://localhost/x", { method: "POST", headers: { "stripe-signature": "t=1,v1=" + "a".repeat(64) }, body: "x".repeat(2 * 1024 * 1024) }), { rt: w.rt, stripe: w.api, mailer: w.mailer, env: ENV, now: () => NOW });
  assert.equal(huge.status, 413);
  assert.equal((await h.handleWebhook(new Request("http://localhost/x", { method: "POST", body: "{}" }), { rt: null, stripe: w.api, mailer: w.mailer, env: ENV, now: () => NOW })).status, 503);
});

test("webhook: a failure worth retrying is a 500 and the retry succeeds; a permanent one is a 200 that is recorded", async (t) => {
  const w = world(t);
  const fam = await w.family("pat@example.com");
  const event = w.evt("customer.subscription.created", { id: "sub_h1", customer: "cus_H1" });
  w.putSub({ id: "sub_h1", customer: "cus_H1", clientId: fam.clientId });
  w.api.failNext = new stripe.StripeError(503, "api_connection_error");
  const failed = await hook(w, event);
  assert.equal(failed.status, 500, "Stripe will try again");
  assert.equal(await w.store.billing.getSubscriptionByStripeId("sub_h1"), null);
  const retried = await hook(w, event);
  assert.equal(retried.status, 200);
  assert.equal((await w.store.billing.getSubscriptionByStripeId("sub_h1")).status, "active", "the retry did the work");
  assert.equal((await hook(w, event)).status, 200, "and is then a duplicate");

  const orphan = w.evt("checkout.session.completed", { mode: "subscription", client_reference_id: "33333333-3333-4333-8333-333333333333", customer: "cus_X", subscription: "sub_h1" });
  const permanent = await hook(w, orphan);
  assert.equal(permanent.status, 200, "an unknown account will never succeed; do not make Stripe retry");
  assert.ok(w.lines.some((l) => l.includes("permanent_failure") && l.includes("unknown_client")));
  assert.equal((await hook(w, orphan)).status, 200);
});

// ---- checkout and portal ---------------------------------------------------------------------------------------

async function shop(t, options) {
  const w = world(t, options);
  await w.store.resources.upsert({ slug: "maths-one", title: "Maths one", description: "", subject: "Maths", level: "GCSE", examBoard: null, topic: "Algebra", resourceType: "worksheet", yearGroup: null, tags: [], accessTier: "members", authorship: "LearnThrive Tuition", publishedAt: new Date(NOW.getTime() - DAY) });
  return w;
}
const checkout = (w, jar, fields, { accept, origin, env = ENV, ip } = {}) =>
  h.handleCheckout(
    jsonRequest("http://localhost:3100/api/billing/create-checkout", {}, fields, { ip, headers: { ...(accept ? { accept } : {}), ...(origin ? { origin } : {}) } }),
    { rt: w.rt, jar, stripe: w.api, mailer: w.mailer, env, now: () => NOW },
  );
const plan = (extra = {}) => ({ plan: "monthly", acknowledged: "yes", ...extra });

test("checkout: a signed-in adult who ticked the box is sent to Stripe's own page, and the consent is recorded", async (t) => {
  const w = await shop(t);
  const fam = await w.family("pat@example.com");
  const response = await checkout(w, fam.jar, plan());
  assert.equal(response.status, 200);
  const { url } = await response.json();
  assert.match(url, /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_fake1$/);
  const asked = w.api.sessions[0];
  assert.equal(asked.priceId, "price_monthly123");
  assert.equal(asked.clientId, fam.clientId);
  assert.equal(asked.email, "pat@example.com");
  assert.equal(asked.customerId, null);
  assert.equal(asked.successUrl, `${new URL(asked.successUrl).origin}/account/billing/success?session_id={CHECKOUT_SESSION_ID}`);
  assert.match(asked.cancelUrl, /\/pricing\?checkout=cancelled$/);
  assert.equal(asked.consentVersion, consumer.CONSENT_VERSION);
  const consents = w.store.consents();
  assert.equal(consents.length, 1);
  assert.deepEqual({ ...consents[0], at: undefined, profileId: undefined }, { kind: "digital_content_waiver", version: consumer.CONSENT_VERSION, textSha256: consentHash(), at: undefined, profileId: undefined });
  assert.equal(consentHash().length, 64);

  await w.store.billing.linkCustomer(fam.clientId, "cus_KNOWN1");
  const annual = await (await checkout(w, fam.jar, plan({ plan: "annual" }))).json();
  assert.ok(annual.url);
  assert.equal(w.api.sessions[1].priceId, "price_annual123");
  assert.equal(w.api.sessions[1].customerId, "cus_KNOWN1", "an existing customer is reused");

  const form = await h.handleCheckout(
    new Request("http://localhost:3100/api/billing/create-checkout", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html", "x-forwarded-for": "198.51.100.77, 10.0.0.1" }, body: "plan=monthly&acknowledged=yes" }),
    { rt: w.rt, jar: fam.jar, stripe: w.api, mailer: w.mailer, env: ENV, now: () => NOW },
  );
  assert.equal(form.status, 303, "a browser form post is redirected, not shown JSON");
  assert.match(form.headers.get("location"), /^https:\/\/checkout\.stripe\.com\//);
});

test("checkout: every refusal, in order, and nothing is created or recorded by any of them", async (t) => {
  const w = await shop(t);
  const fam = await w.family("pat@example.com");
  const code = async (response) => (await response.json()).code;
  const signedOut = { get: () => undefined, set() {}, delete() {} };

  assert.equal((await checkout(w, fam.jar, plan(), { origin: "https://evil.example" })).status, 403);
  for (const [env, why] of [[{ ...ENV, LIBRARY_PHASE: "enrolled" }, "phase"], [{ ...ENV, STRIPE_SECRET_KEY: undefined }, "stripe"], [{ ...ENV, LIBRARY_VAT_STATUS: undefined }, "vat"], [{ ...ENV, LIBRARY_MIN_PER_SUBJECT: undefined }, "gate"]]) {
    const r = await checkout(w, fam.jar, plan(), { env });
    assert.equal(r.status, 503, why);
    assert.equal(await code(r), "unavailable", why);
  }
  assert.equal(await code(await checkout(w, signedOut, plan())), "signed_out");
  assert.equal(await code(await checkout(w, fam.jar, plan({ acknowledged: "" }))), "acknowledge");
  assert.equal(await code(await checkout(w, fam.jar, { plan: "monthly" })), "acknowledge", "no pre-ticked box: absent means no");
  assert.equal(await code(await checkout(w, fam.jar, plan({ plan: "lifetime" }))), "bad_request");
  assert.equal(await code(await checkout(w, fam.jar, plan(), { env: { ...ENV, LIBRARY_REQUIRED_SUBJECTS: "Maths,English" } })), "catalogue_not_ready", "English has nothing published");
  assert.equal(await code(await checkout(w, fam.jar, plan(), { env: { ...ENV, LIBRARY_MIN_PER_SUBJECT: "5" } })), "catalogue_not_ready");

  const accept = await checkout(w, signedOut, plan(), { accept: "text/html" });
  assert.equal(accept.status, 303);
  assert.equal(accept.headers.get("location"), "/account/sign-in?next=%2Fpricing");
  assert.equal(w.api.sessions.length, 0);
  assert.equal(w.store.consents().length, 0, "no consent recorded for a refused checkout");

  w.store.seedProfile({ id: fam.userId, displayName: "Pat", adultConfirmed: false, email: "pat@example.com" });
  assert.equal(await code(await checkout(w, fam.jar, plan())), "adult_required");
  w.store.seedProfile({ id: fam.userId, displayName: "Pat", adultConfirmed: true, email: "pat@example.com" });

  w.api.failNext = new stripe.StripeError(500, "api_error");
  const failed = await checkout(w, fam.jar, plan());
  assert.equal(failed.status, 502);
  assert.equal(await code(failed), "failed");
  const bad = await h.handleCheckout(jsonRequest("http://localhost:3100/x", {}, plan()), { rt: w.rt, jar: fam.jar, stripe: { createCheckoutSession: async () => ({ id: "cs_x", url: "https://evil.example/pay" }) }, mailer: w.mailer, env: ENV, now: () => NOW });
  assert.equal(bad.status, 502, "a session URL that is not Stripe's is never followed");
  assert.equal((await h.handleCheckout(jsonRequest("http://localhost:3100/x", {}, plan()), { rt: null, jar: fam.jar, stripe: w.api, mailer: w.mailer, env: ENV, now: () => NOW })).status, 503);
});

test("checkout: someone who already has access through a subscription cannot buy a second one, and the attempts are rate limited", async (t) => {
  const w = await shop(t);
  const fam = await w.family();
  w.putSub({ id: "sub_k1", customer: "cus_K1", clientId: fam.clientId });
  await events.processStripeEvent(w.evt("customer.subscription.created", { id: "sub_k1", customer: "cus_K1" }), w.deps);
  const again = await checkout(w, fam.jar, plan());
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, "already");
  assert.equal(w.api.sessions.length, 0);

  const other = await w.family();
  const ip = "198.51.100.200";
  const seen = [];
  for (let i = 0; i < 11; i += 1) seen.push((await checkout(w, other.jar, plan({ acknowledged: "" }), { ip })).status);
  assert.deepEqual(seen.slice(0, 10), Array(10).fill(422));
  assert.equal(seen[10], 429);
});

test("portal: a customer is sent to Stripe's hosted portal and back to the account; no customer, no session, bad origin are refused", async (t) => {
  const w = await shop(t);
  const fam = await w.family();
  const portal = (jar, options = {}) =>
    h.handlePortal(new Request("http://localhost:3100/api/billing/create-portal-session", { method: "POST", headers: { ...(options.origin ? { origin: options.origin } : {}), ...(options.accept ? { accept: options.accept } : {}) } }), { rt: w.rt, jar, stripe: w.api, mailer: w.mailer, env: ENV, now: () => NOW });
  assert.equal((await portal(fam.jar)).status, 404, "nothing to manage yet");
  assert.equal((await portal(fam.jar, { accept: "text/html" })).headers.get("location"), "/account?billing=none");
  await w.store.billing.linkCustomer(fam.clientId, "cus_P1");
  const ok = await portal(fam.jar);
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).url, /^https:\/\/billing\.stripe\.com\//);
  assert.equal(w.api.portals[0].customerId, "cus_P1");
  assert.match(w.api.portals[0].returnUrl, /\/account$/);
  assert.equal((await portal(fam.jar, { origin: "https://evil.example" })).status, 403);
  assert.equal((await portal({ get: () => undefined, set() {}, delete() {} })).status, 401);
  assert.equal((await h.handlePortal(new Request("http://localhost/x", { method: "POST" }), { rt: w.rt, jar: fam.jar, stripe: null, mailer: w.mailer, env: ENV })).status, 503);
});

// ---- the whole access matrix -----------------------------------------------------------------------------------

test("access matrix: every combination of enrolled, subscription state, grant and tier gives the one right answer", async (t) => {
  const w = world(t);
  const lib = loadTsFrom(import.meta.url, "../../../packages/data/src/library/access.ts");
  let checked = 0;
  for (const enrolled of [false, true])
    for (const subscription of ["none", "active", "expired", "refunded"])
      for (const grant of ["none", "open", "revoked"])
        for (const tier of ["free_sample", "members"]) {
          const profileId = w.store.seedProfile({});
          const clientId = await w.store.accounts.ensureClient(profileId);
          if (enrolled) w.store.seedAssignment(w.store.seedStudent(profileId), "ACTIVE");
          if (subscription !== "none") {
            const s = await w.store.billing.upsertSubscription(clientId, {
              stripeSubscriptionId: `sub_m${checked}`, stripePriceId: "price_x1", status: subscription === "expired" ? "canceled" : "active", planInterval: "month",
              currentPeriodEnd: new Date(NOW.getTime() + (subscription === "expired" ? -5 : 10) * DAY), cancelAtPeriodEnd: false, canceledAt: null, endedAt: subscription === "expired" ? new Date(NOW.getTime() - 5 * DAY) : null,
            });
            if (subscription === "refunded") await w.store.billing.markRefunded(s.stripeSubscriptionId, NOW);
            await w.store.billing.syncEntitlement(s, NOW);
          }
          if (grant !== "none") {
            const g = await w.store.billing.createGrant({ clientId, reason: "test", startsAt: new Date(NOW.getTime() - DAY) });
            if (grant === "revoked") await w.store.billing.revokeGrant(g.id, new Date(NOW.getTime() - 1000));
          }
          const facts = await w.store.access.facts(clientId, NOW);
          const decision = lib.canAccess({ role: "CLIENT" }, { accessTier: tier, publishedAt: new Date(NOW.getTime() - DAY) }, facts, NOW);
          const expected = tier === "free_sample" || enrolled || subscription === "active" || grant === "open";
          assert.equal(decision.allowed, expected, JSON.stringify({ enrolled, subscription, grant, tier }));
          checked += 1;
        }
  assert.equal(checked, 48);
});

// ---- reconciliation and the command lines ----------------------------------------------------------------------

const rec = loadTsFrom(import.meta.url, "../src/lib/billing/reconcile.ts");

test("reconcile: a dry run reports and writes nothing; apply brings the mirror and entitlements into line", async (t) => {
  const w = world(t);
  const a = await w.family();
  const b = await w.family();
  const c = await w.family();
  // a: mirrored as active, but Stripe says canceled (a missed webhook). b: never mirrored. One for nobody. One mirrored that Stripe lost.
  w.putSub({ id: "sub_r1", customer: "cus_R1", clientId: a.clientId });
  await events.processStripeEvent(w.evt("customer.subscription.created", { id: "sub_r1", customer: "cus_R1" }), w.deps);
  w.putSub({ id: "sub_r1", customer: "cus_R1", clientId: a.clientId, status: "canceled", endedAt: sec(w.now.getTime() - DAY) });
  w.putSub({ id: "sub_r2", customer: "cus_R2", clientId: b.clientId });
  w.putSub({ id: "sub_r3", customer: "cus_NOBODY" });
  w.api.subscriptions.set("sub_bad", { id: "sub_bad", status: "nonsense" });
  await w.store.billing.upsertSubscription(c.clientId, { stripeSubscriptionId: "sub_lost", stripePriceId: "price_x1", status: "active", planInterval: "month", currentPeriodEnd: new Date(w.now.getTime() + 5 * DAY), cancelAtPeriodEnd: false, canceledAt: null, endedAt: null });

  const dry = await rec.reconcile({ store: w.store, stripe: w.api, now: () => w.now }, { apply: false });
  assert.equal(dry.seenAtStripe, 4);
  assert.deepEqual(dry.changed.map((c) => c.id).sort(), ["sub_r1", "sub_r2"]);
  assert.match(dry.changed.find((c) => c.id === "sub_r1").why, /status active -> canceled/);
  assert.deepEqual(dry.unresolved, ["sub_r3"]);
  assert.deepEqual(dry.unreadable, ["sub_bad"]);
  assert.deepEqual(dry.missingAtStripe, ["sub_lost"]);
  assert.equal(dry.resynced, 0);
  assert.equal((await w.store.billing.getSubscriptionByStripeId("sub_r1")).status, "active", "a dry run changes nothing");
  assert.equal(await w.store.billing.getSubscriptionByStripeId("sub_r2"), null);

  const done = await rec.reconcile({ store: w.store, stripe: w.api, now: () => w.now }, { apply: true });
  assert.deepEqual(done.changed.map((c) => c.id).sort(), ["sub_r1", "sub_r2"]);
  assert.equal((await w.store.billing.getSubscriptionByStripeId("sub_r1")).status, "canceled");
  assert.equal((await w.store.access.facts(a.clientId, w.now)).subscription, false, "the missed cancellation now closes access");
  assert.equal(await w.store.billing.getClientByStripeCustomer("cus_R2"), b.clientId, "linked from the metadata hint");
  assert.equal((await w.store.access.facts(b.clientId, w.now)).subscription, true);
  assert.equal(await w.store.billing.getSubscriptionByStripeId("sub_r3"), null, "nothing is created for a stranger");
  assert.equal((await w.store.billing.getSubscriptionByStripeId("sub_lost")).status, "active", "and a record Stripe lost is left alone");
  const again = await rec.reconcile({ store: w.store, stripe: w.api, now: () => w.now }, { apply: true });
  assert.equal(again.changed.length, 0, "a second run has nothing left to do");
  assert.equal(again.unchanged, 2);

  assert.equal(await rec.markRefunded({ store: w.store, now: () => w.now }, "sub_r2"), true);
  assert.equal((await w.store.access.facts(b.clientId, w.now)).subscription, false);
  assert.equal(await rec.markRefunded({ store: w.store, now: () => w.now }, "sub_nope"), false);
});

test("the billing and grant command lines explain themselves and refuse to run without their settings", async () => {
  const { spawnSync } = await import("node:child_process");
  const dir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const env = { ...process.env };
  for (const key of ["DATABASE_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) delete env[key];
  const run = (script, ...args) => spawnSync(process.execPath, ["--import", "tsx", `scripts/${script}`, ...args], { env, encoding: "utf8", cwd: dir });
  assert.equal(run("billing-reconcile.mjs", "--help").status, 0);
  assert.match(run("billing-reconcile.mjs").stderr, /DATABASE_URL is required/);
  assert.equal(run("billing-reconcile.mjs").status, 2);
  assert.match(run("billing-reconcile.mjs", "--mark-refunded", "nope").stderr, /Stripe subscription id/);
  assert.equal(run("library-grant.mjs", "--help").status, 0);
  assert.match(run("library-grant.mjs").stderr, /DATABASE_URL is required/);
  const withDb = { ...env, DATABASE_URL: "postgres://nobody@127.0.0.1:1/none" };
  const grant = (...args) => spawnSync(process.execPath, ["--import", "tsx", "scripts/library-grant.mjs", ...args], { env: withDb, encoding: "utf8", cwd: dir });
  assert.match(grant().stderr, /--email is required/);
  assert.match(grant("--email", "a@b.co").stderr, /--reason/);
  assert.match(grant("--email", "a@b.co", "--reason", "x", "--ends", "tomorrow").stderr, /--ends must be a date/);
  assert.match(grant("--email", "a@b.co", "--reason", "x", "--ends", "2020-01-01").stderr, /must be in the future/);
});

// ---- what the pages may offer ----------------------------------------------------------------------------------

const offerLib = loadTsFrom(import.meta.url, "../src/lib/billing/offer.ts");

test("subscriptionOffer: open only when everything is in place; otherwise the pages behave as the enrolled phase", async (t) => {
  const w = await shop(t);
  const env = { ...ENV, LIBRARY_PRICE_MONTHLY: "9.99", LIBRARY_PRICE_ANNUAL: "99" };
  const open = await offerLib.subscriptionOffer(w.store, env);
  assert.equal(open.open, true);
  assert.equal(open.vat, "not_registered");
  assert.deepEqual(open.plans.map((p) => [p.plan, p.period, p.price]), [["monthly", "month", "£9.99"], ["annual", "year", "£99"]]);
  assert.equal(offerLib.effectivePhase("live", open), "live");

  const closed = async (changes, reason) => {
    const offer = await offerLib.subscriptionOffer(w.store, { ...env, ...changes });
    assert.deepEqual([offer.open, offer.reason], [false, reason], JSON.stringify(changes));
    assert.equal(offerLib.effectivePhase("live", offer), "enrolled", "live without everything is not live");
    return offer;
  };
  await closed({ LIBRARY_PHASE: "enrolled" }, "phase");
  await closed({ LIBRARY_PHASE: "info" }, "phase");
  await closed({ STRIPE_SECRET_KEY: undefined }, "stripe");
  await closed({ STRIPE_PRICE_MONTHLY: undefined, STRIPE_PRICE_ANNUAL: undefined }, "price");
  await closed({ LIBRARY_VAT_STATUS: undefined }, "vat");
  await closed({ LIBRARY_MIN_PER_SUBJECT: undefined }, "gate");
  await closed({ LIBRARY_TERMS_APPROVED: undefined }, "legal");
  await closed({ LIBRARY_MIN_PER_SUBJECT: "50" }, "content");
  await closed({ LIBRARY_PRICE_MONTHLY: undefined, LIBRARY_PRICE_ANNUAL: undefined }, "display_price");
  assert.equal((await offerLib.subscriptionOffer(null, env)).open, false, "no backend: not open");
  const onlyMonthly = await offerLib.subscriptionOffer(w.store, { ...env, STRIPE_PRICE_ANNUAL: undefined });
  assert.deepEqual(onlyMonthly.plans.map((p) => p.plan), ["monthly"], "a plan with no Stripe price is not offered");
  assert.equal(offerLib.effectivePhase("enrolled", open), "enrolled");
  assert.equal(offerLib.effectivePhase("info", open), "info");
  assert.equal(offerLib.libraryTermsHref({ NODE_ENV: "development" }), "/library/terms");
  assert.equal(offerLib.libraryTermsHref({ NODE_ENV: "production" }), "/terms", "until approved, the website terms");
  assert.equal(offerLib.libraryTermsHref({ NODE_ENV: "production", LIBRARY_TERMS_APPROVED: "true" }), "/library/terms");
});

