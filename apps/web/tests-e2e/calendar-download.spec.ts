import { test, expect, type Page } from '@playwright/test';
import { uniqueLabel } from './support';

// plan15 feature A4: "Add to calendar". The download is an authenticated route that can return only lessons
// the person can already see (a lesson they cannot see is the same 404 as one that does not exist), and the
// file holds the minimum. The RFC 5545 details and DST behaviour are unit tests (tests/ics.test.mjs).

const ACCOUNTS = {
  admin: { email: 'admin@learnthrive.dev', password: 'dev-admin-pass' },
  tutor: { email: 'tutor@learnthrive.dev', password: 'dev-tutor-pass' },
  client: { email: 'client@learnthrive.dev', password: 'dev-client-pass' },
  student: { email: 'student@learnthrive.dev', password: 'dev-student-pass' },
} as const;

const SEED_UPCOMING = 'lesson-gcse-maths-upcoming';

async function login(page: Page, who: keyof typeof ACCOUNTS) {
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByLabel('Email').fill(ACCOUNTS[who].email);
  await page.locator('input[name="password"]').fill(ACCOUNTS[who].password);
  await Promise.all([page.waitForURL(/\/dashboard$/), page.getByRole('button', { name: 'Sign in' }).click()]);
}

test('every role that can see a lesson can download it, as a calendar file', async ({ page }) => {
  for (const who of ['admin', 'tutor', 'client', 'student'] as const) {
    await login(page, who);
    const response = await page.request.get(`/api/lessons/${SEED_UPCOMING}/ics`);
    expect(response.status(), who).toBe(200);
    expect(response.headers()['content-type'], who).toContain('text/calendar');
    expect(response.headers()['content-disposition'], who).toMatch(/attachment; filename="learnthrive-lesson-\d{4}-\d{2}-\d{2}\.ics"/);
    expect(response.headers()['cache-control'], who).toContain('no-store');
    const body = await response.text();
    expect(body, who).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(body, who).toContain('BEGIN:VEVENT');
    expect(body, who).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(body, who).toContain('(UK time)');
  }
});

test('the lesson page offers the download, and clicking it downloads a .ics', async ({ page }) => {
  await login(page, 'client');
  await page.goto(`/dashboard/lessons/${SEED_UPCOMING}`);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Add to calendar' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.ics$/);
});

test('signed out gets a 401, and a made-up lesson id is a 404', async ({ page }) => {
  await page.request.post('/api/auth/logout');
  expect((await page.request.get(`/api/lessons/${SEED_UPCOMING}/ics`)).status()).toBe(401);
  await login(page, 'client');
  expect((await page.request.get('/api/lessons/does-not-exist/ics')).status()).toBe(404);
  expect((await page.request.get('/api/lessons/does-not-exist/ics?series=1')).status()).toBe(404);
});

test('a lesson the person cannot see is a 404 (no existence oracle), and the Admin can download it', async ({ page }) => {
  const studentName = uniqueLabel('Ics Hidden Student');
  const tutorName = uniqueLabel('Ics Hidden Tutor');
  const assignmentTitle = uniqueLabel('Ics Hidden Assignment');
  const lessonTitle = uniqueLabel('Ics hidden lesson');

  await login(page, 'admin');
  await page.goto('/dashboard/admin/people/students');
  await page.getByRole('button', { name: 'Add student' }).click();
  await page.locator('#student-name').fill(studentName);
  await page.getByRole('dialog').getByRole('button', { name: 'Add student' }).click();
  await expect(page.locator('.person-list')).toContainText(studentName);

  await page.goto('/dashboard/admin/people/tutors');
  await page.getByRole('button', { name: 'Add tutor' }).click();
  await page.locator('#tutor-name').fill(tutorName);
  await page.locator('#tutor-email').fill(`ics-tutor-${test.info().retry}-${Date.now()}@example.test`);
  await page.getByRole('dialog').getByRole('button', { name: 'Add tutor' }).click();

  await page.goto('/dashboard/admin/assignments');
  await page.getByRole('button', { name: 'Create assignment' }).click();
  await page.getByLabel('Title').fill(assignmentTitle);
  await page.getByLabel('Subject').fill('Chemistry');
  await page.getByLabel('Tutor').selectOption({ label: tutorName });
  await page.getByLabel('Student(s)').selectOption({ label: studentName });
  await page.getByRole('dialog').getByRole('button', { name: 'Create assignment' }).click();

  await page.goto('/dashboard/admin/lessons/new');
  await page.getByLabel('Tuition Assignment').selectOption({ label: assignmentTitle });
  await page.locator('#lesson-title').fill(lessonTitle);
  await page.locator('#lesson-date').fill('2026-11-24');
  await page.locator('#lesson-time').fill('11:00');
  await page.getByRole('button', { name: 'Schedule lesson' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);

  await page.goto('/dashboard/lessons?filter=all');
  const href = await page.getByRole('link', { name: new RegExp(lessonTitle.replace(/[()]/g, '\\$&')) }).first().getAttribute('href');
  const id = href!.split('/').pop()!;

  const adminFile = await page.request.get(`/api/lessons/${id}/ics`);
  expect(adminFile.status()).toBe(200);
  expect(await adminFile.text()).toContain('SUMMARY:');

  for (const who of ['client', 'student', 'tutor'] as const) {
    await login(page, who);
    expect((await page.request.get(`/api/lessons/${id}/ics`)).status(), `${who} must not get another family's lesson`).toBe(404);
    expect((await page.request.get(`/api/lessons/${id}/ics?series=1`)).status(), who).toBe(404);
  }
});
