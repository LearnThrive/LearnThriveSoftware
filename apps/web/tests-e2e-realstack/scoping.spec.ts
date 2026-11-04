import { expect, test, type Page } from '@playwright/test';
import { distinctVisitor, signIn, signOut } from './_browser';
import { readFixture } from './_stack';
import type { FamilyFixture, Fixture } from './global-setup';

/**
 * Launch checklist 2.5: the per-role scoping audit on the SQL data provider, page by page, with TWO families and TWO tutors on the REAL
 * local Supabase stack. Written down in docs/SCOPING_AUDIT.md.
 *
 * What it asks of every dashboard page, for every role: does it show this person their own records, does it keep the other family's and
 * the other tutor's records off the page, and does guessing an id in the URL get anywhere. It also covers the two rules that are not
 * about ownership: a tutor's private notes never reach a family or a learner, and an administrator who teaches (3.11) gets the tutor
 * tools without being able to walk into another tutor's lesson.
 *
 * Each family's records carry its surname, so a leak shows up as that word on a page it has no business being on.
 */

distinctVisitor();
test.describe.configure({ mode: 'serial' });

let f: Fixture;
test.beforeAll(() => {
  f = readFixture<Fixture>();
});

/** Everything about a family that must never appear on another person's page. */
function marks(family: FamilyFixture, surname: string) {
  return {
    surname,
    child: family.enrolled.name,
    sibling: family.sibling.name,
    lesson: `${surname} past lesson`,
    upcoming: `${surname} upcoming lesson`,
    report: `${family.enrolled.name} worked well on`,
    privateNote: `PRIVATE NOTE ${surname}`,
  };
}
const ASH = () => marks(f.ashford, 'Ashford');
const BREN = () => marks(f.brenner, 'Brenner');

/**
 * The text of the page's own region, so the navigation and the user menu are not mistaken for content — and only once the content has
 * actually arrived. The dashboard has a route-level loading skeleton (app/(app)/dashboard/loading.tsx), and `goto` comes back while that
 * is still on screen: reading then would make every "the other family is not here" assertion pass on a page that holds nothing at all.
 */
async function body(page: Page, path: string): Promise<string> {
  const response = await page.goto(path);
  expect(response?.status(), `${path} should render`).toBeLessThan(400);
  const main = page.locator('main');
  await expect(main, `${path} is still loading`).not.toContainText('Loading…', { timeout: 60_000 });
  await expect(main.locator('h1').first(), `${path} has no heading`).toBeVisible({ timeout: 60_000 });
  return (await main.innerText()).replace(/\s+/g, ' ');
}

/** Asserts that none of these words is anywhere in the page's content. */
function absent(text: string, path: string, words: Record<string, string>) {
  for (const [what, word] of Object.entries(words)) {
    expect(text, `${path} must not show the other family's ${what} (“${word}”)`).not.toContain(word);
  }
}

/**
 * A page this person may not open: either the guard sends them to /403, or the record answers exactly as one that does not exist.
 *
 * The "not found" case is checked by what the page says, not by the status code: the dashboard streams its loading shell
 * (app/(app)/dashboard/loading.tsx) before the page component runs, so the 200 is already on the wire by the time `notFound()` is
 * called and the body carries the not-found page instead. What matters to the audit is that the answer is indistinguishable from a
 * record that is not there, which is what this asserts.
 */
async function refused(page: Page, path: string, how: 403 | 404) {
  await page.goto(path);
  if (how === 403) {
    await expect(page, `${path} should be refused`).toHaveURL(/\/403$/);
    return;
  }
  await expect(page.locator('main'), `${path} should answer "not found"`).toContainText(/couldn.t find that page/i, { timeout: 60_000 });
}

