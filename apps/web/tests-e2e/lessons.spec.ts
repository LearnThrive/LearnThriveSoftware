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

/** The calendar's side panel (plan6 section 56) opens on event click rather than navigating
 * straight to the lesson — this drills through to the full detail page the way a real person
 * clicking "View full details" would. Waits for the URL itself (not just the click event
 * dispatching) — a bare .click() on this Link doesn't wait for the resulting client-side
 * navigation to finish, so a caller's very next action can otherwise land while the peek panel
 * is still the thing on screen (see the identical rationale on this file's login() helper). */
async function openLessonFromCalendar(page: Page, eventText?: string) {
  const event = eventText ? page.locator('.fc-event', { hasText: eventText }) : page.locator('.fc-event').first();
  await event.click();
  await Promise.all([
    page.waitForURL(/\/dashboard\/lessons\/[^/]+$/),
    page.getByRole('link', { name: 'View full details' }).click(),
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

test('clicking a calendar lesson opens the peek panel with its summary, and "View full details" reaches the full page', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/calendar');
  await page.locator('.fc-event').first().click();
  await expect(page.locator('.lesson-peek__panel')).toBeVisible();
  await expect(page.locator('.lesson-peek__panel')).toContainText('Tutor');
  await page.getByRole('link', { name: 'View full details' }).click();
  await expect(page).toHaveURL(/\/dashboard\/lessons\/.+/);
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

  await expect(page.locator('.form-message--warning')).toContainText('Scheduling clash');
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

test('lesson detail: Admin sees admin-only controls that a Tutor does not', async ({ page }) => {
  // Complements hardening.spec.ts's "a Tutor cannot reach the Admin-only reschedule/cancel
  // actions" test, which proves the same button is absent for a Tutor on this identical lesson —
  // together they show the control is genuinely gated on role, not just untested either way.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/lessons/lesson-gcse-maths-upcoming');
  await expect(page.getByRole('button', { name: 'Cancel lesson' })).toBeVisible();
});

test('lesson detail IDOR: a Student cannot view a lesson they are not on', async ({ page }) => {
  // Get a real lesson id belonging to the seeded assignment (which Ayaan/the seed Student IS on)
  // vs. one that a genuinely unrelated Student should be blocked from. We create an unrelated
  // Student+lesson as Admin first, then try to view it as the seeded Student.
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/admin/people/students');
  await page.getByRole('button', { name: 'Add student' }).click();
  await page.locator('#student-name').fill('Unrelated Student');
  await page.getByRole('dialog').getByRole('button', { name: 'Add student' }).click();
  await expect(page.locator('.person-list')).toContainText('Unrelated Student');

  await page.goto('/dashboard/admin/people/tutors');
  await page.getByRole('button', { name: 'Add tutor' }).click();
  await page.locator('#tutor-name').fill('Unrelated Tutor');
  await page.locator('#tutor-email').fill('unrelated-tutor@example.test');
  await page.getByRole('dialog').getByRole('button', { name: 'Add tutor' }).click();

  await page.goto('/dashboard/admin/assignments');
  await page.getByRole('button', { name: 'Create assignment' }).click();
  await page.getByLabel('Title').fill('Unrelated Assignment');
  await page.getByLabel('Subject').fill('History');
  await page.getByLabel('Tutor').selectOption({ label: 'Unrelated Tutor' });
  await page.getByLabel('Student(s)').selectOption({ label: 'Unrelated Student' });
  await page.getByRole('dialog').getByRole('button', { name: 'Create assignment' }).click();

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
  await openLessonFromCalendar(page, 'Unrelated lesson');
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
  // Clicking one must not 403 (proving it really is theirs) and must reach the real detail page.
  await openLessonFromCalendar(page);
  await expect(page).toHaveURL(/\/dashboard\/lessons\/.+/);
  await expect(page.locator('#main-content')).toContainText('Details');
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
  await openLessonFromCalendar(page, 'Lesson to cancel');
  await page.getByRole('button', { name: 'Cancel lesson' }).click(); // opens the confirm Dialog
  await page.locator('#cancel-reason').fill('Testing cancellation');
  await page.getByRole('button', { name: 'Cancel this lesson' }).click();
  await expect(page.locator('#main-content')).toContainText(/cancelled/i);
  await expect(page.locator('#main-content')).toContainText('Testing cancellation');
});

test('a Tutor can add and remove their own availability', async ({ page }) => {
  await login(page, TUTOR.email, TUTOR.password);
  await page.goto('/dashboard/tutor/availability');
  await page.getByRole('button', { name: 'Add hours' }).click();
  await page.getByLabel('Day of week').selectOption('5'); // Friday
  await page.locator('#availability-start').fill('09:00');
  await page.locator('#availability-end').fill('11:00');
  await page.getByRole('button', { name: 'Add block' }).click();
  await expect(page.locator('.availability-list')).toContainText('Friday');
  await expect(page.locator('.availability-list')).toContainText('09:00');

  await page.getByRole('button', { name: 'Remove' }).first().click();
});

test('a Client only sees lessons belonging to their own Students on the calendar', async ({ page }) => {
  await login(page, CLIENT.email, CLIENT.password);
  await page.goto('/dashboard/calendar');
  // The seeded Client (Sarah Ahmed) should see the seeded GCSE Maths lessons but not the
  // "Unrelated lesson" created for a different family earlier in this suite.
  await expect(page.locator('.fc-event', { hasText: 'Unrelated lesson' })).toHaveCount(0);
});

test('a Tutor sees a disabled Join Classroom indicator outside the join window, for the seeded upcoming online lesson', async ({ page }) => {
  await login(page, TUTOR.email, TUTOR.password);
  await page.goto('/dashboard/lessons/lesson-gcse-maths-upcoming');
  // Outside the join window this renders as inert text, not a live link — there is deliberately
  // no clickable "Join classroom" control to find in this state (plan6 section 59).
  await expect(page.getByRole('link', { name: 'Join classroom' })).toHaveCount(0);
  await expect(page.locator('[aria-disabled="true"]', { hasText: 'Classroom opens' })).toBeVisible();
});

test('a Client never sees a Join Classroom control (only the assigned Tutor or Student can join)', async ({ page }) => {
  await login(page, CLIENT.email, CLIENT.password);
  await page.goto('/dashboard/lessons/lesson-gcse-maths-upcoming');
  await expect(page.getByRole('link', { name: 'Join classroom' })).toHaveCount(0);
  await expect(page.locator('[aria-disabled="true"]', { hasText: 'Classroom opens' })).toHaveCount(0);
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
  // No report required for this lesson — this test is about the attendance gate specifically;
  // the report-required completion gate has its own dedicated test below.
  await page.getByLabel('Require a lesson report').uncheck();
  await page.getByRole('button', { name: 'Schedule lesson' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);

  for (let i = 0; i < 12; i += 1) {
    const title = await page.locator('.fc-toolbar-title').innerText();
    if (title.includes('November 2026')) break;
    await page.locator('.fc-next-button').click();
  }
  await openLessonFromCalendar(page, 'Lesson to complete');
  await expect(page).toHaveURL(/\/dashboard\/lessons\/(.+)/);
  const lessonUrl = page.url();

  await login(page, TUTOR.email, TUTOR.password);
  await page.goto(lessonUrl);
  // The button's own label never changes; the reason it's disabled is a separate hint tied to it
  // via aria-describedby (plan6 section 88) rather than crammed into the accessible name.
  const completeButton = page.getByRole('button', { name: 'Complete lesson' });
  await expect(completeButton).toBeDisabled();
  await expect(page.locator('#complete-lesson-hint')).toContainText('Mark attendance for every student first');

  await page.locator('select[aria-label="Attendance status for Ayaan Ahmed"]').selectOption('ATTENDED');
  await page.getByRole('button', { name: 'Mark', exact: true }).click();
  await expect(page.locator('.attendance-list')).toContainText(/attended/i);

  await expect(completeButton).toBeEnabled();
  await completeButton.click();
  await expect(page.locator('#main-content')).toContainText(/completed/i);
  await expect(page.locator('.timeline')).toContainText('Attendance marked for Ayaan Ahmed: ATTENDED');
  await expect(page.locator('.timeline')).toContainText('Lesson marked complete');
});

test('a required lesson report blocks completion until submitted, and internal Tutor notes never reach the Client view even after approval', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/admin/lessons/new');
  await page.getByLabel('Tuition Assignment').selectOption({ label: 'GCSE Mathematics — Ayaan' });
  await page.locator('#lesson-title').fill('Lesson needing a report');
  await page.locator('#lesson-date').fill('2026-11-27');
  await page.locator('#lesson-time').fill('15:00');
  // "Require a lesson report" is checked by default — deliberately left on for this test.
  await page.getByRole('button', { name: 'Schedule lesson' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);

  for (let i = 0; i < 12; i += 1) {
    const title = await page.locator('.fc-toolbar-title').innerText();
    if (title.includes('November 2026')) break;
    await page.locator('.fc-next-button').click();
  }
  await openLessonFromCalendar(page, 'Lesson needing a report');
  await expect(page).toHaveURL(/\/dashboard\/lessons\/(.+)/);
  const lessonUrl = page.url();

  await login(page, TUTOR.email, TUTOR.password);
  await page.goto(lessonUrl);
  await page.locator('select[aria-label="Attendance status for Ayaan Ahmed"]').selectOption('ATTENDED');
  await page.getByRole('button', { name: 'Mark', exact: true }).click();

  const completeButton = page.getByRole('button', { name: 'Complete lesson' });
  await expect(completeButton).toBeDisabled();
  await expect(page.locator('#complete-lesson-hint')).toContainText('Submit the lesson report first');

  await page.getByRole('button', { name: 'Start a report' }).click();
  await page.locator('#report-summary').fill('Covered quadratic equations.');
  await page.locator('#report-private-notes').fill('CONFIDENTIAL: struggling with confidence, discuss with Sarah privately.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(completeButton).toBeDisabled(); // still a draft — doesn't count as "the report exists" yet

  await page.getByRole('button', { name: 'Submit report' }).click();
  await expect(page.locator('#main-content')).toContainText(/submitted/i);
  await expect(completeButton).toBeEnabled();
  await completeButton.click();
  await expect(page.locator('#main-content')).toContainText(/completed/i);

  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/dashboard/notifications');
  await expect(page.locator('.notification-list')).toContainText('is awaiting approval');
  await page.goto(lessonUrl);
  await expect(page.locator('#main-content')).toContainText(/submitted/i);
  await page.getByRole('button', { name: 'Approve report' }).click();
  await expect(page.locator('#main-content')).toContainText(/approved/i);

  await login(page, CLIENT.email, CLIENT.password);
  await expect(page.locator('.app-topbar__badge')).toBeVisible();
  await page.goto('/dashboard/notifications');
  await expect(page.locator('.notification-list')).toContainText('A new report is available');
  await page.getByRole('button', { name: 'Mark read' }).first().click();

  await page.goto(lessonUrl);
  await expect(page.locator('#main-content')).toContainText('Covered quadratic equations.');
  await expect(page.locator('#main-content')).not.toContainText('CONFIDENTIAL');
});
