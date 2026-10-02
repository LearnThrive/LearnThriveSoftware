import { test, expect, type Page } from '@playwright/test';

// plan15 Wave 12 — the production build, as deployed. See playwright.prod.config.ts for how to run it.

const PUBLIC_ROUTES = [
  '/',
  '/about',
  '/subjects',
  '/maths-tuition',
  '/english-tuition',
  '/science-tuition',
  '/11-plus-tuition',
  '/book',
  '/contact',
  '/faq',
  '/safeguarding',
  '/privacy',
  '/cookies',
  '/terms',
  '/tuition-terms',
  '/complaints',
  '/accessibility',
];

/** Collects console errors, uncaught exceptions, CSP violations and every host the page talks to. */
async function watch(page: Page) {
  const problems: string[] = [];
  const hosts = new Set<string>();
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 200)}`);
  });
  page.on('pageerror', (error) => problems.push(`exception: ${String(error).slice(0, 200)}`));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'http:' || url.protocol === 'https:') hosts.add(url.host);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return { problems, hosts };
}

test.describe('every public route, as served in production', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route}: 200, a heading, no console errors or CSP violations, no third-party requests`, async ({ page, baseURL }) => {
      const { problems, hosts } = await watch(page);
      const response = await page.goto(route, { waitUntil: 'load' });
      expect(response?.status()).toBe(200);
      await expect(page.locator('h1').first()).toBeVisible();
      await page.waitForTimeout(600);
      expect(problems, problems.join('\n')).toEqual([]);
      expect([...hosts], 'a page may talk only to its own origin').toEqual([new URL(baseURL!).host]);
    });
  }

  test('no horizontal overflow at 360 px on any route', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    const overflowing: string[] = [];
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route, { waitUntil: 'load' });
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (extra > 0) overflowing.push(`${route} (+${extra}px)`);
    }
    expect(overflowing).toEqual([]);
  });
});

test.describe('security headers', () => {
  test('CSP, HSTS, COOP and the baseline headers are on a public page', async ({ request }) => {
    const headers = (await request.get('/')).headers();
    expect(headers['content-security-policy'] ?? headers['content-security-policy-report-only']).toContain("default-src 'self'");
    expect(headers['content-security-policy'] ?? '').not.toContain('unsafe-eval');
    expect(headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(headers['strict-transport-security']).not.toContain('preload');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['x-powered-by']).toBeUndefined();
  });
});

test.describe('the portal is closed in production', () => {
  for (const route of ['/login', '/dashboard', '/dashboard/lessons', '/403']) {
    test(`${route} sends a visitor to the "Portal opening soon" page`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/portal-opening-soon$/);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('not open yet');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    });
  }

  test('the header and footer offer no login while it is closed, and never ask for a session', async ({ page }) => {
    const sessionCalls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/auth/')) sessionCalls.push(request.url());
    });
    await page.goto('/');
    await expect(page.getByRole('link', { name: /^login$/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /tutor login/i })).toHaveCount(0);
    await page.waitForTimeout(800);
    expect(sessionCalls).toEqual([]);
  });

  test('the auth API is a 404', async ({ request }) => {
    expect((await request.get('/api/auth/session')).status()).toBe(404);
    expect((await request.post('/api/auth/login', { data: { email: 'a@b.co', password: 'x' } })).status()).toBe(404);
  });
});

test.describe('development surfaces do not exist in production', () => {
  for (const route of ['/dev/motion', '/dev/classroom']) {
    test(`${route} is a 404`, async ({ request }) => {
      expect((await request.get(route)).status()).toBe(404);
    });
  }
  test('the dev reset endpoint is a 404', async ({ request }) => {
    expect((await request.post('/api/dev/reset')).status()).toBe(404);
  });
});

test.describe('crawlers and operations', () => {
  test('robots.txt allows the site and disallows the app, API and dev tools', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();
    expect(body).toContain('Allow: /');
    for (const path of ['/dashboard', '/api/', '/dev', '/login']) expect(body).toContain(`Disallow: ${path}`);
    expect(body).toContain('Sitemap: https://www.learnthrivetuition.co.uk/sitemap.xml');
  });

  test('sitemap.xml lists every public route and not the portal notice', async ({ request }) => {
    const body = await (await request.get('/sitemap.xml')).text();
    for (const route of PUBLIC_ROUTES) {
      const url = `https://www.learnthrivetuition.co.uk${route === '/' ? '' : route}`;
      expect(body, route).toContain(`<loc>${url}</loc>`);
    }
    expect(body).not.toContain('portal-opening-soon');
  });

  test('security.txt, the health check and the web manifest are served', async ({ request }) => {
    expect((await request.get('/.well-known/security.txt')).status()).toBe(200);
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok' });
    expect(health.headers()['cache-control']).toContain('no-store');
    expect((await request.get('/manifest.webmanifest')).status()).toBe(200);
  });

  test('every route has a canonical URL on the production host', async ({ page }) => {
    for (const route of PUBLIC_ROUTES) {
      await page.goto(route);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical, route).toBe(`https://www.learnthrivetuition.co.uk${route === '/' ? '' : route}`);
    }
  });

  test('an unknown path is the branded 404', async ({ page }) => {
    const response = await page.goto('/this-page-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('not here');
  });
});

test.describe('the enquiry endpoint (nothing here sends a real email)', () => {
  const enquiry = {
    parentName: 'Smoke Test',
    email: 'smoke@example.com',
    phone: '',
    yearGroup: 'Year 8',
    subject: 'Maths',
    support: 'A smoke test of the enquiry endpoint, which must not send.',
    contactMethod: 'Email',
  };

  // The route limits submissions per client address (5 per 15 minutes). A documentation-range address
  // per request keeps repeated and parallel smoke runs from limiting each other.
  const asNewClient = (extra: Record<string, string> = {}) => ({
    'X-Forwarded-For': `203.0.113.${Math.floor(Math.random() * 250) + 1}`,
    ...extra,
  });

  test('a request from another origin is refused', async ({ request }) => {
    const response = await request.post('/api/enquiry', { data: { ...enquiry, elapsedMs: 30000 }, headers: asNewClient({ Origin: 'https://evil.example' }) });
    expect(response.status()).toBe(403);
  });

  test('an invalid body is a 400', async ({ request }) => {
    expect((await request.post('/api/enquiry', { data: { ...enquiry, email: 'nope', elapsedMs: 30000 }, headers: asNewClient() })).status()).toBe(400);
  });

  test('a filled honeypot looks like success to the sender and sends nothing', async ({ request }) => {
    const response = await request.post('/api/enquiry', { data: { ...enquiry, website: 'https://spam.example', elapsedMs: 30000 }, headers: asNewClient() });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  test('a submission that is too fast looks like success to the sender and sends nothing', async ({ request }) => {
    const response = await request.post('/api/enquiry', { data: { ...enquiry, elapsedMs: 300 }, headers: asNewClient() });
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });
});