test('a family sees their own children, lessons and reports, and nothing of the other family', async ({ page }) => {
  for (const [mine, theirs, family] of [[ASH(), BREN(), f.ashford], [BREN(), ASH(), f.brenner]] as const) {
    await signIn(page, family.parent.username, family.parent.password);
    await expect(page, `${mine.surname}: an enrolled family lands on the dashboard`).toHaveURL(/\/dashboard$/);

    for (const path of ['/dashboard', '/dashboard/calendar', '/dashboard/lessons', '/dashboard/reports', '/dashboard/notifications', '/dashboard/children', '/dashboard/settings']) {
      const text = await body(page, path);
      absent(text, path, { child: theirs.child, sibling: theirs.sibling, lesson: theirs.lesson, upcoming: theirs.upcoming, report: theirs.report, note: theirs.privateNote });
      // A tutor's private notes are tutor-facing only: not even about their own child.
      expect(text, `${path} must never carry a tutor's private notes`).not.toContain(mine.privateNote);
    }

    // Their own records really are there (otherwise "nothing of the other family" would pass on an empty page).
    expect(await body(page, '/dashboard/children'), 'both of their children').toContain(mine.child);
    expect(await body(page, '/dashboard/children')).toContain(mine.sibling);
    expect(await body(page, '/dashboard/lessons'), 'their own lessons').toContain(mine.upcoming);
    // The reports list names the lesson, the student and the tutor; the summary itself is on the lesson and the progress page.
    const reportList = await body(page, '/dashboard/reports');
    expect(reportList, 'their own report is listed').toContain(mine.lesson);
    expect(reportList).toContain(mine.child);

    expect(await body(page, '/dashboard/settings'), 'the platform default is an administrator’s to change').not.toContain('Report approval');

    const ownProgress = await body(page, `/dashboard/progress/${family.enrolled.studentId}`);
    expect(ownProgress).toContain(mine.child);
    expect(ownProgress, 'the report text a family may read').toContain(mine.report);
    expect(ownProgress, 'but never the tutor-only notes').not.toContain(mine.privateNote);

    const ownLesson = await body(page, `/dashboard/lessons/${family.pastLessonId}`);
    expect(ownLesson).toContain(mine.lesson);
    expect(ownLesson).not.toContain(mine.privateNote);
    await signOut(page);
  }
});

test('a guessed id gets a family nowhere: the other family’s lesson, child, admin pages and downloads', async ({ page }) => {
  for (const [mine, family, other] of [['Ashford', f.ashford, f.brenner], ['Brenner', f.brenner, f.ashford]] as const) {
    await signIn(page, family.parent.username, family.parent.password);
    await refused(page, `/dashboard/lessons/${other.pastLessonId}`, 403);
    await refused(page, `/dashboard/lessons/${other.upcomingLessonId}`, 403);
    await refused(page, `/dashboard/progress/${other.enrolled.studentId}`, 404);
    await refused(page, `/dashboard/progress/${other.sibling.studentId}`, 404);
    // The staff screens, by their own path and by guessing a record id.
    for (const path of [
      '/dashboard/activity',
      '/dashboard/students',
      '/dashboard/tutor/availability',
      '/dashboard/admin/people/clients',
      '/dashboard/admin/people/students',
      '/dashboard/admin/people/tutors',
      '/dashboard/admin/assignments',
      '/dashboard/admin/lessons/new',
      `/dashboard/admin/clients/${other.clientId}`,
      `/dashboard/admin/students/${other.enrolled.studentId}`,
      `/dashboard/admin/tutors/${other.tutor.tutorId}`,
      `/dashboard/admin/assignments/${other.assignmentId}`,
      `/dashboard/admin/clients/${family.clientId}`,
    ]) await refused(page, path, 403);

    // The downloads: a report, a whole student's history and a calendar file are all the same 404 as a record that is not there.
    for (const url of [
      `/api/reports/pdf?report=${other.reportId}`,
      `/api/reports/pdf?student=${other.enrolled.studentId}`,
      `/api/lessons/${other.pastLessonId}/ics`,
      `/api/lessons/${other.upcomingLessonId}/ics`,
    ]) {
      const reply = await page.request.get(url);
      expect(reply.status(), `${mine}: ${url}`).toBe(404);
    }
    // Their own, for contrast.
    expect((await page.request.get(`/api/lessons/${family.upcomingLessonId}/ics`)).status(), `${mine}: their own lesson's calendar file`).toBe(200);
    expect((await page.request.get(`/api/reports/pdf?report=${family.reportId}`)).status(), `${mine}: their own report`).toBe(200);

    // Another family's learner cannot be suspended, re-invited or have their chats deleted.
    for (const path of [`/api/learners/${other.enrolled.studentId}/status`, `/api/learners/${other.enrolled.studentId}/access`, `/api/learners/${other.enrolled.studentId}/invite`]) {
      const reply = await page.request.post(path, { data: { status: 'suspended', mode: 'none' }, failOnStatusCode: false });
      expect(reply.status(), `${mine}: ${path}`).toBeGreaterThanOrEqual(400);
    }
    await signOut(page);
  }
});

