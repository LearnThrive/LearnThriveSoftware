import { test, expect, type Page } from '@playwright/test';
import { uniqueLabel } from './support';

// plan15 features A5 (first-run tips), A6 (starting-soon reminders) and A8 (a parent's "this week"). The
// derivations and their visibility are unit tests (tests/derivedViews.test.mjs); this proves the pages.

const ACCOUNTS = {
  admin: { email: 'admin@learnthrive.dev', password: 'dev-admin-pass' },
  tutor: { email: 'tutor@learnthrive.dev', password: 'dev-tutor-pass' },
  client: { email: 'client@learnthrive.dev', password: 'dev-client-pass' },
  student: { email: 'student@learnthrive.dev', password: 'dev-student-pass' },
} as const;

async function login(page: Page, who: keyof typeof ACCOUNTS) {
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByLabel('Email').fill(ACCOUNTS[who].email);
  await page.locator('input[name="password"]').fill(ACCOUNTS[who].password);
  await Promise.all([page.waitForURL(/\/dashboard$/), page.getByRole('button', { name: 'Sign in' }).click()]);
}

test.describe('first-run tips', () => {
  for (const who of ['admin', 'tutor', 'client', 'student'] as const) {
    test(`${who}: the card shows below the dashboard, dismisses, and stays dismissed`, async ({ page }) => {
      await login(page, who);
      const card = page.getByRole('complementary', { name: 'Getting started' });
      await expect(card).toBeVisible();
      await expect(card.getByRole('listitem')).toHaveCount(3);
      // It is BELOW the page's own content, so it can never shift what is above it.
      const main = await page.locator('#main-content h1').first().boundingBox();
      const tips = await card.boundingBox();
      expect(tips!.y).toBeGreaterThan(main!.y);
      await card.getByRole('button', { name: 'Got it' }).click();
      await expect(card).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('learnthrive:getting-started'))).toBe('dismissed');
      await page.reload();
      await expect(page.getByRole('complementary', { name: 'Getting started' })).toHaveCount(0);
      await page.evaluate(() => localStorage.removeItem('learnthrive:getting-started'));
    });
  }

  test('the tips are role-specific: an Admin is not told about the tutor-only things, and vice versa', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByRole('complementary', { name: 'Getting started' })).toContainText('Create');
    await expect(page.getByRole('complementary', { name: 'Getting started' })).not.toContainText('availability');
    await login(page, 'tutor');
    await expect(page.getByRole('complementary', { name: 'Getting started' })).toContainText('availability');
    await expect(page.getByRole('complementary', { name: 'Getting started' })).not.toContainText('Create at the top');
  });
});

test.describe('a parent\'s week', () => {
  test('the Parent dashboard has a "This week" card with the two figures', async ({ page }) => {
    await login(page, 'client');
    const card = page.locator('section.card', { has: page.getByRole('heading', { name: 'This week' }) });
    await expect(card).toBeVisible();
    await expect(card.locator('.this-week__figure')).toHaveCount(2);
    await expect(card).toContainText(/lessons? coming up/);
    await expect(card).toContainText(/new reports?/);
  });

  test('no other role has it', async ({ page }) => {
    for (const who of ['tutor', 'student', 'admin'] as const) {
      await login(page, who);
      await expect(page.getByRole('heading', { name: 'This week' })).toHaveCount(0);
    }
  });
});

/** "Now plus N minutes" as the scheduling form wants it: a London date and a London time. */
function londonInMinutes(minutes: number) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(Date.now() + minutes * 60_000));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}` };
}

test.describe('starting soon', () => {
  test('a lesson within the hour shows as a reminder on the notifications page and a badge on the next-lesson card', async ({ page }) => {
    const title = uniqueLabel('Starting soon lesson');
    const when = londonInMinutes(35);

    await login(page, 'admin');
    await page.goto('/dashboard/admin/lessons/new');
    const assignment = page.getByLabel('Tuition Assignment');
    const label = (await assignment.locator('option', { hasText: 'GCSE Mathematics' }).first().textContent())!.trim();
    await assignment.selectOption({ label });
    await page.locator('#lesson-title').fill(title);
    await page.locator('#lesson-date').fill(when.date);
    await page.locator('#lesson-time').fill(when.time);
    await page.getByRole('button', { name: 'Schedule lesson' }).click();
    // Earlier suites leave lessons around the same hour; a clash is a warning the Admin confirms, not an error.
    const anyway = page.getByRole('button', { name: 'Schedule anyway' });
    await Promise.race([page.waitForURL(/\/dashboard\/calendar$/), anyway.waitFor()]).catch(() => undefined);
    if (await anyway.isVisible()) await anyway.click();
    await expect(page).toHaveURL(/\/dashboard\/calendar$/);

    for (const who of ['tutor', 'student'] as const) {
      await login(page, who);
      await page.goto('/dashboard/notifications');
      const card = page.locator('section.card', { has: page.getByRole('heading', { name: 'Starting soon' }) });
      await expect(card, who).toContainText(title);
      await expect(card, who).toContainText(/starts in \d+ minutes/);
      await expect(card, who).toContainText('does not send an email');
    }

    await login(page, 'tutor');
    await expect(page.locator('.next-lesson__eyebrow')).toContainText('Starting soon');
  });
});
