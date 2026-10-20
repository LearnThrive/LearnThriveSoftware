import { test, expect } from '@playwright/test';

// plan19 phase C: the production build with LIBRARY_ENABLED=true and NO Supabase settings (the state of a deploy that
// has switched the carve-out on before the backend exists). It checks both halves of the carve-out: the account and
// Library routes are reachable, and everything else stays closed, and the account backend fails CLOSED (503/404),
// never open.
//
//   LIBRARY_ENABLED=true NODE_ENV=production npx next start -p 3201      (after `npm run build`)
//   LIBRARY_ENABLED_BASE_URL=http://localhost:3201 npm run test:prod-smoke -- tests-prod/library-enabled.spec.ts
//
// Skipped unless LIBRARY_ENABLED_BASE_URL is set, so the plain smoke run needs only the one server.
const base = process.env.LIBRARY_ENABLED_BASE_URL;
test.skip(!base, 'LIBRARY_ENABLED_BASE_URL is not set');
test.use({ baseURL: base ?? 'http://localhost:3201' });

test.describe('LIBRARY_ENABLED=true opens the account and Library routes and nothing else', () => {
  test('/login goes to the account sign-in, which says accounts are not open without a backend', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/account\/sign-in$/);
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

  test('the public Library and pricing pages are still public and cookie-free', async ({ page }) => {
    for (const path of ['/library', '/pricing']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
    }
    expect(await page.context().cookies()).toEqual([]);
  });
});