test('a tutor sees only their own students and lessons, and another tutor’s are refused', async ({ page }) => {
  for (const [mine, theirs, family, other] of [[ASH(), BREN(), f.ashford, f.brenner], [BREN(), ASH(), f.brenner, f.ashford]] as const) {
    await signIn(page, family.tutor.username, family.tutor.password);
    await expect(page, `${mine.surname} tutor lands on the dashboard`).toHaveURL(/\/dashboard$/);

    for (const path of ['/dashboard', '/dashboard/calendar', '/dashboard/lessons', '/dashboard/reports', '/dashboard/notifications', '/dashboard/students', '/dashboard/tutor/availability']) {
      const text = await body(page, path);
      absent(text, path, { child: theirs.child, sibling: theirs.sibling, lesson: theirs.lesson, upcoming: theirs.upcoming, report: theirs.report, note: theirs.privateNote });
    }
    expect(await body(page, '/dashboard/settings'), 'the platform default is an administrator’s to change').not.toContain('Report approval');
    expect(await body(page, '/dashboard/students'), 'their own student').toContain(mine.child);
    expect(await body(page, '/dashboard/lessons')).toContain(mine.upcoming);
    // Their own private notes ARE theirs to read.
    expect(await body(page, `/dashboard/lessons/${family.pastLessonId}`), 'a tutor reads their own notes').toContain(mine.privateNote);

    await refused(page, `/dashboard/lessons/${other.pastLessonId}`, 403);
    await refused(page, `/dashboard/progress/${other.enrolled.studentId}`, 404);
    await refused(page, '/dashboard/children', 403);
    for (const path of ['/dashboard/activity', '/dashboard/admin/people/clients', '/dashboard/admin/assignments', `/dashboard/admin/students/${other.enrolled.studentId}`]) {
      await refused(page, path, 403);
    }
    expect((await page.request.get(`/api/reports/pdf?report=${other.reportId}`)).status()).toBe(404);
    expect((await page.request.get(`/api/lessons/${other.pastLessonId}/ics`)).status()).toBe(404);
    await signOut(page);
  }
});

test('a learner sees their own lessons and reports, never a sibling’s, another family’s or the tutor’s notes', async ({ page }) => {
  const mine = ASH();
  const theirs = BREN();
  const learner = f.ashford.enrolled.learner;
  await signIn(page, learner.username, learner.password);
  await expect(page).toHaveURL(/\/dashboard/);

  for (const path of ['/dashboard', '/dashboard/calendar', '/dashboard/lessons', '/dashboard/reports', '/dashboard/notifications']) {
    const text = await body(page, path);
    absent(text, path, { child: theirs.child, lesson: theirs.lesson, report: theirs.report, note: theirs.privateNote });
    expect(text, `${path}: a sibling's name is not theirs to see`).not.toContain(mine.sibling);
    expect(text, `${path}: the tutor's private notes`).not.toContain(mine.privateNote);
  }
  expect(await body(page, '/dashboard/lessons'), 'their own lesson').toContain(mine.upcoming);

  const own = await body(page, `/dashboard/progress/${f.ashford.enrolled.studentId}`);
  expect(own).toContain(mine.report);
  expect(own).not.toContain(mine.privateNote);
  await refused(page, `/dashboard/progress/${f.ashford.sibling.studentId}`, 404);
  await refused(page, `/dashboard/progress/${f.brenner.enrolled.studentId}`, 404);
  await refused(page, `/dashboard/lessons/${f.brenner.pastLessonId}`, 403);
  // The family's own screens belong to the adult who holds the account, not to the learner.
  for (const path of ['/dashboard/children', '/dashboard/students', '/dashboard/tutor/availability', '/dashboard/activity', '/dashboard/admin/people/students']) {
    await refused(page, path, 403);
  }
  expect((await page.request.get(`/api/reports/pdf?report=${f.brenner.reportId}`)).status()).toBe(404);
  expect((await page.request.get(`/api/lessons/${f.brenner.upcomingLessonId}/ics`)).status()).toBe(404);
  await signOut(page);
});

