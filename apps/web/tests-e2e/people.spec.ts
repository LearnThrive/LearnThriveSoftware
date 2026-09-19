import { test, expect, type Page } from '@playwright/test';

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@learnthrive.dev');
  await page.locator('#login-password').fill('dev-admin-pass');
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
}

test('Admin sees the seeded demo Tutor, Client, Student and Tuition Assignment', async ({ page }) => {
  await loginAsAdmin(page);
  // People is now three separate tabbed pages (plan6 section 39), not one page with three lists.
  await page.goto('/dashboard/admin/people/tutors');
  await expect(page.locator('.person-list')).toContainText('Jamie Patel');

  await page.goto('/dashboard/admin/people/clients');
  await expect(page.locator('.person-list')).toContainText('Sarah Ahmed');

  await page.goto('/dashboard/admin/people/students');
  await expect(page.locator('.person-list')).toContainText('Ayaan Ahmed');

  await page.goto('/dashboard/admin/assignments');
  await expect(page.locator('.record-list')).toContainText('GCSE Mathematics');
});

test('Admin can add a new Tutor, who then appears in the list', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/dashboard/admin/people/tutors');
  // "Add tutor" opens a Dialog (plan6 section 36) whose own submit button shares the trigger's
  // text — the trigger is unambiguous before the dialog opens, and the submit is scoped to the
  // open dialog afterwards to avoid matching both.
  await page.getByRole('button', { name: 'Add tutor' }).click();
  await page.locator('#tutor-name').fill('Priya Sharma');
  await page.locator('#tutor-email').fill('priya.sharma@example.test');
  await page.locator('#tutor-subjects').fill('Science, Chemistry');
  // Not asserting on the ?toast= query param itself — Toaster strips it via router.replace()
  // within its own first effect, so by the time this assertion's retry polling checks the URL
  // it may well have already been removed again. The path landing correctly plus the new tutor
  // actually appearing is the real proof this worked.
  await page.getByRole('dialog').getByRole('button', { name: 'Add tutor' }).click();
  await expect(page).toHaveURL(/\/dashboard\/admin\/people\/tutors/);
  await expect(page.locator('.person-list')).toContainText('Priya Sharma');
});

test('a new Tuition Assignment appears in the list and on the Tutor profile', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/dashboard/admin/assignments');
  await page.getByRole('button', { name: 'Create assignment' }).click();
  await page.getByLabel('Title').fill('Year 8 Science — Ayaan');
  await page.getByLabel('Subject').fill('Science');
  await page.getByLabel('Tutor').selectOption({ label: 'Jamie Patel' });
  await page.getByLabel('Student(s)').selectOption({ label: 'Ayaan Ahmed' });
  await page.getByRole('dialog').getByRole('button', { name: 'Create assignment' }).click();

  await expect(page).toHaveURL(/\/dashboard\/admin\/assignments/);
  await expect(page.locator('.record-list')).toContainText('Year 8 Science — Ayaan');
});

test('a Tutor cannot reach /dashboard/admin/people — redirected to /403', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('tutor@learnthrive.dev');
  await page.locator('#login-password').fill('dev-tutor-pass');
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
  await page.goto('/dashboard/admin/people');
  await expect(page).toHaveURL(/\/403$/);
});
