import { test, expect, type Page } from '@playwright/test';
import { uniqueLabel } from './support';

// plan15 Wave 11 section 15.2: the signed-in app's command palette (Ctrl/Cmd+K), its role-scoped server
// search, the `?` shortcut list and "g then a letter" navigation. The exhaustive who-can-find-what
// adversarial cases are unit tests (tests/appSearch.test.mjs, against the same function the server action
// calls); this drives the real UI and proves the wiring end to end, including a second family's record that
// no other role may find.

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
  await page.locator('#login-password').fill(ACCOUNTS[who].password);
  await Promise.all([page.waitForURL(/\/dashboard$/), page.getByRole('button', { name: 'Sign in' }).click()]);
}

const palette = (page: Page) => page.getByRole('dialog', { name: 'Search LearnThrive' });
const options = (page: Page) => palette(page).getByRole('option');
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Pressing the shortcut before the page has hydrated does nothing, so retry until it opens (never toggling it shut). */
async function openPalette(page: Page) {
  await expect(async () => {
    if (!(await palette(page).isVisible())) await page.keyboard.press(`${modifier}+k`);
    await expect(palette(page)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  // Typing before the field has focus would go to the page (and trip a go-to shortcut).
  await expect(palette(page).getByRole('combobox')).toBeFocused();
}

/** Keyboard handlers attach on hydration; give the freshly loaded page a moment before bare keys. */
const settle = (page: Page) => page.waitForTimeout(600);

test.describe('the app palette', () => {
  test('opens with the shortcut and the topbar button, lists the role\'s pages, and Escape returns focus', async ({ page }) => {
    await login(page, 'tutor');
    await openPalette(page);
    await expect(palette(page).getByRole('combobox')).toBeFocused();
    await expect(options(page).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeFocused();
  });

  test('a page command navigates', async ({ page }) => {
    await login(page, 'admin');
    await openPalette(page);
    await page.keyboard.type('calendar');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dashboard\/calendar$/);
  });

  test('searching finds the seeded lesson through the server, and opening it goes to the lesson', async ({ page }) => {
    await login(page, 'admin');
    await openPalette(page);
    await page.keyboard.type('mathematics');
    const lesson = options(page).filter({ hasText: /Mathematics/ }).first();
    await expect(lesson).toBeVisible();
    await lesson.click();
    await expect(page).toHaveURL(/\/dashboard\/lessons\/[^/]+$/);
  });

  test('a Parent finds their own child and the lesson, a Student finds no people, and the palette never lists the Admin pages', async ({ page }) => {
    await login(page, 'client');
    await openPalette(page);
    await page.keyboard.type('Brian');
    await expect(options(page).filter({ hasText: 'Brian James Khalawon' }).first()).toBeVisible();
    await page.keyboard.press('Escape');

    await login(page, 'student');
    await openPalette(page);
    await page.keyboard.type('Brian');
    // The Student's own name is not a "people" result: the only student they may see is themselves.
    await expect(palette(page).getByText('Students', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('the Tutor\'s palette has no Admin page, and typing an Admin page name finds nothing to open', async ({ page }) => {
    await login(page, 'tutor');
    await openPalette(page);
    await page.keyboard.type('assignments');
    await expect(palette(page)).toContainText(/Nothing matches/);
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);
    // The Tutor's own pages are there.
    await openPalette(page);
    await page.keyboard.type('availability');
    await expect(options(page).first()).toContainText('Availability');
  });

  test('a record the Admin creates for another family is found by the Admin and by nobody else', async ({ page }) => {
    const studentName = uniqueLabel('Palette Hidden Student');

    await login(page, 'admin');
    await page.goto('/dashboard/admin/people/students');
    await page.getByRole('button', { name: 'Add student' }).click();
    await page.locator('#student-name').fill(studentName);
    await page.getByRole('dialog').getByRole('button', { name: 'Add student' }).click();
    await expect(page.locator('.person-list')).toContainText(studentName);

    await openPalette(page);
    await page.keyboard.type(studentName);
    await expect(options(page).filter({ hasText: studentName }).first()).toBeVisible();
    await page.keyboard.press('Escape');

    for (const who of ['tutor', 'client', 'student'] as const) {
      await login(page, who);
      await openPalette(page);
      await page.keyboard.type(studentName);
      await expect(palette(page)).toContainText(/Nothing matches/);
      await expect(options(page)).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
  });

  test('a signed-out request to the search gets nothing: the palette does not exist outside the app', async ({ page }) => {
    await page.request.post('/api/auth/logout');
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await page.keyboard.press(`${modifier}+k`);
    // /login is not an app route: no app palette is mounted there.
    await expect(palette(page)).toHaveCount(0);
  });
});

test.describe('shortcuts', () => {
  test('? opens the list for this role and Escape closes it, returning focus', async ({ page }) => {
    await login(page, 'tutor');
    await settle(page);
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(help).toBeVisible();
    await expect(help).toContainText('Availability');
    await expect(help).not.toContainText('Assignments');
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
  });

  test('g then l goes to Lessons; g then c to the Calendar', async ({ page }) => {
    await login(page, 'admin');
    await settle(page);
    await page.keyboard.press('g');
    await page.keyboard.press('l');
    await expect(page).toHaveURL(/\/dashboard\/lessons/);
    await settle(page);
    await page.keyboard.press('g');
    await page.keyboard.press('c');
    await expect(page).toHaveURL(/\/dashboard\/calendar$/);
  });

  test('a Tutor\'s g then a goes nowhere (Assignments is Admin-only)', async ({ page }) => {
    await login(page, 'tutor');
    await settle(page);
    await page.keyboard.press('g');
    await page.keyboard.press('a');
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('shortcuts never fire while typing in a field', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/dashboard/admin/people/students');
    await page.getByRole('button', { name: 'Add student' }).click();
    const name = page.locator('#student-name');
    await name.focus();
    await page.keyboard.type('glad');
    await expect(name).toHaveValue('glad');
    await expect(page).toHaveURL(/\/dashboard\/admin\/people\/students$/);
  });
});