test('an administrator sees every family, and has no tutor tools unless they teach', async ({ page }) => {
  await signIn(page, f.admin.username, f.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  // Seeing both families is the administrator's job: the audit is that nobody ELSE does.
  const lessons = await body(page, '/dashboard/lessons');
  expect(lessons).toContain(ASH().upcoming);
  expect(lessons).toContain(BREN().upcoming);
  expect(await body(page, '/dashboard/admin/people/students')).toContain(ASH().child);
  expect(await body(page, '/dashboard/activity')).toContain('Ashford report approved');
  expect(await body(page, '/dashboard/settings'), 'the platform default is theirs to change').toContain('Report approval');
  for (const family of [f.ashford, f.brenner]) {
    expect(await body(page, `/dashboard/lessons/${family.pastLessonId}`), 'an administrator may open either').toContain('past lesson');
  }

  // No tutor record, so the tutor tools are shut as well as hidden (3.11).
  expect(await body(page, '/dashboard')).not.toContain('Your teaching');
  await refused(page, '/dashboard/students', 403);
  await refused(page, '/dashboard/tutor/availability', 403);
  // Nor can they walk into a lesson as its tutor.
  await page.goto(`/dashboard/lessons/${f.ashford.upcomingLessonId}`);
  await expect(page.getByRole('button', { name: /join/i })).toHaveCount(0);
  await signOut(page);
});

test('an administrator who teaches has both, and still cannot teach another tutor’s lesson', async ({ page }) => {
  await signIn(page, f.teachingAdmin.username, f.teachingAdmin.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(await body(page, '/dashboard'), 'the tutor side of the dashboard').toContain('Your teaching');
  // The admin screens.
  expect(await body(page, '/dashboard/admin/people/tutors')).toContain('Teaching Admin');
  // The tutor tools, scoped to their own teaching: they teach nobody, so no student is theirs.
  const students = await body(page, '/dashboard/students');
  expect(students).not.toContain(ASH().child);
  expect(students).not.toContain(BREN().child);
  expect(await body(page, '/dashboard/tutor/availability')).toBeTruthy();
  // Another tutor's lesson: theirs to administer, never theirs to teach.
  await page.goto(`/dashboard/lessons/${f.ashford.upcomingLessonId}`);
  await expect(page.locator('main')).toContainText('Ashford upcoming lesson');
  await expect(page.getByRole('button', { name: /join/i }), 'no way in as its tutor').toHaveCount(0);
  await signOut(page);
});

test('signed out, every dashboard page asks for the sign-in and every download refuses', async ({ page }) => {
  for (const path of ['/dashboard', '/dashboard/lessons', `/dashboard/lessons/${f.ashford.pastLessonId}`, '/dashboard/children', '/dashboard/admin/people/students', `/dashboard/progress/${f.ashford.enrolled.studentId}`]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/login/);
  }
  for (const url of [`/api/reports/pdf?report=${f.ashford.reportId}`, `/api/lessons/${f.ashford.pastLessonId}/ics`]) {
    expect((await page.request.get(url)).status(), url).toBe(401);
  }
});
