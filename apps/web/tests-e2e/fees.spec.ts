import { expect, test, type Page } from '@playwright/test';
import { distinctVisitor, hydrated } from './account-support';

// Launching without Stripe (14 Nov 2026): parents pay by bank transfer. An administrator writes how to pay, a parent reads it on their Fees
// page, and nobody else can see a family's money. Runs on the dev server's in-memory backend; the statement arithmetic itself is proved in
// packages/data and tests/tuitionBillingAccess.test.mjs.

distinctVisitor();

const INSTRUCTIONS = 'Pay LearnThrive Tuition Ltd by bank transfer.\nQuote your invoice number as the reference.';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await hydrated(page);
  await page.getByLabel('Username').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 30_000 });
}

async function signOut(page: Page) {
  await page.request.post('/api/account/logout', { data: {} });
}

/** A page a person may not see answers with the not-found or refusal page but an HTTP 200 (the shell streams first), so read what it says. */
async function expectRefused(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/don.t have access|not found|can.t be found/i, { timeout: 30_000 });
}

test('an administrator writes how to pay; the parent reads it on their Fees page; a tutor and a learner cannot open it', async ({ page }) => {
  test.setTimeout(150_000);

  await signIn(page, 'dev.admin', 'dev-admin-pass');
  await page.goto('/dashboard/admin/billing/settings');
  await expect(page.getByText('A tutor waits 15 minutes from the scheduled start')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Lessons are paused once a family is more than a month overdue')).toBeVisible();
  await page.getByLabel('How parents pay').fill(INSTRUCTIONS);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Billing rules saved')).toBeVisible({ timeout: 30_000 });
  await signOut(page);

  await signIn(page, 'dev.client', 'dev-client-pass');
  await expect(page.getByRole('link', { name: 'Fees' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'Fees' }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fees', { timeout: 30_000 });
  await expect(page.getByText('Pay LearnThrive Tuition Ltd by bank transfer.')).toBeVisible();
  await expect(page.getByText('Quote your invoice number as the reference.')).toBeVisible();
  await expect(page.getByText('Statements', { exact: true })).toBeVisible();
  // A parent never sees the administrator's screens, or the family list.
  await expectRefused(page, '/dashboard/admin/billing');
  await expectRefused(page, '/dashboard/admin/billing/client-sarah-ahmed');
  await signOut(page);

  for (const [username, password] of [['dev.tutor', 'dev-tutor-pass'], ['dev.student', 'dev-student-pass']] as const) {
    await signIn(page, username, password);
    await expect(page.getByRole('link', { name: 'Fees' })).toHaveCount(0);
    await expectRefused(page, '/dashboard/billing');
    await expectRefused(page, '/dashboard/admin/billing');
    await signOut(page);
  }

  // The export downloads answer an administrator only: a parent, a tutor and a signed-out visitor are told nothing.
  for (const who of [null, ['dev.tutor', 'dev-tutor-pass'], ['dev.client', 'dev-client-pass']] as const) {
    if (who) await signIn(page, who[0], who[1]);
    const response = await page.request.get('/api/admin/billing/export?kind=payments');
    expect(response.status(), who ? who[0] : 'signed out').toBe(404);
    if (who) await signOut(page);
  }
  await signIn(page, 'dev.admin', 'dev-admin-pass');
  const ok = await page.request.get('/api/admin/billing/export?kind=payments');
  expect(ok.status()).toBe(200);
  expect(ok.headers()['content-type']).toContain('text/csv');
  expect(ok.headers()['cache-control']).toContain('no-store');
  expect((await ok.text()).replace(/^﻿/, '')).toContain('Received on,Family,Amount,Method,Note');
});

test('the pay run shows what each tutor is owed and needs an administrator', async ({ page }) => {
  await signIn(page, 'dev.admin', 'dev-admin-pass');
  await page.goto('/dashboard/admin/billing/tutor-pay?period=2026-10');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tutor pay for October 2026', { timeout: 30_000 });
  await expect(page.getByText('Paid from the business account on the 15th of the next month')).toBeVisible();
  const csv = await page.request.get('/api/admin/billing/export?kind=tutor-pay&period=2026-10');
  expect(csv.status()).toBe(200);
  expect((await csv.text()).replace(/^﻿/, '')).toContain('Tutor,Period,Lesson date,Lesson,Minutes,Hourly pay,Amount');
  expect((await page.request.get('/api/admin/billing/export?kind=tutor-pay')).status(), 'a month is required').toBe(400);
  expect((await page.request.get('/api/admin/billing/export?kind=nonsense')).status()).toBe(404);
  await signOut(page);

  await signIn(page, 'dev.tutor', 'dev-tutor-pass');
  await expectRefused(page, '/dashboard/admin/billing/tutor-pay');
});

test('an administrator pauses an overdue family\'s lessons with a reason, and resumes them; a tutor cannot', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'dev.admin', 'dev-admin-pass');
  await page.goto('/dashboard/admin/billing/client-sarah-ahmed');
  await expect(page.getByText('No assignment is paused.')).toBeVisible({ timeout: 30_000 });
  try {
    // A pause needs a reason: without one it is refused and nothing changes.
    await page.locator('#pause-reason').evaluate((el: HTMLInputElement) => { el.required = false; el.minLength = 0; });
    await page.getByRole('button', { name: /Pause this family.s lessons/ }).click();
    await expect(page.getByText('Say why the lessons are being paused.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('No assignment is paused.')).toBeVisible();

    await page.locator('#pause-reason').fill('Payment more than a month overdue, parent contacted by phone');
    await page.getByRole('button', { name: /Pause this family.s lessons/ }).click();
    await expect(page.getByText('Lessons paused')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/of this family.s assignments are paused/)).toBeVisible();
  } finally {
    await page.goto('/dashboard/admin/billing/client-sarah-ahmed');
    const resume = page.getByRole('button', { name: /Resume this family.s lessons/ });
    if (await page.getByText(/of this family.s assignments are paused/).isVisible()) {
      await resume.click();
      await expect(page.getByText('Lessons resumed')).toBeVisible({ timeout: 30_000 });
    }
  }
  await expect(page.getByText('No assignment is paused.')).toBeVisible();
  await signOut(page);

  await signIn(page, 'dev.tutor', 'dev-tutor-pass');
  await expectRefused(page, '/dashboard/admin/billing/client-sarah-ahmed');
});
