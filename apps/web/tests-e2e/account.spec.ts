import { test, expect } from '@playwright/test';
import { hydrated, humanCheckDone } from './careers-support';
import { ACCESS, PASSWORD, address, confirm, distinctVisitor, expectAxeClean, link, signIn, signUp } from './account-support';

// plan19 phase C: sign-up with email confirmation, sign-in, sign-out, the password reset, and what the browser keeps.
// Runs against the dev server, where the account backend is the in-memory one (see account-support.ts). No real
// email, Supabase or Stripe is involved.

distinctVisitor();

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
  await expect(page).toHaveURL(/\/login\?next=%2Faccount$/);

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
  for (const path of ['/login', '/account/sign-up', '/account/forgot', '/account/confirm?token_hash=bad&type=signup']) {
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
  await page.goto('/login?next=//evil.example/x');
  await hydrated(page);
  const email = address();
  await signUp(page, email);
  await confirm(page, email);
  await page.request.post('/api/account/logout', { data: {} });
  await page.goto('/login?next=https://evil.example');
  const card = page.locator('[data-auth-mode]');
  await card.getByLabel('Email', { exact: true }).fill(email);
  await card.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await card.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/localhost:3100\/account$/);
});

test('the Library\'s old sign-in address leads to the one sign-in and keeps a safe next page', async ({ page }) => {
  await page.goto('/account/sign-in');
  await expect(page).toHaveURL(/localhost:3100\/login$/);
  await page.goto('/account/sign-in?next=/library/search');
  await expect(page).toHaveURL(/\/login\?next=%2Flibrary%2Fsearch$/);
  await page.goto('/account/sign-in?next=https://evil.example');
  await expect(page).toHaveURL(/localhost:3100\/login$/);
});
