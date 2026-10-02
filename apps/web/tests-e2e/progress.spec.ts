import { test, expect, type Page } from '@playwright/test';
import { uniqueLabel } from './support';

// plan15 feature A2: the student progress timeline. Every role reaches it from the page it already uses; a
// student a person may not see is a 404, exactly like an id that does not exist (the exhaustive visibility
// cases are unit tests in tests/progress.test.mjs, against the function the page calls).

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

// The dashboard's own not-found page (a soft 404: the status is already sent when a streamed page decides).
const NOT_FOUND = /not found|doesn.t exist|no longer exists|can.t find/i;

test('a Parent opens their child\'s timeline from the Children page', async ({ page }) => {
  await login(page, 'client');
  await page.goto('/dashboard/children');
  await page.getByRole('link', { name: 'See progress' }).click();
  await expect(page).toHaveURL(/\/dashboard\/progress\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Brian James Khalawon');
  await expect(page.locator('.progress-timeline__item').first()).toBeVisible();
  await expect(page.locator('#main-content').getByText('Lesson reports', { exact: true })).toBeVisible();
  // Each entry links through to the lesson.
  await page.locator('.progress-timeline__title a').first().click();
  await expect(page).toHaveURL(/\/dashboard\/lessons\/[^/]+$/);
});

test('a Student opens their own timeline from their feedback page', async ({ page }) => {
  await login(page, 'student');
  await page.goto('/dashboard/reports');
  await page.getByRole('link', { name: 'See my progress' }).click();
  await expect(page).toHaveURL(/\/dashboard\/progress\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Brian James Khalawon');
});

test('a Tutor opens a student they teach from My students', async ({ page }) => {
  await login(page, 'tutor');
  await page.goto('/dashboard/students');
  await page.getByRole('link', { name: /Brian James Khalawon/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/progress\/[^/]+$/);
  await expect(page.locator('.progress-timeline__item').first()).toBeVisible();
});

test('an Admin reaches it from the student profile', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/dashboard/admin/people/students');
  await page.getByRole('link', { name: /Brian James Khalawon/ }).first().click();
  await page.getByRole('link', { name: 'See progress' }).click();
  await expect(page).toHaveURL(/\/dashboard\/progress\/[^/]+$/);
});

test('a student nobody on the other side may see is a 404 for a Parent, a Tutor and a Student, and fine for the Admin', async ({ page }) => {
  const studentName = uniqueLabel('Progress Hidden Student');
  await login(page, 'admin');
  await page.goto('/dashboard/admin/people/students');
  await page.getByRole('button', { name: 'Add student' }).click();
  await page.locator('#student-name').fill(studentName);
  await page.getByRole('dialog').getByRole('button', { name: 'Add student' }).click();
  await expect(page.locator('.person-list')).toContainText(studentName);
  const href = await page.getByRole('link', { name: studentName }).first().getAttribute('href');
  const id = href!.split('/').pop()!;

  const adminView = await page.goto(`/dashboard/progress/${id}`);
  expect(adminView?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(studentName);

  for (const who of ['client', 'tutor', 'student'] as const) {
    await login(page, who);
    await page.goto(`/dashboard/progress/${id}`);
    await expect(page.locator('#main-content'), who).toContainText(NOT_FOUND);
    await expect(page.locator('#main-content')).not.toContainText(studentName);
    await expect(page.locator('.progress-timeline')).toHaveCount(0);
  }
});

test('a made-up id is the same 404 as a hidden one', async ({ page }) => {
  await login(page, 'client');
  await page.goto('/dashboard/progress/this-student-does-not-exist');
  await expect(page.locator('#main-content')).toContainText(NOT_FOUND);
});

test('signed out, the timeline asks for a sign-in', async ({ page }) => {
  await page.request.post('/api/auth/logout');
  await page.goto('/dashboard/progress/anything');
  await expect(page).toHaveURL(/\/login/);
});
