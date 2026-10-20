import { test, expect, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { hydrated } from './careers-support';
import { address, confirm, distinctVisitor, expectAxeClean, signUp } from './account-support';

// plan19 phase E: the Library with subscriptions open (the "library-live" project: LIBRARY_PHASE=live and the FAKE Stripe, on
// their own server). The pricing card, checkout hand-off, the signed webhook, the account page, the portal, cancellation and
// refunds, all against the real routes. Stripe itself is replaced by a fake that a test sets through /api/dev/billing-fake, and
// every request to a Stripe host is intercepted in the browser: nothing here reaches the real Stripe.
// Not covered, and impossible here: a real Stripe test-mode account (docs/BILLING.md has the steps).

distinctVisitor();

const WEBHOOK_SECRET = 'whsec_e2efakesecret0000000001';

test.beforeAll(async ({ request }) => {
  expect((await request.post('/api/dev/library-seed', { data: { action: 'catalogue' } })).ok()).toBe(true);
});

// Stripe's hosted pages are never really visited. The site answers a checkout or portal form post with a redirect to a Stripe
// host; the test catches that answer (so the browser never leaves for Stripe), records where it pointed, and shows a stand-in
// page. Anything else aimed at a Stripe host is aborted, so a mistake cannot reach the real service.
const hops = new WeakMap<Page, string[]>();
const stripeHops = (page: Page) => hops.get(page) ?? [];

test.beforeEach(async ({ page, context }) => {
  hops.set(page, []);
  await context.route(/^https?:\/\/([a-z0-9-]+\.)*stripe\.com\//, (route) => route.abort());
  await page.route('**/api/billing/**', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch({ maxRedirects: 0 });
    const location = response.headers()['location'];
    if (location && /^https:\/\/(checkout|billing)\.stripe\.com\//.test(location)) {
      hops.get(page)!.push(location);
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Stripe (intercepted)</title><h1>Fake Stripe page</h1>' });
    }
    return route.fulfill({ response });
  });
});

function signedHook(event: object, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const payload = JSON.stringify(event);
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  return { data: payload, headers: { 'stripe-signature': `t=${timestamp},v1=${v1}`, 'content-type': 'application/json' } };
}

let counter = 0;
const evt = (type: string, object: object, extra: object = {}) => ({ id: `evt_e2e${Date.now()}${(counter += 1)}`, object: 'event', type, livemode: false, data: { object, ...extra } });

async function subscribe(page: Page, email: string, over: Record<string, unknown> = {}) {
  const id = `sub_e2e${Date.now()}${(counter += 1)}`;
  const set = await page.request.post('/api/dev/billing-fake', { data: { action: 'subscription', email, id, ...over } });
  expect(set.ok()).toBe(true);
  const { clientId, customer } = (await set.json()) as { clientId: string; customer: string };
  const hook = await page.request.post('/api/billing/webhook', signedHook(evt('checkout.session.completed', { mode: 'subscription', client_reference_id: clientId, customer, subscription: id })));
  expect(hook.status()).toBe(200);
  return { id, clientId, customer };
}

async function member(page: Page) {
  const email = address();
  await signUp(page, email);
  await confirm(page, email);
  return email;
}

test('/pricing is live: both plans with their price, period, VAT, renewal, cancellation and refund words, and an unticked box', async ({ page }) => {
  const requested = new Set<string>();
  page.on('request', (r) => requested.add(new URL(r.url()).host));
  await page.goto('/pricing');
  await hydrated(page);
  const monthly = page.locator('#plan-monthly');
  const annual = page.locator('#plan-annual');
  await expect(monthly).toContainText('£9.99');
  await expect(monthly).toContainText('per month');
  await expect(annual).toContainText('£99');
  await expect(annual).toContainText('per year');
  await expect(monthly).toContainText('including VAT');
  await expect(monthly).toContainText('renews automatically');
  await expect(monthly).toContainText('cancel at any time, online');
  await expect(monthly).toContainText('Refunds');
  await expect(monthly).toContainText('14 days');
  await expect(monthly.getByRole('checkbox')).not.toBeChecked();
  await expect(annual.getByRole('checkbox')).not.toBeChecked();
  await expect(page.locator('[data-pricing-draft]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Coming soon');
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toHaveCount(2);
  expect([...requested], 'no Stripe script or request from the page itself').toEqual(['localhost:3102']);
  expect(await page.context().cookies()).toEqual([]);
  await expectAxeClean(page, '/pricing live');
});

test('the overview says the Library is open to everyone by subscription, and the waitlist is gone', async ({ page }) => {
  await page.goto('/library');
  await expect(page.locator('.page-hero')).toContainText('available to everyone else by subscription');
  await expect(page.locator('.page-hero')).not.toContainText('coming soon');
  await expect(page.locator('#waitlist')).toHaveCount(0);
});

test('the box must be ticked: the browser says so and moves focus to it, and a post without it is refused', async ({ page }) => {
  await member(page);
  await page.goto('/pricing');
  await hydrated(page);
  const card = page.locator('#plan-monthly');
  await card.getByRole('button', { name: 'Continue to checkout' }).click();
  await expect(card.getByRole('checkbox')).toBeFocused();
  await expect(card.getByText('Tick the box to confirm you understand')).toBeVisible();
  const posted = await page.request.post('/api/billing/create-checkout', { data: { plan: 'monthly' } });
  expect(posted.status()).toBe(422);
  expect((await posted.json()).code).toBe('acknowledge');
});

test('signed out, ticking and continuing goes to sign-in and back to the pricing page', async ({ page }) => {
  await page.goto('/pricing');
  await hydrated(page);
  const card = page.locator('#plan-monthly');
  await card.getByRole('checkbox').check();
  await card.getByRole('button', { name: 'Continue to checkout' }).click();
  await expect(page).toHaveURL(/\/account\/sign-in\?next=%2Fpricing$/);
});

test('signed in: continuing hands off to Stripe\'s hosted checkout, and a cancelled checkout charges nothing', async ({ page }) => {
  await member(page);
  await page.goto('/pricing');
  await hydrated(page);
  const card = page.locator('#plan-annual');
  await card.getByRole('checkbox').check();
  await card.getByRole('button', { name: 'Continue to checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Fake Stripe page' })).toBeVisible();
  expect(stripeHops(page)).toHaveLength(1);
  expect(stripeHops(page)[0]).toMatch(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_fake/);
  await page.goto('/pricing?checkout=cancelled');
  await expect(page.getByRole('status').filter({ hasText: 'have not been charged' })).toBeVisible();
  await page.goto('/pricing?checkout=%3Cscript%3E');
  await expect(page.locator('main')).not.toContainText('<script>');
  await expect(page.getByText('have not been charged')).toHaveCount(0);
});

test('the webhook: signed events open access, are idempotent, and unsigned or wrongly signed ones are refused', async ({ page }) => {
  const email = await member(page);
  const unsigned = await page.request.post('/api/billing/webhook', { data: evt('invoice.paid', {}) });
  expect(unsigned.status()).toBe(400);
  const wrong = await page.request.post('/api/billing/webhook', signedHook(evt('invoice.paid', {}), 'whsec_notthesecret000000001'));
  expect(wrong.status()).toBe(400);
  const stale = await page.request.post('/api/billing/webhook', signedHook(evt('invoice.paid', {}), WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600));
  expect(stale.status()).toBe(400);

  // Before the payment: members content is closed.
  expect((await page.request.post('/api/library/download/dev-seed-quadratics')).status()).toBe(403);

  const id = `sub_e2eidem${Date.now()}`;
  const set = await page.request.post('/api/dev/billing-fake', { data: { action: 'subscription', email, id } });
  const { clientId, customer } = (await set.json()) as { clientId: string; customer: string };
  const event = evt('checkout.session.completed', { mode: 'subscription', client_reference_id: clientId, customer, subscription: id });
  const first = await page.request.post('/api/billing/webhook', signedHook(event));
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ received: true });
  const second = await page.request.post('/api/billing/webhook', signedHook(event));
  expect(await second.json()).toEqual({ received: true, duplicate: true });

  const download = await page.request.post('/api/library/download/dev-seed-quadratics');
  expect(download.status(), 'members content opens once the subscription is mirrored').toBe(200);
  expect((await PDFDocument.load(await download.body())).getPageCount()).toBe(1);
});

