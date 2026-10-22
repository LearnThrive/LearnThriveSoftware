import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { hydrated } from './careers-support';
import { address, confirm, distinctVisitor, expectAxeClean, signUp } from './account-support';

// plan19 phase D: the Library with its catalogue open (LIBRARY_PHASE=enrolled, the "library-open" project on its own
// server and its own in-memory data). Synthetic catalogue from /api/dev/library-seed; nothing real, nothing emailed.

distinctVisitor();

test.beforeAll(async ({ request }) => {
  expect((await request.post('/api/dev/library-seed', { data: { action: 'catalogue' } })).ok()).toBe(true);
});

async function noThirdParties(page: Page, path: string) {
  const hosts = new Set<string>();
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith('http')) hosts.add(u.host);
  });
  await page.goto(path);
  await hydrated(page);
  expect([...hosts], `${path} talks only to the site`).toEqual(['localhost:3101']);
}

async function becomeMember(page: Page, how: 'enrol' | 'subscribe' | 'grant' | null) {
  const email = address();
  await signUp(page, email);
  await confirm(page, email);
  if (how) expect((await page.request.post('/api/dev/library-seed', { data: { action: how, email } })).ok()).toBe(true);
  return email;
}

test('/library: the catalogue is open, the page no longer says the Library is coming soon, and nothing is stored', async ({ page }) => {
  await noThirdParties(page, '/library');
  const hero = page.locator('.page-hero');
  await expect(hero).toContainText('Open to enrolled students');
  await expect(hero).not.toContainText('The Library is coming soon');
  await expect(page.getByRole('heading', { name: 'Browse and search' })).toBeVisible();
  await expect(page.locator('#catalogue ul[aria-label="Resources"] > li').first()).toBeVisible();
  await expect(page.locator('main')).toContainText('A subscription for everyone else is coming soon');
  expect(await page.context().cookies()).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await expectAxeClean(page, '/library');
});

