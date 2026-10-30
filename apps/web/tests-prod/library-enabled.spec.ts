import { test, expect } from '@playwright/test';

// plan19 phase C: the production build with LIBRARY_ENABLED=true and NO Supabase settings (the state of a deploy that
// has switched the carve-out on before the backend exists). It checks both halves of the carve-out: the account and
// Library routes are reachable, and everything else stays closed, and the account backend fails CLOSED (503/404),
// never open.
//
//   LIBRARY_ENABLED=true LIBRARY_PHASE=live NODE_ENV=production npx next start -p 3201      (after `npm run build`)
//   LIBRARY_ENABLED_BASE_URL=http://localhost:3201 npm run test:prod-smoke -- tests-prod/library-enabled.spec.ts
//
// Skipped unless LIBRARY_ENABLED_BASE_URL is set, so the plain smoke run needs only the one server.
const base = process.env.LIBRARY_ENABLED_BASE_URL;
test.skip(!base, 'LIBRARY_ENABLED_BASE_URL is not set');
test.use({ baseURL: base ?? 'http://localhost:3201' });

test.describe('LIBRARY_ENABLED=true opens the account and Library routes and nothing else', () => {
  test('/login is the one sign-in, which says accounts are not open without a backend (and the old /account/sign-in leads to it)', async ({ page }) => {
    await page.goto('/account/sign-in');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText('Accounts are not open yet.')).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    expect(await page.context().cookies(), 'no cookie just for looking').toEqual([]);
  });

  for (const route of ['/dashboard', '/dashboard/lessons', '/403']) {
    test(`${route} is still the "Portal opening soon" page`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/portal-opening-soon$/);
    });
  }

  test('the staff auth API, lessons API and development tools are still 404s', async ({ request }) => {
    for (const path of ['/api/auth/session', '/api/lessons/anything/ics', '/dev/motion', '/api/dev/account-outbox', '/api/dev/reset']) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
    expect((await request.post('/api/auth/login', { data: { email: 'a@b.co', password: 'x' } })).status()).toBe(404);
  });

  test('the account API answers 503 (closed), not 404 and not open, with no backend configured', async ({ request }) => {
    expect((await request.get('/api/account/me')).status()).toBe(503);
    const signUp = await request.post('/api/account/signup', { data: { email: 'a@example.com', password: 'a long enough password', confirmAdult: true } });
    expect(signUp.status()).toBe(503);
    expect((await signUp.json()).error).toContain('Accounts are not open yet');
    const login = await request.post('/api/account/login', { data: { email: 'a@example.com', password: 'x' } });
    expect(login.status()).toBe(503);
    expect(login.headers()['set-cookie']).toBeUndefined();
  });

  test('LearnThrive AI and voice are closed in production: every route refuses, the page is a 404, and the status says why', async ({ request }) => {
    for (const path of ['/api/assistant/chat', '/api/assistant/files', '/api/assistant/voice/transcribe', '/api/assistant/voice/speak']) {
      const refused = await request.post(path, { data: { text: 'hello' } });
      expect(refused.status(), path).toBe(503);
      expect(refused.headers()['set-cookie'], path).toBeUndefined();
      const cross = await request.post(path, { data: {}, headers: { origin: 'https://evil.example' } });
      expect(cross.status(), `${path} cross-site`).toBe(403);
    }
    const status = await request.get('/api/assistant/status');
    expect(await status.json()).toEqual({ open: false, reason: 'disabled' });
    expect((await request.get('/library/ai')).status()).toBe(404);
  });

  test('the member account page does not exist without a backend, and a cross-site post is refused first', async ({ request }) => {
    expect((await request.get('/account')).status()).toBe(404);
    const cross = await request.post('/api/account/login', { data: {}, headers: { origin: 'https://evil.example' } });
    expect(cross.status()).toBe(403);
  });

  test('account pages are not indexed and not in the sitemap or robots allow-list', async ({ request }) => {
    const header = (await request.get('/api/account/me')).headers()['x-robots-tag'];
    expect(header).toContain('noindex');
    const sitemap = await (await request.get('/sitemap.xml')).text();
    for (const path of ['/account', '/login']) expect(sitemap).not.toContain(`${path}<`);
    expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /account');
  });

  test('with the phase turned up but no backend and no Stripe, the pages stay coming soon and the billing routes fail closed', async ({ page, request }) => {
    // The server for this suite is started with LIBRARY_PHASE=live and none of the Supabase or Stripe settings.
    await page.goto('/library');
    await expect(page.locator('.page-hero')).toContainText('Coming soon');
    await expect(page.locator('#catalogue')).toHaveCount(0);
    await page.goto('/pricing');
    await expect(page.locator('main')).toContainText('Coming soon');
    await expect(page.getByRole('button', { name: 'Continue to checkout' })).toHaveCount(0);
    await expect(page.locator('#waitlist')).toBeVisible();
    for (const path of ['/library/search', '/library/free-samples', '/library/subject/maths', '/library/some-resource']) expect((await request.get(path)).status(), path).toBe(404);
    expect((await request.get('/library/terms')).status(), 'the terms are not approved').toBe(404);
    const checkout = await request.post('/api/billing/create-checkout', { data: { plan: 'monthly', acknowledged: 'yes' } });
    expect(checkout.status()).toBe(503);
    expect((await checkout.json()).code).toBe('unavailable');
    expect((await request.post('/api/billing/create-portal-session')).status()).toBe(503);
    expect((await request.post('/api/billing/webhook', { data: '{}', headers: { 'stripe-signature': 't=1,v1=' + 'a'.repeat(64) } })).status()).toBe(503);
    expect((await request.post('/api/library/download/some-resource')).status()).toBe(503);
    expect((await request.get('/api/dev/billing-fake')).status()).toBe(404);
    expect((await request.post('/api/dev/library-seed', { data: { action: 'catalogue' } })).status()).toBe(404);
  });

  test('the public Library and pricing pages are still public and cookie-free', async ({ page }) => {
    for (const path of ['/library', '/pricing']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
    }
    expect(await page.context().cookies()).toEqual([]);
  });
});
