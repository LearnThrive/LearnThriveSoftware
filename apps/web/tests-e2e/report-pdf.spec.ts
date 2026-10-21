import { test, expect, type Page } from '@playwright/test';

// plan17 C19: the PDF of approved reports. The route returns only reports the person can already read, only
// approved ones, and never a tutor's private fields. The file layout is a unit test (tests/reportPdf.test.mjs).

const ACCOUNTS = {
  admin: { email: 'admin@learnthrive.dev', password: 'dev-admin-pass' },
  tutor: { email: 'tutor@learnthrive.dev', password: 'dev-tutor-pass' },
  client: { email: 'client@learnthrive.dev', password: 'dev-client-pass' },
  student: { email: 'student@learnthrive.dev', password: 'dev-student-pass' },
} as const;

const SEED_REPORT = 'report-gcse-maths-completed-approved';
const SEED_LESSON = 'lesson-gcse-maths-completed';
const SEED_STUDENT = 'student-ayaan-ahmed';
// The seed report's private note and its confidence rating: tutor and admin see them on screen, no PDF has them.
const PRIVATE_NOTE = 'seemed tired today';

async function login(page: Page, who: keyof typeof ACCOUNTS) {
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByLabel('Email').fill(ACCOUNTS[who].email);
  await page.locator('input[name="password"]').fill(ACCOUNTS[who].password);
  await Promise.all([page.waitForURL(/\/dashboard$/), page.getByRole('button', { name: 'Sign in' }).click()]);
}

test('every role that can read the approved report can download it, and no private note is in the file', async ({ page }) => {
  for (const who of ['admin', 'tutor', 'client', 'student'] as const) {
    await login(page, who);
    const response = await page.request.get(`/api/reports/pdf?report=${SEED_REPORT}`);
    expect(response.status(), who).toBe(200);
    expect(response.headers()['content-type'], who).toBe('application/pdf');
    expect(response.headers()['content-disposition'], who).toMatch(/attachment; filename="learnthrive-report-\d{4}-\d{2}-\d{2}\.pdf"/);
    expect(response.headers()['cache-control'], who).toContain('no-store');
    const body = (await response.body()).toString('latin1');
    expect(body.startsWith('%PDF-1.4'), who).toBe(true);
    expect(body, who).toContain('simultaneous equations');
    expect(body, who).not.toContain(PRIVATE_NOTE);
    expect(body, who).not.toContain('Confidence');
  }
});

test('a student bundle holds the student\'s approved reports, and a date range that excludes them is a 404', async ({ page }) => {
  await login(page, 'client');
  const all = await page.request.get(`/api/reports/pdf?student=${SEED_STUDENT}`);
  expect(all.status()).toBe(200);
  expect((await all.body()).toString('latin1')).toContain('simultaneous equations');
  expect((await page.request.get(`/api/reports/pdf?student=${SEED_STUDENT}&from=2000-01-01&to=2000-12-31`)).status()).toBe(404);
});

test('signed out is a 401; a bad request is a 400; an unknown report or student is a 404', async ({ page }) => {
  await page.request.post('/api/auth/logout');
  expect((await page.request.get(`/api/reports/pdf?report=${SEED_REPORT}`)).status()).toBe(401);
  await login(page, 'client');
  expect((await page.request.get('/api/reports/pdf')).status()).toBe(400);
  expect((await page.request.get(`/api/reports/pdf?report=${SEED_REPORT}&student=${SEED_STUDENT}`)).status()).toBe(400);
  expect((await page.request.get(`/api/reports/pdf?student=${SEED_STUDENT}&from=yesterday`)).status()).toBe(400);
  expect((await page.request.get('/api/reports/pdf?report=nope')).status()).toBe(404);
  expect((await page.request.get('/api/reports/pdf?student=nope')).status()).toBe(404);
});

test('the lesson page and the progress page offer the download', async ({ page }) => {
  await login(page, 'client');
  await page.goto(`/dashboard/lessons/${SEED_LESSON}`);
  const first = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download as PDF' }).click();
  expect((await first).suggestedFilename()).toMatch(/\.pdf$/);

  await page.goto(`/dashboard/progress/${SEED_STUDENT}`);
  const second = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download reports (PDF)' }).click();
  expect((await second).suggestedFilename()).toBe(`learnthrive-reports-${SEED_STUDENT}.pdf`);
});