test('search by words, filters and the empty state work with the keyboard, and the address keeps the query', async ({ page }) => {
  await page.goto('/library');
  await hydrated(page);
  const search = page.getByRole('search', { name: 'Search the Library' });
  await search.getByLabel('Search', { exact: true }).fill('fractions');
  await search.getByLabel('Search', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/library\?q=fractions/);
  await expect(page.getByRole('status').filter({ hasText: 'resource' })).toContainText('1 resource.');
  await expect(page.locator('#catalogue').getByRole('link', { name: 'Fractions practice (dev seed)' })).toBeVisible();

  await page.goto('/library?level=GCSE&type=exam%20paper');
  await expect(page.locator('#catalogue ul[aria-label="Resources"] > li')).toHaveCount(1);
  await expect(page.locator('#catalogue')).toContainText('Mock paper 1 (dev seed)');
  await page.goto('/library?q=zzzzzz');
  await expect(page.getByText('No resources match.')).toBeVisible();
  await page.getByRole('link', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/library#catalogue$/);

  // Junk in the address is dropped, not echoed or trusted.
  await page.goto('/library?level=ZZ&type=<script>&page=-4&q=%00x');
  await expect(page.locator('#catalogue')).toBeVisible();
  await expect(page.locator('#cat-q')).toHaveValue('x');
  await expect(page.locator('#cat-level')).toHaveValue('');
  await expect(page.locator('#cat-type')).toHaveValue('');
});

test('paging: twelve to a page, with previous and next links', async ({ page, request }) => {
  expect((await request.post('/api/dev/library-seed', { data: { action: 'bulk', count: 30 } })).ok()).toBe(true);
  await page.goto('/library/search?subject=Maths&level=GCSE');
  await hydrated(page);
  await expect(page.getByRole('status').filter({ hasText: 'page 1 of' })).toBeVisible();
  await expect(page.locator('#catalogue').locator('ul[aria-label="Resources"] > li')).toHaveCount(12);
  await page.getByRole('link', { name: 'Next page' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole('link', { name: 'Previous page' })).toBeVisible();
  await page.goto('/library/search?subject=Maths&level=GCSE&page=9999');
  await expect(page.getByRole('status').filter({ hasText: 'there is no page' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to the first page' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'page 1 of' })).toBeVisible();
});

test('subject, topic and free-sample pages, and a subject nobody has published is a 404', async ({ page }) => {
  await page.goto('/library/subject/maths');
  await expect(page.getByRole('heading', { level: 1, name: 'Maths' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Maths topics' })).toContainText('Algebra');
  await page.getByRole('navigation', { name: 'Maths topics' }).getByRole('link', { name: /Algebra/ }).click();
  await expect(page).toHaveURL(/\/library\/subject\/maths\/algebra$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Algebra' })).toBeVisible();
  await expectAxeClean(page, 'topic page');

  await page.goto('/library/free-samples');
  await expect(page.getByRole('heading', { level: 1, name: 'Free samples' })).toBeVisible();
  const items = page.getByRole('list', { name: 'Free samples' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  for (const text of await items.allInnerTexts()) expect(text).toContain('Free sample');

  expect((await page.request.get('/library/subject/astrology')).status()).toBe(404);
  expect((await page.request.get('/library/subject/maths/nonsense')).status()).toBe(404);
});

test('a resource page lists the facts publicly; drafts, scheduled and unknown resources are 404', async ({ page }) => {
  await page.goto('/library/dev-seed-quadratics');
  await expect(page.getByRole('heading', { level: 1, name: 'Quadratic equations (dev seed)' })).toBeVisible();
  const facts = page.getByRole('definition');
  await expect(page.getByRole('term').filter({ hasText: 'Made by' })).toBeVisible();
  await expect(page.locator('dl[aria-label="About this resource"]')).toContainText('LearnThrive Tuition (development seed)');
  await expect(facts.first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', /\/login\?next=%2Flibrary%2Fdev-seed-quadratics$/);
  await expect(page.locator('a[href*="library/dev-seed-quadratics/"]')).toHaveCount(0);
  await expect(page.locator('a[href$=".pdf"], a[href*="storage"]')).toHaveCount(0);
  await expectAxeClean(page, 'resource page, signed out');
  for (const slug of ['dev-seed-draft', 'dev-seed-scheduled', 'no-such-resource']) expect((await page.request.get(`/library/${slug}`)).status(), slug).toBe(404);
});

test('a signed-out visitor cannot download, and the route says so without leaking anything', async ({ page }) => {
  const response = await page.request.post('/api/library/download/dev-seed-sequences');
  expect(response.status()).toBe(401);
  expect((await response.json()).code).toBe('signed_out');
  expect(response.headers()['set-cookie']).toBeUndefined();
  expect((await page.request.post('/api/library/download/dev-seed-sequences', { headers: { origin: 'https://evil.example' } })).status()).toBe(403);
});

test('a free sample: any signed-in account downloads it, stamped with the holder and the time', async ({ page }) => {
  const email = await becomeMember(page, null);
  await page.goto('/library/dev-seed-sequences');
  await hydrated(page);
  await expectAxeClean(page, 'resource page, signed in');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  expect(download.suggestedFilename()).toBe('dev-seed-sequences-v1.pdf');
  const path = await download.path();
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const doc = await PDFDocument.load(bytes);
  expect(doc.getSubject()).toContain(`Licensed to ${email}`);
  expect(doc.getSubject()).toMatch(/on \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  await expect(page).toHaveURL(/\/library\/dev-seed-sequences$/);
});

test('the name on the account page is the name on the download, and the account page says what the account can open', async ({ page }) => {
  const email = await becomeMember(page, null);
  await page.goto('/account');
  await hydrated(page);
  await expect(page.getByText('Free samples only.')).toBeVisible();
  await expectAxeClean(page, '/account in the open phase');
  await page.getByLabel('Name on downloads').fill('Pat Example');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Name on downloads')).toHaveValue('Pat Example');
  expect((await page.request.post('/api/dev/library-seed', { data: { action: 'enrol', email } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByText('Included: your family is enrolled with LearnThrive.')).toBeVisible();

  const response = await page.request.post('/api/library/download/dev-seed-sequences');
  expect(response.status()).toBe(200);
  const doc = await PDFDocument.load(await response.body());
  expect(doc.getSubject()).toContain('Licensed to Pat Example on ');
  expect(doc.getSubject()).not.toContain(email);
  // The icon menu lists only pages that exist (Study Buddy appears because the assistant is open on this server). The family is enrolled
  // by now, and an enrolled family has the whole platform, so the menu also leads back to the dashboard (a Library-only account never
  // sees that link: one-sign-in.spec.ts).
  const menu = page.getByRole('navigation', { name: 'Library' });
  await expect(menu.getByRole('link')).toHaveCount(6);
  await expect(menu.getByRole('link', { name: 'Study Buddy' })).toHaveAttribute('href', '/library/study-buddy');
  await expect(menu.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
});

test('members content: refused for a plain account, open to an enrolled family, and the page says why', async ({ page }) => {
  const email = await becomeMember(page, null);
  await page.goto('/library/dev-seed-quadratics');
  await expect(page.getByText('included for students enrolled with LearnThrive')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download PDF' })).toHaveCount(0);
  const refused = await page.request.post('/api/library/download/dev-seed-quadratics');
  expect(refused.status()).toBe(403);
  expect((await refused.json()).code).toBe('no_access');

  // A form post that is refused comes back to the page with a reason, not to a blank JSON page.
  const back = await page.request.post('/api/library/download/dev-seed-quadratics', { headers: { accept: 'text/html' }, maxRedirects: 0 });
  expect(back.status()).toBe(303);
  expect(back.headers().location).toBe('/library/dev-seed-quadratics?download=no_access');
  await page.goto('/library/dev-seed-quadratics?download=no_access');
  await expect(page.getByRole('alert')).toContainText('does not include this resource');
  await page.goto('/library/dev-seed-quadratics?download=%3Cscript%3E');
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);

  expect((await page.request.post('/api/dev/library-seed', { data: { action: 'enrol', email } })).ok()).toBe(true);
  await page.goto('/library/dev-seed-quadratics');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  expect(download.suggestedFilename()).toBe('dev-seed-quadratics-v1.pdf');
  expect(readFileSync(await download.path()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('a subscription or an administrator grant opens members content too', async ({ page }) => {
  for (const how of ['subscribe', 'grant'] as const) {
    await becomeMember(page, how);
    const response = await page.request.post('/api/library/download/dev-seed-cells');
    expect(response.status(), how).toBe(200);
    expect(response.headers()['content-type']).toBe('application/pdf');
    expect(response.headers()['cache-control']).toBe('private, no-store');
    await page.request.post('/api/account/logout', { data: {} });
  }
});

test('the catalogue pages have no horizontal scroll at 360px and are axe clean', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ['/library', '/library/search?q=fractions', '/library/subject/maths', '/library/free-samples', '/library/dev-seed-quadratics']) {
    await page.goto(path);
    await hydrated(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${path} overflows`).toBe(true);
    await expectAxeClean(page, path);
  }
});

test('the Library terms exist in development but say plainly that they are a draft, and are not indexed', async ({ page }) => {
  await page.goto('/library/terms');
  await expect(page.getByRole('heading', { level: 1, name: 'Library terms and content licence' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Draft for the owners and a legal reviewer');
  await expect(page.locator('main')).toContainText('[OWNER TO CONFIRM');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});
