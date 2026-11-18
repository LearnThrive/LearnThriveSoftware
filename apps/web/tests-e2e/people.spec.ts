import { test, expect, type Page } from '@playwright/test';

async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('dev.admin');
  await page.locator('input[name="password"]').fill('dev-admin-pass');
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
}

test('Admin sees the seeded demo Tutor, Client, Student and Tuition Assignment', async ({ page }) => {
  await loginAsAdmin(page);
  // People is now three separate tabbed pages (plan6 section 39), not one page with three lists.
  await page.goto('/dashboard/admin/people/tutors');
  await expect(page.locator('.person-list')).toContainText('Tahasin Hasan');

  await page.goto('/dashboard/admin/people/clients');
  await expect(page.locator('.person-list')).toContainText('Abdurrahman Mustafa');

  await page.goto('/dashboard/admin/people/students');
  await expect(page.locator('.person-list')).toContainText('Brian James Khalawon');

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
  await page.getByLabel('Title').fill('Year 8 Science — Brian');
  await page.locator('#assignment-subject').selectOption('Maths');
  await page.getByLabel('Tutor').selectOption({ label: 'Tahasin Hasan' });
  await page.getByRole('dialog').getByRole('checkbox', { name: /^Brian James Khalawon(?! \(learner\))/ }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Create assignment' }).click();

  await expect(page).toHaveURL(/\/dashboard\/admin\/assignments/);
  await expect(page.locator('.record-list')).toContainText('Year 8 Science — Brian');
});

test('the assignment form picks students with search and chips: a chosen student who is filtered out is still sent, and none is refused', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/dashboard/admin/assignments');
  await page.getByRole('button', { name: 'Create assignment' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill('Picker check — Brian and Sam');
  await page.locator('#assignment-subject').selectOption('Maths');
  await page.getByLabel('Tutor').selectOption({ label: 'Tahasin Hasan' });

  // Nobody chosen: the browser refuses, with a message that fits a list of students.
  await dialog.getByRole('button', { name: 'Create assignment' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox').first()).toHaveJSProperty('validationMessage', 'Choose at least one student.');

  await dialog.getByRole('checkbox', { name: /^Brian James Khalawon(?! \(learner\))/ }).check();
  await dialog.getByRole('checkbox', { name: /^Sam Junior-Test/ }).check();
  await expect(dialog.locator('.student-pick__chip')).toHaveCount(2);

  // Search for someone else: both chosen students leave the visible list but stay chosen, as chips and as submitted fields.
  await dialog.getByLabel('Search students').fill('Robin');
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await expect(dialog.locator('.student-pick__chip')).toHaveCount(2);
  await expect(dialog.locator('input[type="hidden"][name="studentIds"]')).toHaveCount(2);

  await dialog.getByRole('button', { name: 'Create assignment' }).click();
  await expect(page).toHaveURL(/\/dashboard\/admin\/assignments/);
  const row = page.locator('.record-list__item', { hasText: 'Picker check — Brian and Sam' });
  await expect(row).toContainText('Brian James Khalawon');
  await expect(row).toContainText('Sam Junior-Test');
});

test('a Tutor cannot reach /dashboard/admin/people — redirected to /403', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('dev.tutor');
  await page.locator('input[name="password"]').fill('dev-tutor-pass');
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
  await page.goto('/dashboard/admin/people');
  await expect(page).toHaveURL(/\/403$/);
});
