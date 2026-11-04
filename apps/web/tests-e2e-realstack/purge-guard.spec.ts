import { expect, test, type Page } from '@playwright/test';
import { distinctVisitor, hydrated, signIn, signOut } from './_browser';
import { openSql, readFixture, type Sql } from './_stack';
import type { Fixture } from './global-setup';

/**
 * Launch checklist 3.7.6, the last of its claims: **a purge cannot be run by a non-admin.**
 *
 * The page guard is not the thing under test here — the scoping audit already proves a non-admin gets /403 on the admin screens. A
 * Server Action is a public POST endpoint of its own, so this takes the form's real action id from the administrator's own page and
 * replays that exact request as a tutor, as a parent, as a learner and signed out. The proof is the database: the student is still
 * there afterwards. `lib/actions/purge.ts` re-checks ADMIN itself, and this is what says so.
 *
 * Its own throwaway student, assignment and lesson, so no other spec's fixtures are touched by the purge at the end.
 */

distinctVisitor();
test.describe.configure({ mode: 'serial' });

let f: Fixture;
let sql: Sql;
let studentId = '';
let lessonId = '';
let assignmentId = '';
let page_url = '';
/** Each form's own fields, read from the administrator's page: the three POST endpoints the panel offers. */
const replays: { mark?: Replay; forward?: Replay; purge?: Replay } = {};
type Replay = Record<string, string>;

const NAME = () => `Disposable-${f.run}`;

test.beforeAll(async () => {
  f = readFixture<Fixture>();
  sql = openSql();
  const [student] = await sql<{ id: string }[]>`
    insert into public.students (client_id, display_name, year_group) values (${f.ashford.clientId}, ${`Disposable-${f.run}`}, 'Year 5') returning id`;
  studentId = student!.id;
  // An assignment and a lesson of its own: a purge must remove something real, and nothing else may depend on them.
  const [assignment] = await sql<{ id: string }[]>`
    insert into public.tuition_assignments (title, subject, tutor_id, status) values (${`Disposable ${f.run}`}, 'Maths', ${f.ashford.tutor.tutorId}, 'ACTIVE') returning id`;
  assignmentId = assignment!.id;
  await sql`insert into public.assignment_students (assignment_id, student_id) values (${assignmentId}, ${studentId})`;
  const [lesson] = await sql<{ id: string }[]>`
    insert into public.lessons (assignment_id, tutor_id, title, subject, start_at, duration_minutes, location_type, status)
    values (${assignmentId}, ${f.ashford.tutor.tutorId}, ${`Disposable-${f.run} lesson`}, 'Maths', now() - interval '2 days', 60, 'ONLINE', 'COMPLETED') returning id`;
  lessonId = lesson!.id;
  await sql`insert into public.lesson_students (lesson_id, student_id) values (${lessonId}, ${studentId})`;
  page_url = `/dashboard/admin/students/${studentId}`;
});

test.afterAll(async () => {
  // Whatever the tests did, leave nothing of this spec's own behind.
  if (studentId) {
    await sql`delete from public.lessons where assignment_id = ${assignmentId}`;
    await sql`delete from public.tuition_assignments where id = ${assignmentId}`;
    await sql`delete from public.students where id = ${studentId}`;
  }
  await sql?.end({ timeout: 5 });
});

const stillThere = async () => (await sql`select count(*)::int as n from public.students where id = ${studentId}`)[0]!.n === 1;

/**
 * Everything needed to post one of the panel's forms by hand: its fields, and the `$ACTION_ID_<hash>` Next puts in a form so it works
 * without JavaScript. The hash is build-specific, so it is read rather than written down.
 *
 * Read from the SERVER-RENDERED HTML, not from the live DOM: React drops that hidden field once the page hydrates, so reading the DOM
 * is a race that passes or fails on how quickly hydration finishes. `page.request` carries the browser's cookies, so this is fetched
 * as the signed-in administrator.
 */
