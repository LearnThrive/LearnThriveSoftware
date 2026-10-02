import { test, expect, type Page } from '@playwright/test';

// plan15 Wave 11 feature A3 (the motion preference) and A7 (the report approval default). The motion choice
// is System or Reduce, kept in this browser only, applied before first paint, and Reduce always wins.

const html = (page: Page) => page.locator('html');
const motionGroup = (page: Page) => page.getByRole('group', { name: 'Motion' }).last();
const motionRadios = (page: Page) => motionGroup(page).getByRole('radio');

/** The footer's group is the public site's control (like the theme spec, the radio itself is checked). */
async function chooseMotion(page: Page, choice: 'System' | 'Reduce') {
  const group = motionGroup(page);
  await group.scrollIntoViewIfNeeded();
  await group.getByLabel(choice === 'Reduce' ? 'Reduce motion' : 'follow my device').check({ force: true });
}

test.describe('the motion preference', () => {
  test('Reduce is chosen in the footer, applies at once, survives a reload and shows no motion tier', async ({ page }) => {
    await page.goto('/about');
    await expect(html(page)).not.toHaveAttribute('data-motion', /.+/);
    await chooseMotion(page, 'Reduce');
    await expect(html(page)).toHaveAttribute('data-motion', 'reduce');
    await expect(html(page)).toHaveAttribute('data-motion-tier', 'reduced');
    expect(await page.evaluate(() => localStorage.getItem('lt-motion'))).toBe('reduce');
    await page.reload();
    await expect(html(page)).toHaveAttribute('data-motion', 'reduce');
    await expect(html(page)).toHaveAttribute('data-motion-tier', 'reduced');
  });

  test('the choice is applied before first paint: it is on <html> as soon as the document is parsed', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lt-motion', 'reduce'));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-motion'))).toBe('reduce');
  });

  test('under Reduce, CSS transitions and animations complete at once (the blanket rule applies)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lt-motion', 'reduce'));
    await page.goto('/book');
    const duration = await page.locator('.button--primary, .button').first().evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration.split(',').every((d) => parseFloat(d) <= 0.00001)).toBe(true);
  });

  test('System removes the key and the attribute again', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lt-motion', 'reduce'));
    await page.goto('/about');
    await chooseMotion(page, 'System');
    await expect(html(page)).not.toHaveAttribute('data-motion', /.+/);
    expect(await page.evaluate(() => localStorage.getItem('lt-motion'))).toBeNull();
    await expect(html(page)).not.toHaveAttribute('data-motion-tier', 'reduced');
  });

  test('there are two choices only: no way to override the device\'s own reduced-motion setting', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/about');
    await expect(motionRadios(page)).toHaveCount(2);
    await expect(page.getByText(/full motion/i)).toHaveCount(0);
    // The device says reduce and the choice is System: still reduced.
    await expect(html(page)).toHaveAttribute('data-motion-tier', 'reduced');
    // Choosing System does not undo the device setting.
    await chooseMotion(page, 'System');
    await expect(html(page)).toHaveAttribute('data-motion-tier', 'reduced');
  });

  test('a stored value other than "reduce" does nothing', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lt-motion', 'full'));
    await page.goto('/about');
    await expect(html(page)).not.toHaveAttribute('data-motion', /.+/);
  });
});

const ACCOUNTS = {
  admin: { email: 'admin@learnthrive.dev', password: 'dev-admin-pass' },
  tutor: { email: 'tutor@learnthrive.dev', password: 'dev-tutor-pass' },
} as const;

async function login(page: Page, who: keyof typeof ACCOUNTS) {
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByLabel('Email').fill(ACCOUNTS[who].email);
  await page.locator('#login-password').fill(ACCOUNTS[who].password);
  await Promise.all([page.waitForURL(/\/dashboard$/), page.getByRole('button', { name: 'Sign in' }).click()]);
}

test.describe('settings', () => {
  test('every role has the appearance and motion card, and it works inside the app', async ({ page }) => {
    await login(page, 'tutor');
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'Appearance and motion' })).toBeVisible();
    await chooseMotion(page, 'Reduce');
    await expect(html(page)).toHaveAttribute('data-motion', 'reduce');
    await chooseMotion(page, 'System');
    await expect(html(page)).not.toHaveAttribute('data-motion', /.+/);
  });

  test('only an Admin sees the report approval default, and can change it (and change it back)', async ({ page }) => {
    await login(page, 'tutor');
    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'Report approval' })).toHaveCount(0);

    await login(page, 'admin');
    await page.goto('/dashboard/settings');
    const card = page.locator('section.card', { has: page.getByRole('heading', { name: 'Report approval' }) });
    await expect(card).toContainText('Approval required');

    await card.getByRole('button', { name: 'Change default' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change the report approval default?' });
    await dialog.getByLabel(/as soon as the tutor submits/).check();
    await dialog.getByRole('button', { name: 'Save default' }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings/);
    await expect(card).toContainText('Shared straight away');

    // Put it back so the shared dev data is as the other suites expect.
    await card.getByRole('button', { name: 'Change default' }).click();
    await page.getByRole('dialog', { name: 'Change the report approval default?' }).getByLabel(/An admin approves each report/).check();
    await page.getByRole('dialog', { name: 'Change the report approval default?' }).getByRole('button', { name: 'Save default' }).click();
    await expect(card).toContainText('Approval required');
  });
});
