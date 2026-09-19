import { test, expect, type Page } from '@playwright/test';
import { uniqueLabel } from './support';

// Plan6 sections 91-94: one full sidebar-driven navigation journey per role, using only real
// clicks (nav links, row links, back links, buttons) — never page.goto() mid-journey. Each role's
// nav is also checked against what plan6 sections 17-20 / lib/navigation/appNavigation.ts say it
// should and shouldn't be able to reach.

const ADMIN = { email: 'admin@learnthrive.dev', password: 'dev-admin-pass' };
const TUTOR = { email: 'tutor@learnthrive.dev', password: 'dev-tutor-pass' };
const CLIENT = { email: 'client@learnthrive.dev', password: 'dev-client-pass' };
const STUDENT = { email: 'student@learnthrive.dev', password: 'dev-student-pass' };

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

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await Promise.all([
    page.waitForURL(/\/$/),
    page.getByRole('menuitem', { name: 'Log out' }).click(),
  ]);
}

/** London wall-clock date/time strings for "now + minutesFromNow" — see single-server.spec.ts's
 * copy of this helper for the full rationale (zonedTimeToUtc-consistent, timezone-independent). */
function londonDateTimeFieldsIn(minutesFromNow: number): { date: string; time: string } {
  const target = new Date(Date.now() + minutesFromNow * 60_000);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(target).reduce<Record<string, string>>((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

test('Admin navigation journey: Dashboard, People (Tutor/Student profiles), Calendar, a Lesson, Reports, Notifications, Logout', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  const nav = page.locator('.app-nav');

  await nav.getByRole('link', { name: 'Tutors' }).click();
  await expect(page).toHaveURL(/\/dashboard\/admin\/people\/tutors$/);
  await page.getByRole('link', { name: /Tahasin Hasan/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/admin\/tutors\/.+/);
  await page.getByRole('link', { name: 'Back to tutors' }).click();
  await expect(page).toHaveURL(/\/dashboard\/admin\/people\/tutors$/);

  await nav.getByRole('link', { name: 'Students' }).click();
  await expect(page).toHaveURL(/\/dashboard\/admin\/people\/students$/);
  await page.getByRole('link', { name: /Brian James Khalawon/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/admin\/students\/.+/);
  await page.getByRole('link', { name: 'Back to students' }).click();
  await expect(page).toHaveURL(/\/dashboard\/admin\/people\/students$/);

  await nav.getByRole('link', { name: 'Calendar' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);
  await page.locator('.fc-event').first().click();
  await expect(page.locator('.lesson-peek__panel')).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/dashboard\/lessons\/[^/]+$/),
    page.getByRole('link', { name: 'View full details' }).click(),
  ]);
  await page.getByRole('link', { name: 'Back to lessons' }).click();
  await expect(page).toHaveURL(/\/dashboard\/lessons$/);

  await nav.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/dashboard\/reports$/);

  await nav.getByRole('link', { name: /Notifications/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/notifications$/);

  await logout(page);
});

test('Tutor navigation journey: nav is teaching-scoped, no Admin sections, Overview → Students → a Lesson → Classroom → end → Report → Logout', async ({ page }) => {
  // This journey does more round trips than any other single test here (two logins, a WebRTC/
  // socket.io classroom join and leave, several page loads either side) — under this suite's own
  // parallel load against one shared dev server, that's enough slower responses to occasionally
  // run past the default per-test budget on its own, well before anything is actually wrong.
  test.setTimeout(60_000);

  // Setup as Admin: a lesson inside the Tutor's join window, so this journey can reach the real
  // classroom rather than only its disabled state (already covered by lessons.spec.ts).
  await login(page, ADMIN.email, ADMIN.password);
  // single-server.spec.ts schedules its own "now + a bit" lesson on this identical seeded
  // Tutor/Student pair — conflict detection is tutor/student-based, not assignment-based, and
  // both tests need to land inside the Tutor's 30-minute join window, so no fixed offset is
  // mathematically guaranteed clear of it. Handled the same way a real admin would (the product's
  // own "Schedule anyway" confirmation — lessons.spec.ts has a dedicated test proving that path
  // itself works) rather than chased away with a longer retry loop that only ate further into
  // this test's own time budget without addressing the actual slowness.
  const { date, time } = londonDateTimeFieldsIn(20);
  const lessonTitle = uniqueLabel('Tutor nav journey lesson');
  await page.goto('/dashboard/admin/lessons/new');
  await page.getByLabel('Tuition Assignment').selectOption({ label: 'GCSE Mathematics — Brian' });
  await page.locator('#lesson-title').fill(lessonTitle);
  await page.locator('#lesson-date').fill(date);
  await page.locator('#lesson-time').fill(time);
  await page.getByRole('button', { name: 'Schedule lesson' }).click();
  const scheduleAnyway = page.getByRole('button', { name: 'Schedule anyway' });
  // locator.isVisible() checks the *current* state — it does not poll despite taking a `timeout`
  // option, so calling it right after the click (before the server has even responded) reliably
  // read "not visible" and skipped the click every time, regardless of what showed up moments
  // later (found via the failure's own accessibility snapshot: "Schedule anyway" was right there
  // on the page). Racing two *polling* waits — waitForURL and locator.waitFor — actually waits
  // for whichever outcome happens first.
  await Promise.race([
    page.waitForURL(/\/dashboard\/calendar$/, { timeout: 10_000 }),
    scheduleAnyway.waitFor({ state: 'visible', timeout: 10_000 }),
  ]).catch(() => {});
  if (await scheduleAnyway.isVisible()) await scheduleAnyway.click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/, { timeout: 10_000 });

  await login(page, TUTOR.email, TUTOR.password);
  const nav = page.locator('.app-nav');

  // Verify available nav (plan6 section 18's teaching-scoped set).
  for (const label of ['Overview', 'Calendar', 'Lessons', 'Students', 'Reports', 'Availability', 'Notifications', 'Settings']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
  // Verify Admin-only sections are absent from the nav entirely, not merely blocked if reached
  // directly (that's hardening.spec.ts's and auth.spec.ts's job).
  for (const label of ['Tutors', 'Clients', 'Assignments', 'Activity']) {
    await expect(nav.getByRole('link', { name: label })).toHaveCount(0);
  }

  await nav.getByRole('link', { name: 'Students' }).click();
  await expect(page).toHaveURL(/\/dashboard\/students$/);
  await expect(page.locator('.person-list')).toContainText('Brian James Khalawon');

  await nav.getByRole('link', { name: 'Lessons' }).click();
  await expect(page).toHaveURL(/\/dashboard\/lessons$/);
  await page.getByRole('link', { name: lessonTitle }).click();
  await expect(page).toHaveURL(/\/dashboard\/lessons\/.+/);

  await Promise.all([
    page.waitForURL(/\/classroom(\?.*)?$/),
    page.getByRole('link', { name: 'Join classroom' }).click(),
  ]);
  await expect(page.getByRole('button', { name: 'End class' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'End class' }).click();
  await page.getByRole('button', { name: 'Yes, end class' }).click();
  await page.getByRole('link', { name: /Return to Lesson/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/lessons\/[^/]+$/);

  // → Report
  await page.getByRole('button', { name: 'Start a report' }).click();
  await expect(page.locator('#report-summary')).toBeVisible();

  await logout(page);
});

test('Client navigation journey: children, schedule, reports, notifications, logout — no Admin/Tutor navigation', async ({ page }) => {
  await login(page, CLIENT.email, CLIENT.password);
  const nav = page.locator('.app-nav');

  for (const label of ['Home', 'Children', 'Calendar', 'Lesson reports', 'Notifications', 'Settings']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
  for (const label of ['Tutors', 'Clients', 'Students', 'Assignments', 'Activity', 'Availability']) {
    await expect(nav.getByRole('link', { name: label })).toHaveCount(0);
  }

  await nav.getByRole('link', { name: 'Children' }).click();
  await expect(page).toHaveURL(/\/dashboard\/children$/);

  await nav.getByRole('link', { name: 'Calendar' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);

  await nav.getByRole('link', { name: 'Lesson reports' }).click();
  await expect(page).toHaveURL(/\/dashboard\/reports$/);

  await nav.getByRole('link', { name: /Notifications/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/notifications$/);

  await logout(page);
});

test('Student navigation journey: next lesson, schedule, classroom reachability, feedback, logout', async ({ page }) => {
  await login(page, STUDENT.email, STUDENT.password);
  const nav = page.locator('.app-nav');

  for (const label of ['Home', 'Calendar', 'Lessons', 'Feedback', 'Notifications', 'Settings']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
  for (const label of ['Tutors', 'Clients', 'Students', 'Assignments', 'Activity', 'Availability']) {
    await expect(nav.getByRole('link', { name: label })).toHaveCount(0);
  }

  // "Next lesson": the Student dashboard's own NextLessonCard, not a nav item.
  await expect(page.locator('.next-lesson')).toBeVisible();

  await nav.getByRole('link', { name: 'Calendar' }).click();
  await expect(page).toHaveURL(/\/dashboard\/calendar$/);

  // "Classroom": the seeded upcoming lesson is outside its join window (proven live elsewhere by
  // lessons.spec.ts) — reachability here means the lesson detail page itself, one click away via
  // the Lessons list rather than a typed URL.
  await nav.getByRole('link', { name: 'Lessons' }).click();
  await expect(page).toHaveURL(/\/dashboard\/lessons$/);
  await page.getByRole('link', { name: /GCSE Mathematics/ }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/lessons\/.+/);
  await expect(page.locator('[aria-disabled="true"]', { hasText: 'Classroom opens' })).toBeVisible();

  await nav.getByRole('link', { name: 'Feedback' }).click();
  await expect(page).toHaveURL(/\/dashboard\/reports$/);

  await logout(page);
});