async function replayOf(page: Page, url: string, button: string): Promise<Replay> {
  const html = await (await page.request.get(url)).text();
  // These forms are small and all come from one component, so splitting on the tags is enough; there is no nesting to get wrong.
  for (const chunk of html.split('<form').slice(1)) {
    const body = chunk.split('</form>')[0] ?? '';
    if (!body.includes(`>${button}<`)) continue;
    const actionId = /name="(\$ACTION_ID_[0-9a-f]+)"/.exec(body)?.[1];
    expect(actionId, `the ${button} form posts a server action`).toBeTruthy();
    const replay: Replay = { [actionId!]: '' };
    for (const field of body.matchAll(/name="([a-zA-Z]+)"(?:\s+value="([^"]*)")?/g)) replay[field[1]!] = field[2] ?? '';
    return replay;
  }
  throw new Error(`no form with a ${button} button in ${url}`);
}

/** Waits for the page's content, not its streamed loading shell (see docs/SCOPING_AUDIT.md). */
async function settled(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('main')).not.toContainText('Loading…', { timeout: 60_000 });
}

test('the pause comes first: no purge is offered until they are marked as left and the date is brought forward', async ({ page }) => {
  await signIn(page, f.admin.username, f.admin.password);
  await settled(page, page_url);
  await expect(page.getByText('Purge this student')).toBeVisible();
  // Anchored on the heading, not on a button: which buttons the panel offers is exactly what changes as the pause runs.
  const card = page.locator('.card').filter({ hasText: 'Purge this student' });

  // Nothing to confirm yet: the only thing on offer is marking them as left.
  await expect(page.getByRole('button', { name: 'Purge for good' }), 'no purge before the pause').toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Mark as left' })).toBeVisible();
  replays.mark = await replayOf(page, page_url, 'Mark as left');
  await card.getByRole('button', { name: 'Mark as left' }).click();
  await expect(page.locator('main')).not.toContainText('Loading…', { timeout: 60_000 });

  // Marked, and waiting. Still nothing to confirm, and the record is untouched.
  await settled(page, page_url);
  await expect(card.getByText('Can be purged from')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Purge for good' }), 'still no purge inside the pause').toHaveCount(0);
  expect(await stillThere()).toBe(true);
  const [row] = await sql`select left_at, purge_after, left_by from public.students where id = ${studentId}`;
  expect(row!.left_at, 'the leaving date is recorded').not.toBeNull();
  expect(row!.left_by, 'and who said so').toBe(f.admin.profileId);
  expect(new Date(String(row!.purge_after)).getTime(), 'with the pause ahead of us').toBeGreaterThan(Date.now());

  // Bring it forward to today, which is the administrator's to do.
  replays.forward = { ...(await replayOf(page, page_url, 'Bring it forward')), purgeAfter: new Date().toISOString().slice(0, 10) };
  await card.locator('input[name="purgeAfter"]').fill(new Date().toISOString().slice(0, 10));
  await card.getByRole('button', { name: 'Bring it forward' }).click();
  await settled(page, page_url);
  await expect(page.getByRole('button', { name: 'Purge for good' }), 'now it can be confirmed').toBeVisible();
  await expect(page.getByText('This removes, in one step:')).toBeVisible();
  // The preview says what goes, and names no one. Scoped to the panel: the page around it is this student's own profile, which
  // of course shows their name in its header.
  const panel = await card.innerText();
  expect(panel).toContain('The student record');
  expect(panel, 'the preview itself never names the person').not.toContain(NAME());

  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Purge for good' }) });
  replays.purge = { ...(await replayOf(page, page_url, 'Purge for good')), confirm: 'PURGE STUDENT' };

  await form.getByLabel(/Type PURGE STUDENT to confirm/).fill('purge it please');
  await form.getByRole('button', { name: 'Purge for good' }).click();
  await expect(page.locator('main')).not.toContainText('Loading…', { timeout: 60_000 });
  expect(await stillThere(), 'the wrong phrase must change nothing').toBe(true);
  await signOut(page);
});

test('a tutor, a parent, a learner and a stranger cannot run it, even with the form’s own action id', async ({ page }) => {
  const who = [
    ['the tutor', f.ashford.tutor.username, f.ashford.tutor.password],
    ['the parent', f.ashford.parent.username, f.ashford.parent.password],
    ['the learner', f.ashford.enrolled.learner.username, f.ashford.enrolled.learner.password],
  ] as const;

  // All three of the panel's endpoints, not only the purge: marking as left and moving the date are administrators' work too.
  const endpoints = [['purge', replays.purge!], ['mark as left', replays.mark!], ['bring forward', replays.forward!]] as const;

  for (const [label, username, password] of who) {
    await signIn(page, username, password);
    for (const [what, body] of endpoints) {
      const reply = await page.request.post(page_url, { multipart: body, failOnStatusCode: false });
      // The database is the claim. The status is not: the action redirects and Playwright follows it, so a refusal arrives as a 200
      // from /403 — which is why the final URL is checked instead of the code.
      expect(await stillThere(), `${label} must not be able to ${what}`).toBe(true);
      expect(reply.url(), `${label}: ${what} should have sent them to /403`).toMatch(/\/403$/);
    }
    // And the screen the panel lives on is shut to them as well.
    await page.goto(page_url);
    await expect(page, `${label} cannot open the page either`).toHaveURL(/\/403$/);
    await signOut(page);
  }

  // Signed out entirely: the guard sends them to the sign-in instead.
  for (const [what, body] of endpoints) {
    const stranger = await page.request.post(page_url, { multipart: body, failOnStatusCode: false });
    expect(await stillThere(), `a stranger must not be able to ${what}`).toBe(true);
    expect(stranger.url(), `a stranger asking to ${what} is sent to sign in`).toMatch(/\/login/);
  }
});

test('an administrator with the right phrase purges it, and the log records only counts', async ({ page }) => {
  const before = (await sql`select count(*)::int as n from public.data_purges`)[0]!.n;
  await signIn(page, f.admin.username, f.admin.password);
  await settled(page, page_url);
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Purge for good' }) });
  await form.getByLabel(/Type PURGE STUDENT to confirm/).fill('PURGE STUDENT');
  await form.getByRole('button', { name: 'Purge for good' }).click();
  await page.waitForURL(/\/dashboard\/admin\/people\/students/, { timeout: 60_000 });

  expect(await stillThere(), 'the student is gone').toBe(false);
  expect((await sql`select count(*)::int as n from public.lessons where id = ${lessonId}`)[0]!.n, 'their lesson went with them').toBe(0);
  const [assignment] = await sql`select status, title from public.tuition_assignments where id = ${assignmentId}`;
  expect(assignment!.status, 'an assignment with nobody left on it is ended').toBe('ENDED');
  expect(String(assignment!.title), 'and does not keep their name').not.toContain(NAME());

  const rows = await sql`select kind, actor_profile_id, counts from public.data_purges order by at desc limit 1`;
  expect((await sql`select count(*)::int as n from public.data_purges`)[0]!.n).toBe(before + 1);
  expect(rows[0]!.kind).toBe('STUDENT');
  expect(rows[0]!.actor_profile_id).toBe(f.admin.profileId);
  expect(JSON.stringify(rows[0]!.counts), 'the log holds counts, never the person').not.toContain(NAME());
  expect(JSON.stringify(rows[0]!.counts)).not.toContain(studentId);

  // The family and the sibling it was created under are untouched.
  expect((await sql`select count(*)::int as n from public.clients where id = ${f.ashford.clientId}`)[0]!.n).toBe(1);
  expect((await sql`select count(*)::int as n from public.students where id = ${f.ashford.enrolled.studentId}`)[0]!.n).toBe(1);
  await signOut(page);
});

test('the purged student leaves nothing behind on the pages that listed them', async ({ page }) => {
  await signIn(page, f.admin.username, f.admin.password);
  for (const path of ['/dashboard/admin/people/students', '/dashboard/lessons', '/dashboard/admin/assignments']) {
    await settled(page, path);
    await hydrated(page).catch(() => {});
    expect(await page.locator('main').innerText(), `${path} still names them`).not.toContain(NAME());
  }
  await signOut(page);
});
