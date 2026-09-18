import { test, expect, type Page } from '@playwright/test';

async function login(page: Page, email: string, password: string) {
  // /login redirects an already-authenticated visitor straight to /dashboard (deliberate,
  // tested behaviour — see auth.spec.ts) — so a test that logs in as a second identity without
  // logging out first would never even see the login form. Always start from a clean session.
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.locator('#login-password').fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard$/),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
}

const ADMIN = { email: 'admin@learnthrive.dev', password: 'dev-admin-pass' };
const TUTOR = { email: 'tutor@learnthrive.dev', password: 'dev-tutor-pass' };
const CLIENT = { email: 'client@learnthrive.dev', password: 'dev-client-pass' };
const STUDENT = { email: 'student@learnthrive.dev', password: 'dev-student-pass' };

test('the calendar shows the seeded demo lessons to Admin', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/calendar');
  await expect(page.locator('.fc-event')).not.toHaveCount(0);
});

test('Admin can schedule a single (non-recurring) lesson, which appears on the calendar', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/admin/lessons/new');
  await page.getByLabel('Tuition Assignment').selectOption({ label: 'GCSE Mathematics — Ayaan' });
  await page.locator('#lesson-title').fill('Algebra revision');
  await page.locator('#lesson-date').fill('2026-11-03'); // a Tuesday, well clear of the seed lessons
  await page.locator('#lesson-time').fill('15:00');
  await page.getByRole('button', { name: 'Schedule lesson' }).click();

  await expect(page).toHaveURL(/\/dashboard\/calendar$/);
  await page.locator('.fc-prev-button').click(); // no-op safe guard in case view drifted; ensures button exists
  await page.goto('/dashboard/calendar'); // ensure fresh month view (today)
  // Navigate to November 2026 where the lesson was scheduled.
  for (let i = 0; i < 12; i += 1) {
    const title = await page.locator('.fc-toolbar-title').innerText();
    if (title.includes('November 2026')) break;
    await page.locator('.fc-next-button').click();
  }
  await expect(page.locator('.fc-event', { hasText: 'Algebra revision' })).toBeVisible();
});

test('scheduling an overlapping lesson warns about the conflict, and "Schedule anyway" proceeds', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/admin/lessons/new');
  await page.getByLabel('Tuition Assignment').selectOption({ label: 'GCSE Mathematics — Ayaan' });
  await page.locator('#lesson-title').fill('Double-booked test lesson');
  // Same day/time as the "Algebra revision" lesson scheduled above — deliberately overlapping.
  await page.locator('#lesson-date').fill('2026-11-03');
  await page.locator('#lesson-time').fill('15:00');
  await page.getByRole('button', { name: 'Schedule lesson' }).click();

  await expect(page.locator('.form-message--error')).toContainText('Scheduling conflict detected');
  await expect(page.getByRole('button', { name: 'Schedule anyway' })).toBeVisible();
  await page.getByRole('button', { name: 'Schedule anyway' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);
});

test('Admin can schedule a recurring lesson, producing multiple independent occurrences', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/admin/lessons/new');
  await page.getByLabel('Tuition Assignment').selectOption({ label: 'GCSE Mathematics — Ayaan' });
  await page.locator('#lesson-title').fill('Weekly recurring practice');
  await page.locator('#lesson-date').fill('2026-12-01');
  await page.locator('#lesson-time').fill('10:00');
  await page.getByLabel('Repeats').selectOption('WEEKLY');
  await page.locator('#lesson-end-after').fill('3');
  await page.getByRole('button', { name: 'Schedule lesson' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);

  await page.goto('/dashboard/calendar');
  for (let i = 0; i < 12; i += 1) {
    const title = await page.locator('.fc-toolbar-title').innerText();
    if (title.includes('December 2026')) break;
    await page.locator('.fc-next-button').click();
  }
  const occurrences = page.locator('.fc-event', { hasText: 'Weekly recurring practice' });
  await expect(occurrences).toHaveCount(3);
});

test('lesson detail: Admin sees full operational details', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/calendar');
  await page.locator('.fc-event').first().click();
  await expect(page).toHaveURL(/\/dashboard\/lessons\/.+/);
  await expect(page.locator('.dashboard-page')).toContainText('Operational details');
});

