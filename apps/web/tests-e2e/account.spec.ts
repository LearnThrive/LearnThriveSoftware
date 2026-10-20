import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { humanCheckDone, hydrated } from './careers-support';

// plan19 phase C: sign-up with email confirmation, sign-in, sign-out, the password reset, and what the browser keeps.
// Runs against the dev server, where the account backend is the in-memory one: the "emails" are read from
// /api/dev/account-outbox (a 404 in production). No real email, Supabase or Stripe is involved.

const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const WCAG22 = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const PASSWORD = 'correct horse battery staple';
const ACCESS = 'learnthrive_acct';

async function expectAxeClean(page: Page, label: string) {
  // The shell fades in; axe measures contrast against whatever is on screen, so let the entrance finish first.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  await page.addScriptTag({ content: AXE_SOURCE });
  const results = (await page.evaluate(async (tags) => {
    // @ts-expect-error injected global, no types installed for the browser build
    return await window.axe.run(document, { runOnly: { type: 'tag', values: tags } });
  }, WCAG22)) as { violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[] }> }> };
  const lines = results.violations.map((v) => `[${v.impact}] ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`);
  expect(results.violations, `${label}: ${results.violations.length} violation(s)\n\n${lines.join('\n\n')}`).toEqual([]);
}

// The server rate-limits by visitor address (5 sign-ups an hour), and every test here comes from localhost. A made-up
// forwarded address per test gives each its own bucket, as separate visitors would have.
let visitor = 0;
test.beforeEach(async ({ context }) => {
  visitor += 1;
  const { workerIndex, retry } = test.info();
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': `198.51.100.${(workerIndex * 40 + retry * 20 + visitor) % 250 + 1}, 10.0.0.1` });
});

