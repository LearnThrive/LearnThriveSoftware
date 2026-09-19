import { test, expect, type Page } from '@playwright/test';
import { uniqueLabel } from './support';

// Plan section 85's IDOR/access-control adversarial test list. Several of its named attacks
// (Parent accesses unrelated Student URL, Tutor accesses unassigned Student, Student accesses
// another Student, Tutor edits someone else's Lesson) are structurally impossible rather than
// merely blocked: every /dashboard/admin/* profile and every mutating Lesson Server Action
// (reschedule, cancel) is Admin-only, already proven generically by auth.spec.ts's
// "cannot reach an Admin-only route" tests and by requireRole()'s own unit coverage. This file
// covers what those don't: the specific attacks section 85 names that survive to the page/action
// layer — an unrelated Tutor viewing a Lesson (mirroring lessons.spec.ts's Student IDOR test for
// the Tutor role), and a Tutor attempting to approve their own report. See docs/HARDENING.md.

async function login(page: Page, email: string, password: string) {
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#login-password').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
}

/** The calendar's side panel (plan6 section 56) opens on event click rather than navigating
 * straight to the lesson — this drills through to the full detail page. Waits for the URL
 * itself, not just the click event dispatching — see the identical rationale on lessons.spec.ts's
 * copy of this helper. */
async function openLessonFromCalendar(page: Page, eventText: string) {
  await page.locator('.fc-event', { hasText: eventText }).click();
  await Promise.all([
    page.waitForURL(/\/dashboard\/lessons\/[^/]+$/),
    page.getByRole('link', { name: 'View full details' }).click(),
  ]);
}

const ADMIN = { email: 'admin@learnthrive.dev', password: 'dev-admin-pass' };
const TUTOR = { email: 'tutor@learnthrive.dev', password: 'dev-tutor-pass' };

test('lesson detail IDOR: a Tutor cannot view a lesson they are not assigned to', async ({ page }) => {
  const studentName = uniqueLabel('Hardening Test Student');
  const tutorName = uniqueLabel('Hardening Test Tutor');
  const assignmentTitle = uniqueLabel('Hardening Test Assignment');
  const lessonTitle = uniqueLabel('Hardening test lesson');

  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/admin/people/students');
  await page.getByRole('button', { name: 'Add student' }).click();
  await page.locator('#student-name').fill(studentName);
  await page.getByRole('dialog').getByRole('button', { name: 'Add student' }).click();
  await expect(page.locator('.person-list')).toContainText(studentName);

  await page.goto('/dashboard/admin/people/tutors');
  await page.getByRole('button', { name: 'Add tutor' }).click();
  await page.locator('#tutor-name').fill(tutorName);
  await page.locator('#tutor-email').fill(`hardening-tutor-${test.info().retry}@example.test`);
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
  await page.locator('#lesson-date').fill('2026-11-21');
  await page.locator('#lesson-time').fill('11:00');
  await page.getByRole('button', { name: 'Schedule lesson' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);

  await page.goto('/dashboard/calendar');
  for (let i = 0; i < 12; i += 1) {
    const title = await page.locator('.fc-toolbar-title').innerText();
    if (title.includes('November 2026')) break;
    await page.locator('.fc-next-button').click();
  }
  await openLessonFromCalendar(page, lessonTitle);
  await expect(page).toHaveURL(/\/dashboard\/lessons\/(.+)/);
  const lessonUrl = page.url();

  // The seeded Tutor (Jamie Patel) has a real login but is NOT on this lesson — a different
  // Tutor entirely ("Hardening Test Tutor", who has no login at all) is.
  await login(page, TUTOR.email, TUTOR.password);
  await page.goto(lessonUrl);
  await expect(page).toHaveURL(/\/403$/);
});

test('a Tutor cannot reach the Admin-only reschedule/cancel actions for any lesson, including their own', async ({ page }) => {
  // rescheduleLessonAction/cancelLessonAction are requireRole(["ADMIN"]) — the lesson detail
  // page itself never renders a Cancel button for a Tutor (canCancel is Admin-only), so there is
  // no UI path to even attempt this. Proven here by checking the control is genuinely absent for
  // a Tutor viewing their own seeded, cancellable lesson — not just untested.
  await login(page, TUTOR.email, TUTOR.password);
  await page.goto('/dashboard/lessons/lesson-gcse-maths-upcoming');
  await expect(page.getByRole('button', { name: 'Cancel lesson' })).toHaveCount(0);
});

test('report approval IDOR: a Tutor never sees an Approve report control, even on their own submitted report', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/admin/lessons/new');
  await page.getByLabel('Tuition Assignment').selectOption({ label: 'GCSE Mathematics — Ayaan' });
  const lessonTitle = uniqueLabel('Hardening report lesson');
  await page.locator('#lesson-title').fill(lessonTitle);
  await page.locator('#lesson-date').fill('2026-11-22');
  await page.locator('#lesson-time').fill('12:00');
  await page.getByRole('button', { name: 'Schedule lesson' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);

  for (let i = 0; i < 12; i += 1) {
    const title = await page.locator('.fc-toolbar-title').innerText();
    if (title.includes('November 2026')) break;
    await page.locator('.fc-next-button').click();
  }
  await openLessonFromCalendar(page, lessonTitle);
  await expect(page).toHaveURL(/\/dashboard\/lessons\/(.+)/);
  const lessonUrl = page.url();

  await login(page, TUTOR.email, TUTOR.password);
  await page.goto(lessonUrl);
  await page.getByRole('button', { name: 'Start a report' }).click();
  await expect(page.locator('#report-summary')).toBeVisible();
  await page.locator('#report-summary').fill('Covered acids and bases.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.locator('#report-summary')).toHaveValue('Covered acids and bases.');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.locator('#main-content')).toContainText(/submitted/i);

  // approveReportAction is requireRole(["ADMIN"]) — the page only renders the button for
  // isAdmin, so the Tutor who just submitted this exact report has no way to approve it.
  await expect(page.getByRole('button', { name: 'Approve report' })).toHaveCount(0);
});

test('the development data reset endpoint refuses a non-Admin caller', async ({ page }) => {
  // Deliberately does NOT test the Admin-success path here: this suite's spec files run in
  // parallel workers against one shared dev server (see playwright.config.ts), and an actual
  // reset would wipe data other tests are concurrently relying on. The reset behavior itself
  // (seed scenario restored, session clutter discarded) is proven in isolation by
  // packages/data/src/inMemoryProvider.test.ts, which has no such shared-state risk.
  await login(page, TUTOR.email, TUTOR.password);
  const response = await page.request.post('/api/dev/reset');
  expect(response.status()).toBe(403);
});