test('the account page shows the plan in plain words, the portal opens Stripe, cancelling keeps access to the end, a refund ends it', async ({ page }) => {
  const email = await member(page);
  const sub = await subscribe(page, email);

  await page.goto('/account');
  await hydrated(page);
  await expect(page.getByRole('heading', { name: 'Your plan' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Monthly plan. Active. Renews automatically on');
  await expect(page.locator('main')).toContainText('Included: your subscription.');
  await expectAxeClean(page, '/account with a subscription');

  await page.getByRole('button', { name: 'Manage billing and invoices' }).click();
  await expect(page.getByRole('heading', { name: 'Fake Stripe page' })).toBeVisible();
  expect(stripeHops(page)[0]).toMatch(/^https:\/\/billing\.stripe\.com\/p\/session\/test_fake/);

  // Cancel at period end (in the portal, then Stripe tells the webhook).
  await page.request.post('/api/dev/billing-fake', { data: { action: 'subscription', email, id: sub.id, cancelAtPeriodEnd: true, periodEndDays: 12 } });
  const cancelled = await page.request.post('/api/billing/webhook', signedHook(evt('customer.subscription.updated', { id: sub.id, customer: sub.customer, cancel_at_period_end: true }, { previous_attributes: { cancel_at_period_end: false } })));
  expect(cancelled.status()).toBe(200);
  await page.goto('/account');
  await expect(page.locator('main')).toContainText('Cancelled: you keep access until');
  await expect(page.locator('main')).toContainText('it will not renew');
  expect((await page.request.post('/api/library/download/dev-seed-quadratics')).status(), 'still open until the end').toBe(200);

  // A full refund ends access at once, even though Stripe still says active.
  await page.request.post('/api/dev/billing-fake', { data: { action: 'invoice', id: 'in_e2erefund1', subscription: sub.id } });
  const refunded = await page.request.post('/api/billing/webhook', signedHook(evt('charge.refunded', { id: 'ch_e2e1', refunded: true, invoice: 'in_e2erefund1' })));
  expect(refunded.status()).toBe(200);
  expect((await page.request.post('/api/library/download/dev-seed-quadratics')).status()).toBe(403);
  await page.goto('/account');
  await expect(page.locator('main')).toContainText('Refunded: access has ended.');
});

test('a second subscription is refused while one is open, and the success page waits for the webhook', async ({ page }) => {
  const email = await member(page);
  await page.goto('/account/billing/success?session_id=cs_test_fake1');
  await expect(page.getByRole('status').filter({ hasText: 'confirming it with Stripe' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Check again' })).toBeVisible();
  await expectAxeClean(page, 'success, waiting');
  await subscribe(page, email);
  await page.getByRole('link', { name: 'Check again' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Your subscription is active' })).toBeVisible();
  const again = await page.request.post('/api/billing/create-checkout', { data: { plan: 'monthly', acknowledged: 'yes' } });
  expect(again.status()).toBe(409);
  expect((await again.json()).code).toBe('already');
  const noOrigin = await page.request.post('/api/billing/create-portal-session', { headers: { origin: 'https://evil.example' } });
  expect(noOrigin.status()).toBe(403);
});

test('a payment that fails keeps access to the paid date only, and the account page says what to do', async ({ page }) => {
  const email = await member(page);
  const sub = await subscribe(page, email);
  await page.request.post('/api/dev/billing-fake', { data: { action: 'subscription', email, id: sub.id, status: 'past_due', periodEndDays: -5 } });
  const failed = await page.request.post('/api/billing/webhook', signedHook(evt('invoice.payment_failed', { id: 'in_e2efail1', subscription: sub.id, customer: sub.customer })));
  expect(failed.status()).toBe(200);
  await page.goto('/account');
  await expect(page.locator('main')).toContainText('The latest payment failed');
  await expect(page.locator('main')).toContainText('Your access has paused');
  expect((await page.request.post('/api/library/download/dev-seed-quadratics')).status()).toBe(403);
});

test('the pricing and account pages have no horizontal scroll at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await member(page);
  for (const path of ['/pricing', '/account', '/account/billing/success']) {
    await page.goto(path);
    await hydrated(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${path} overflows`).toBe(true);
  }
});

test('the Library terms are linked from the pricing card and the sign-up card, and read as approved here', async ({ page }) => {
  await page.goto('/pricing');
  await page.getByRole('link', { name: /Library terms and content licence/ }).click();
  await expect(page).toHaveURL(/\/library\/terms$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Library terms and content licence' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Draft for the owners and a legal reviewer');
  for (const heading of ['Your licence', 'Price, payment and renewal', 'Cancelling', 'Refunds']) await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await expect(page.locator('main')).toContainText('renews automatically until you cancel');
  await expectAxeClean(page, '/library/terms');
  await page.goto('/account/sign-up');
  await expect(page.locator('[data-auth-mode]').getByRole('link', { name: /terms/ }).first()).toHaveAttribute('href', '/library/terms');
});