/** One address per test attempt: the in-memory backend lives as long as the dev server. */
function address(): string {
  const { workerIndex, retry } = test.info();
  return `family-${Date.now()}-${workerIndex}-${retry}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function link(page: Page, to: string, kind: 'signup' | 'recovery'): Promise<string> {
  const response = await page.request.get(`/api/dev/account-outbox?to=${encodeURIComponent(to)}`);
  expect(response.ok()).toBe(true);
  const { messages } = (await response.json()) as { messages: Array<{ kind: string; tokenHash: string }> };
  const last = messages.filter((m) => m.kind === kind).at(-1);
  expect(last, `a ${kind} email for ${to}`).toBeTruthy();
  return `/account/confirm?token_hash=${last!.tokenHash}&type=${kind}`;
}

async function signUp(page: Page, email: string) {
  await page.goto('/account/sign-up');
  await hydrated(page);
  const card = page.locator('[data-auth-mode]');
  await card.getByLabel('Email', { exact: true }).fill(email);
  await card.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await card.getByRole('checkbox', { name: /18 or over/ }).check();
  await humanCheckDone(page);
  await card.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
}

async function confirm(page: Page, email: string) {
  await page.goto(await link(page, email, 'signup'));
  await hydrated(page);
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(page).toHaveURL(/\/account$/);
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/account/sign-in');
  await hydrated(page);
  const card = page.locator('[data-auth-mode]');
  await card.getByLabel('Email', { exact: true }).fill(email);
  await card.getByLabel('Password', { exact: true }).fill(password);
  await card.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('a visitor to the public Library page holds no cookie and nothing in storage', async ({ page }) => {
  await page.goto('/library');
  await hydrated(page);
  expect(await page.context().cookies()).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('sign up, confirm by email, sign out, sign in again', async ({ page }) => {
  const email = address();
  await signUp(page, email);
  expect((await page.context().cookies()).find((c) => c.name === ACCESS)).toBeUndefined();

  // Opening the emailed link spends nothing: a mail scanner can open it first. Only the button does.
  const url = await link(page, email, 'signup');
  await page.goto(url);
  await page.goto(url);
  await hydrated(page);
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  await expectAxeClean(page, 'confirm');
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expectAxeClean(page, 'account');

  const cookies = await page.context().cookies();
  const access = cookies.find((c) => c.name === ACCESS);
  expect(access, 'the session cookie').toBeTruthy();
  expect(access!.httpOnly).toBe(true);
  expect(access!.sameSite).toBe('Lax');
  expect(access!.expires, 'a session cookie, not a persistent one').toBe(-1);
  expect(await page.evaluate(() => document.cookie)).toBe('');
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);

  // The link is one use.
  await page.goto(url);
  await hydrated(page);
  await page.getByRole('button', { name: 'Confirm my email' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('expired or has already been used');

  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/library$/);
  expect((await page.context().cookies()).find((c) => c.name === ACCESS)).toBeUndefined();

  await page.goto('/account');
  await expect(page).toHaveURL(/\/account\/sign-in\?next=%2Faccount$/);

  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  expect((await page.request.get('/api/account/me')).status()).toBe(200);
});

test('sign-in refuses an unconfirmed address, a wrong password and an unknown address in words that reveal nothing', async ({ page }) => {
  const email = address();
  await signUp(page, email);

  await signIn(page, email);
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await confirm(page, email);
  await page.request.post('/api/account/logout', { data: {} });

  await signIn(page, email, 'a wrong password here');
  const alert = page.locator('main').getByRole('alert');
  await expect(alert).toContainText('Email or password is not right.');
  const wrong = await alert.innerText();
  await signIn(page, address());
  await expect(alert).toContainText('Email or password is not right.');
  expect(await alert.innerText()).toBe(wrong);
  expect((await page.context().cookies()).find((c) => c.name === ACCESS)).toBeUndefined();
});

test('forgot password: a reset link, a new password, the old one stops working', async ({ page }) => {
  const email = address();
  await signUp(page, email);
  await confirm(page, email);
  await page.request.post('/api/account/logout', { data: {} });

  await page.goto('/account/forgot');
  await hydrated(page);
  await expectAxeClean(page, 'forgot');
  const card = page.locator('[data-auth-mode]');
  await card.getByLabel('Email', { exact: true }).fill(email);
  await humanCheckDone(page);
  await card.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await page.goto(await link(page, email, 'recovery'));
  await hydrated(page);
  await page.getByRole('button', { name: 'Choose a new password' }).click();
  await expect(page).toHaveURL(/\/account\/reset$/);
  await expectAxeClean(page, 'reset');
  await page.getByLabel('New password', { exact: true }).fill('a brand new long password');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('Your password has been changed.')).toBeVisible();

  await page.request.post('/api/account/logout', { data: {} });
  await signIn(page, email, PASSWORD);
  await expect(page.locator('main').getByRole('alert')).toContainText('Email or password is not right.');
  await signIn(page, email, 'a brand new long password');
  await expect(page).toHaveURL(/\/account$/);
});

test('sign-up checks the form before and after the server', async ({ page }) => {
  await page.goto('/account/sign-up');
  await hydrated(page);
  const card = page.locator('[data-auth-mode]');
  await card.getByRole('button', { name: 'Create account' }).click();
  await expect(card.getByRole('alert')).toContainText('things to check');
  await card.getByLabel('Email', { exact: true }).fill('not-an-address');
  await card.getByLabel('Password', { exact: true }).fill('short');
  await card.getByRole('button', { name: 'Create account' }).click();
  await expect(card.getByRole('alert')).toContainText('3 things to check');
});

test('the account pages are axe clean and have no horizontal scroll at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of ['/account/sign-in', '/account/sign-up', '/account/forgot', '/account/confirm?token_hash=bad&type=signup']) {
    await page.goto(path);
    await hydrated(page);
    await expectAxeClean(page, path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${path} overflows`).toBe(true);
  }
});

test('the API answers a signed-out caller with 401 and refuses a cross-site post', async ({ page }) => {
  expect((await page.request.get('/api/account/me')).status()).toBe(401);
  const cross = await page.request.post('/api/account/login', { data: { email: 'a@example.com', password: 'x' }, headers: { origin: 'https://evil.example' } });
  expect(cross.status()).toBe(403);
});

test('a signed-in page sends a signed-out visitor to sign-in and back, and an open redirect is refused', async ({ page }) => {
  await page.goto('/account/sign-in?next=//evil.example/x');
  await hydrated(page);
  const email = address();
  await signUp(page, email);
  await confirm(page, email);
  await page.request.post('/api/account/logout', { data: {} });
  await page.goto('/account/sign-in?next=https://evil.example');
  const card = page.locator('[data-auth-mode]');
  await card.getByLabel('Email', { exact: true }).fill(email);
  await card.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await card.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/localhost:3100\/account$/);
});
