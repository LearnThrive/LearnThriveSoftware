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
  await page.goto('/dashboard/admin/people');
  // .people-list matches three separate <ul>s on this page (Tutors/Clients/Students) — assert
  // against the whole page container instead of the ambiguous class selector.
  await expect(page.locator('.dashboard-page')).toContainText('Jamie Patel');
  await expect(page.locator('.dashboard-page')).toContainText('Sarah Ahmed');
  await expect(page.locator('.dashboard-page')).toContainText('Ayaan Ahmed');

  await page.goto('/dashboard/admin/assignments');
  await expect(page.locator('.dashboard-page')).toContainText('GCSE Mathematics');
});

test('Admin can add a new Tutor, who then appears in the list', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/dashboard/admin/people');
  // Three "Add" forms (Tutor/Client/Student) share label text ("Name", "Email") on this one
  // page, so getByLabel() alone is ambiguous — anchor to this form's own field ids instead.
  await page.locator('summary', { hasText: 'Add Tutor' }).click();
  await page.locator('#tutor-name').fill('Priya Sharma');
  await page.locator('#tutor-email').fill('priya.sharma@example.test');
  await page.locator('#tutor-subjects').fill('Science, Chemistry');
  await page.getByRole('button', { name: 'Add Tutor' }).click();

  await expect(page).toHaveURL(/\/dashboard\/admin\/people$/);
  await expect(page.locator('.dashboard-page')).toContainText('Priya Sharma');
});

test('a new Tuition Assignment appears in the list and on the Tutor profile', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/dashboard/admin/assignments');
  // The create form is inside a <details> collapsed by default once at least one assignment
  // exists (the seed data already has one) — open it before interacting with its fields.
  await page.locator('summary', { hasText: 'Create Tuition Assignment' }).click();
  await page.getByLabel('Title').fill('Year 8 Science — Ayaan');
  await page.getByLabel('Subject').fill('Science');
  await page.getByLabel('Tutor').selectOption({ label: 'Jamie Patel' });
  await page.getByLabel('Student(s)').selectOption({ label: 'Ayaan Ahmed' });
  await page.getByRole('button', { name: 'Create Assignment' }).click();

  await expect(page).toHaveURL(/\/dashboard\/admin\/assignments$/);
  await expect(page.locator('.people-list')).toContainText('Year 8 Science — Ayaan');
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