test('lesson detail IDOR: a Student cannot view a lesson they are not on', async ({ page }) => {
  // Get a real lesson id belonging to the seeded assignment (which Ayaan/the seed Student IS on)
  // vs. one that a genuinely unrelated Student should be blocked from. We create an unrelated
  // Student+lesson as Admin first, then try to view it as the seeded Student.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/admin/people');
  await page.locator('summary', { hasText: 'Add Student' }).click();
  await page.locator('#student-name').fill('Unrelated Student');
  await page.getByRole('button', { name: 'Add Student' }).click();
  await expect(page.locator('.dashboard-page')).toContainText('Unrelated Student');

  await page.locator('summary', { hasText: 'Add Tutor' }).click();
  await page.locator('#tutor-name').fill('Unrelated Tutor');
  await page.locator('#tutor-email').fill('unrelated-tutor@example.test');
  await page.getByRole('button', { name: 'Add Tutor' }).click();

  await page.goto('/dashboard/admin/assignments');
  await page.locator('summary', { hasText: 'Create Tuition Assignment' }).click();
  await page.getByLabel('Title').fill('Unrelated Assignment');
  await page.getByLabel('Subject').fill('History');
  await page.getByLabel('Tutor').selectOption({ label: 'Unrelated Tutor' });
  await page.getByLabel('Student(s)').selectOption({ label: 'Unrelated Student' });
  await page.getByRole('button', { name: 'Create Assignment' }).click();

  await page.goto('/dashboard/admin/lessons/new');
  await page.getByLabel('Tuition Assignment').selectOption({ label: 'Unrelated Assignment' });
  await page.locator('#lesson-title').fill('Unrelated lesson');
  await page.locator('#lesson-date').fill('2026-11-20');
  await page.locator('#lesson-time').fill('13:00');
  await page.getByRole('button', { name: 'Schedule lesson' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);

  // Find the unrelated lesson's id via the calendar (Admin can see it).
  await page.goto('/dashboard/calendar');
  for (let i = 0; i < 12; i += 1) {
    const title = await page.locator('.fc-toolbar-title').innerText();
    if (title.includes('November 2026')) break;
    await page.locator('.fc-next-button').click();
  }
  await page.locator('.fc-event', { hasText: 'Unrelated lesson' }).click();
  await expect(page).toHaveURL(/\/dashboard\/lessons\/(.+)/);
  const lessonUrl = page.url();

  // Now log in as the *seeded* Student (unrelated to this new lesson) and try to view it directly.
  await login(page, STUDENT.email, STUDENT.password);
  await page.goto(lessonUrl);
  await expect(page).toHaveURL(/\/403$/);
});

test('Tutor sees only their own lessons on the calendar', async ({ page }) => {
  await login(page, TUTOR.email, TUTOR.password);
  await page.goto('/dashboard/calendar');
  // The seeded Tutor (Jamie Patel) has the seeded GCSE Maths lessons — at least one should show.
  await expect(page.locator('.fc-event').first()).toBeVisible();
  // Clicking one must not 403 (proving it really is theirs) and must show the limited, non-Admin
  // detail view (no "Operational details" section, which is Admin-only).
  await page.locator('.fc-event').first().click();
  await expect(page).toHaveURL(/\/dashboard\/lessons\/.+/);
  await expect(page.locator('.dashboard-page')).not.toContainText('Operational details');
});

test('Admin can cancel a planned lesson, which then shows as cancelled', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/admin/lessons/new');
  await page.getByLabel('Tuition Assignment').selectOption({ label: 'GCSE Mathematics — Ayaan' });
  await page.locator('#lesson-title').fill('Lesson to cancel');
  await page.locator('#lesson-date').fill('2026-11-25');
  await page.locator('#lesson-time').fill('14:00');
  await page.getByRole('button', { name: 'Schedule lesson' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);

  for (let i = 0; i < 12; i += 1) {
    const title = await page.locator('.fc-toolbar-title').innerText();
    if (title.includes('November 2026')) break;
    await page.locator('.fc-next-button').click();
  }
  await page.locator('.fc-event', { hasText: 'Lesson to cancel' }).click();
  await page.locator('#cancel-reason').fill('Testing cancellation');
  await page.getByRole('button', { name: 'Cancel this lesson' }).click();
  await expect(page.locator('.dashboard-page')).toContainText('CANCELLED');
  await expect(page.locator('.dashboard-page')).toContainText('Testing cancellation');
});

test('a Tutor can add and remove their own availability', async ({ page }) => {
  await login(page, TUTOR.email, TUTOR.password);
  await page.goto('/dashboard/tutor/availability');
  await page.locator('summary', { hasText: 'Add availability block' }).click();
  await page.getByLabel('Day of week').selectOption('5'); // Friday
  await page.locator('#availability-start').fill('09:00');
  await page.locator('#availability-end').fill('11:00');
  await page.getByRole('button', { name: 'Add block' }).click();
  await expect(page.locator('.people-list')).toContainText('Friday, 09:00');

  await page.getByRole('button', { name: 'Remove' }).first().click();
});

test('a Client only sees lessons belonging to their own Students on the calendar', async ({ page }) => {
  await login(page, CLIENT.email, CLIENT.password);
  await page.goto('/dashboard/calendar');
  // The seeded Client (Sarah Ahmed) should see the seeded GCSE Maths lessons but not the
  // "Unrelated lesson" created for a different family earlier in this suite.
  await expect(page.locator('.fc-event', { hasText: 'Unrelated lesson' })).toHaveCount(0);
});

test('a Tutor sees a disabled Join Classroom control outside the join window, for the seeded upcoming online lesson', async ({ page }) => {
  await login(page, TUTOR.email, TUTOR.password);
  await page.goto('/dashboard/lessons/lesson-gcse-maths-upcoming');
  const joinButton = page.getByRole('button', { name: /Join Classroom|Classroom opens closer to the start time/ });
  await expect(joinButton).toBeVisible();
  // The seed lesson is scheduled for "next Tuesday" relative to when the demo data was seeded —
  // outside this test's actual run time in every realistic case, so the button must be disabled.
  await expect(joinButton).toBeDisabled();
  await expect(joinButton).toHaveText('Classroom opens closer to the start time');
});

test('a Client never sees a Join Classroom control (only the assigned Tutor or Student can join)', async ({ page }) => {
  await login(page, CLIENT.email, CLIENT.password);
  await page.goto('/dashboard/lessons/lesson-gcse-maths-upcoming');
  await expect(page.getByRole('button', { name: /Join Classroom|Classroom opens closer to the start time/ })).toHaveCount(0);
});

test('lesson detail surfaces a joinError message from the query string', async ({ page }) => {
  await login(page, TUTOR.email, TUTOR.password);
  await page.goto('/dashboard/lessons/lesson-gcse-maths-upcoming?joinError=This%20lesson%20has%20been%20cancelled.');
  await expect(page.locator('[role="alert"]')).toContainText('This lesson has been cancelled.');
});

test('a Tutor cannot complete a lesson until every Student has an attendance record, then can once marked, with the event on the activity timeline', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/admin/lessons/new');
  await page.getByLabel('Tuition Assignment').selectOption({ label: 'GCSE Mathematics — Ayaan' });
  await page.locator('#lesson-title').fill('Lesson to complete');
  await page.locator('#lesson-date').fill('2026-11-26');
  await page.locator('#lesson-time').fill('14:00');
  await page.getByRole('button', { name: 'Schedule lesson' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);

  for (let i = 0; i < 12; i += 1) {
    const title = await page.locator('.fc-toolbar-title').innerText();
    if (title.includes('November 2026')) break;
    await page.locator('.fc-next-button').click();
  }
  await page.locator('.fc-event', { hasText: 'Lesson to complete' }).click();
  await expect(page).toHaveURL(/\/dashboard\/lessons\/(.+)/);
  const lessonUrl = page.url();

  await login(page, TUTOR.email, TUTOR.password);
  await page.goto(lessonUrl);
  const completeButton = page.getByRole('button', { name: /Complete Lesson|Mark attendance for every Student/ });
  await expect(completeButton).toBeDisabled();

  await page.locator('select[aria-label="Attendance status for Ayaan Ahmed"]').selectOption('ATTENDED');
  await page.getByRole('button', { name: 'Mark', exact: true }).click();
  await expect(page.locator('.attendance-list')).toContainText('ATTENDED');

  await expect(completeButton).toBeEnabled();
  await completeButton.click();
  await expect(page.locator('.dashboard-page')).toContainText('COMPLETED');
  await expect(page.locator('.activity-list')).toContainText('Attendance marked for Ayaan Ahmed: ATTENDED');
  await expect(page.locator('.activity-list')).toContainText('Lesson marked complete');
});
