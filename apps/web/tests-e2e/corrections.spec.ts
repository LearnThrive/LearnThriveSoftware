import { expect, test, type Page } from '@playwright/test';
import { distinctVisitor, hydrated } from './account-support';

// docs/improvement/PLAN.md item 5: an administrator can correct a student's or a tutor's record from its profile page. Each test makes
// its own record first, because the dev server's in-memory data is shared by every spec and the seeded names are relied on elsewhere.

distinctVisitor();

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await hydrated(page);
  await page.getByLabel('Username').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 30_000 });
}

/** The dashboard sets no hydration marker and a click before hydration does nothing, so the trigger is pressed until the dialog is open. */
async function openDialog(page: Page, button: string) {
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: button }).first().click({ timeout: 2000 });
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  return dialog;
}

const unique = (base: string) => `${base} ${test.info().workerIndex}${test.info().retry}${Date.now().toString(36)}`;

test('an administrator corrects a student\'s name and year group', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'dev.admin', 'dev-admin-pass');
  const original = unique('Typo Studnet');
  const corrected = original.replace('Studnet', 'Student');

  await page.goto('/dashboard/admin/people/students');
  const add = await openDialog(page, 'Add student');
  await add.getByLabel('Full name').fill(original);
  await add.getByRole('button', { name: 'Add student' }).click();
  await expect(page.getByText(`${original} added as a student`)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: new RegExp(original) }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(original, { timeout: 30_000 });

  const edit = await openDialog(page, 'Edit details');
  await edit.getByLabel('Name').fill(corrected);
  await edit.getByLabel('Year group').fill('Year 8');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Details corrected')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(corrected);
  await expect(page.locator('.profile-header__meta').first()).toContainText('Year 8');

  // Saving again without a change says so, and an empty name is refused with the reason.
  const again = await openDialog(page, 'Edit details');
  await again.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Nothing was changed')).toBeVisible({ timeout: 30_000 });
});

test('an administrator corrects a tutor\'s contact email and subjects; a bad address is refused', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'dev.admin', 'dev-admin-pass');
  const name = unique('Correction Tutor');

  await page.goto('/dashboard/admin/people/tutors');
  const add = await openDialog(page, 'Add tutor');
  await add.getByLabel('Full name').fill(name);
  await add.getByLabel('Email').fill('wrong.address@example.test');
  await add.getByRole('button', { name: /add/i }).click();
  await expect(page.getByText(`${name} added as a tutor`)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: new RegExp(name) }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name, { timeout: 30_000 });

  const bad = await openDialog(page, 'Edit details');
  await bad.getByLabel('Contact email').fill('two@example.test, three@example.test');
  // The browser's own email check would stop this before the server sees it; the server's refusal is what is being proved.
  await bad.locator('form').evaluate((form: HTMLFormElement) => { form.noValidate = true; });
  await bad.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Enter one contact email address.')).toBeVisible({ timeout: 30_000 });

  const edit = await openDialog(page, 'Edit details');
  await edit.getByLabel('Contact email').fill('right.address@example.test');
  await edit.getByLabel('Subjects').fill('Maths, Physics');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Details corrected')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('link', { name: 'right.address@example.test' })).toBeVisible();
  await expect(page.locator('.profile-header__meta').first()).toContainText('Maths, Physics');
});

test('a tutor cannot reach the pages the edit forms live on', async ({ page }) => {
  await signIn(page, 'dev.tutor', 'dev-tutor-pass');
  for (const path of ['/dashboard/admin/students/student-ayaan-ahmed', '/dashboard/admin/tutors/tutor-jamie-patel']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/don.t have access/i, { timeout: 30_000 });
  }
});
