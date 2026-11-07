import { expect, test, type Page } from '@playwright/test';
import { distinctVisitor, hydrated, openDialog, signIn, signOut } from './_browser';
import { openSql, readFixture, recoveryTokenFor, type Sql } from './_stack';
import type { Fixture } from './global-setup';

/**
 * Launch checklist 2.4: the admin-created flow walked end to end on the REAL local Supabase stack — real GoTrue, real Postgres through
 * the production connection code, the real SQL data provider. The same walk runs against the in-memory backend in
 * tests-e2e/accounts.spec.ts; what only this can show is that real Auth, the real `provision_account` transaction and the real session
 * behave the same way.
 *
 * The one step this cannot do on this machine: the site emails its reset link through Resend's HTTP API (never SMTP), so with no Resend
 * key nothing is posted and the local mail catcher never sees it. The link itself is real — asked of real Auth through
 * `/admin/generate_link` — so the test reads the token Auth stored for it (which is exactly what the email would have carried) and
 * spends it the way the person would. The GoTrue-to-mail-catcher path is proved separately in tests/realstack.app.test.mjs.
 */

const CHOSEN = 'a password they chose themselves';
let sql: Sql;
let fixture: Fixture;
/** What the administrator makes during the walk, shared down the file (the steps depend on each other). */
const made: { parent?: Credentials; child?: Credentials; tutor?: Credentials } = {};
interface Credentials {
  username: string;
  temporaryPassword: string;
}

test.describe.configure({ mode: 'serial' });
distinctVisitor();

test.beforeAll(() => {
  fixture = readFixture<Fixture>();
  sql = openSql();
});
test.afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

const unique = (base: string) => `${base}-${fixture.run}`.toLowerCase();

/** The username and the temporary password the screen shows once, after a login is made. */
async function shownOnce(page: Page): Promise<Credentials> {
  const shown = page.getByTestId('temporary-password');
  await expect(shown).toBeVisible();
  const list = page.locator('dl').filter({ has: shown });
  return {
    username: (await list.locator('dd').first().textContent())!.trim(),
    temporaryPassword: (await shown.textContent())!.trim(),
  };
}

/** Signs in on a temporary password, proves nothing else opens, then chooses a password. */
async function mustChoosePassword(page: Page, who: Credentials, label: string) {
  await signIn(page, who.username, who.temporaryPassword);
  await expect(page, label).toHaveURL(/\/account\/reset$/);
  await expect(page.getByText('You signed in with a temporary password')).toBeVisible();
  for (const path of ['/dashboard', '/dashboard/lessons', '/account']) {
    await page.goto(path);
    await expect(page, `${label}: ${path} stays shut`).toHaveURL(/\/account\/reset$/);
  }
  expect((await page.request.get('/api/account/me')).status(), `${label}: /api/account/me`).toBe(401);

  await page.goto('/account/reset');
  await hydrated(page);
  await page.getByLabel('New password', { exact: true }).fill(CHOSEN);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('Your password has been changed')).toBeVisible();
}

test('the first administrator, made by the operator script, must choose a password before anything opens', async ({ page }) => {
  const who = { username: fixture.bootstrapAdmin.username, temporaryPassword: fixture.bootstrapAdmin.temporaryPassword };
  const [before] = await sql`select must_change_password from public.profiles where username = ${who.username}`;
  expect(before!.must_change_password, 'the operator script flags every account it makes').toBe(true);

  await mustChoosePassword(page, who, 'the first administrator');
  const [after] = await sql`select must_change_password, role from public.profiles where username = ${who.username}`;
  expect(after!.must_change_password).toBe(false);
  expect(after!.role).toBe('ADMIN');

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
  await signOut(page);
});

test('an administrator creates a family, a child, a tutor and the assignment that joins them', async ({ page }) => {
  const parentUsername = unique('rs-walk-parent');
  // Every name carries the run: the screens pick a parent and a tutor by the name shown, and an earlier run's leftovers must never win.
  const parentName = `Walked Parent ${fixture.run}`;
  const childName = `Walked ${fixture.run}`;
  const tutorName = `Walk Tutor ${fixture.run}`;
  await signIn(page, fixture.admin.username, fixture.admin.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  // The parent: their login and their family account together.
  await page.goto('/dashboard/admin/people/clients');
  const clientDialog = await openDialog(page, 'Add client');
  await clientDialog.getByLabel('Full name').fill(parentName);
  await clientDialog.getByLabel('Username').fill(parentUsername);
  await clientDialog.getByLabel('Email').fill(`${parentUsername}@example.com`);
  await clientDialog.getByRole('button', { name: 'Add client' }).click();
  made.parent = await shownOnce(page);
  expect(made.parent.username).toBe(parentUsername);
  // Real Auth holds the internal address, and the screen never shows it.
  const [authRow] = await sql`select email from auth.users where id = (select id from public.profiles where username = ${parentUsername})`;
  expect(authRow!.email).toBe(`${parentUsername}@accounts.learnthrivetuition.co.uk`);

  // The child: a student record under that parent, then a login whose username says nothing about them.
  await page.goto('/dashboard/admin/people/students');
  const studentDialog = await openDialog(page, 'Add student');
  await studentDialog.getByLabel('Full name').fill(childName);
  await studentDialog.getByLabel('Year group').fill('Year 8');
  await studentDialog.getByLabel('Parent or guardian').selectOption({ label: parentName });
  await studentDialog.getByRole('button', { name: 'Add student' }).click();
  await expect(page.locator('.person-list')).toContainText(childName);
  await page.goto(`/dashboard/admin/people/students?q=${encodeURIComponent(childName)}`);
  const studentHref = (await page.locator('a[href*="/dashboard/admin/students/"]').first().getAttribute('href'))!;
  await page.goto(studentHref);
  await page.getByRole('button', { name: 'Create login' }).click();
  made.child = await shownOnce(page);
  expect(made.child.username, 'a generated username that says nothing about the child').toMatch(/^[a-z]+-\d{4}$/);

  // The tutor: their record, then their login.
  await page.goto('/dashboard/admin/people/tutors');
  const tutorDialog = await openDialog(page, 'Add tutor');
  await tutorDialog.getByLabel('Full name').fill(tutorName);
  await tutorDialog.getByLabel('Email').fill(`${unique('rs-walk-tutor')}@example.com`);
  await tutorDialog.getByLabel('Subjects').fill('Mathematics');
  await tutorDialog.getByRole('button', { name: 'Add tutor' }).click();
  await page.goto(`/dashboard/admin/people/tutors?q=${encodeURIComponent(tutorName)}`);
  const tutorHref = (await page.locator('a[href*="/dashboard/admin/tutors/"]').first().getAttribute('href'))!;
  await page.goto(tutorHref);
  const tutorUsername = unique('rs-walk-tutor');
  // The page offers two: make a new login, or link one this person already has (an administrator who also teaches).
  await page.locator('#tutor-login-username').fill(tutorUsername);
  await page.getByRole('button', { name: 'Create login' }).click();
  made.tutor = await shownOnce(page);
  expect(made.tutor.username).toBe(tutorUsername);

  // The assignment: without one the family is not enrolled and the dashboard is nobody's home.
  await page.goto('/dashboard/admin/assignments');
  const assignmentDialog = await openDialog(page, 'Create assignment');
  await assignmentDialog.getByLabel('Title').fill(`Maths with ${childName}`);
  await assignmentDialog.getByLabel('Subject').fill('Maths');
  await assignmentDialog.getByLabel('Tutor').selectOption({ label: tutorName });
  await assignmentDialog.getByLabel('Student(s)').selectOption({ label: childName });
  await assignmentDialog.getByRole('button', { name: 'Create assignment' }).click();
  await expect(page.locator('main')).toContainText(`Maths with ${childName}`);

  // Every one of them is flagged by the real transaction, not by the screen's say-so.
  const flags = await sql`select username, must_change_password from public.profiles where username = any(${[made.parent.username, made.child.username, made.tutor.username]})`;
  expect(flags.length).toBe(3);
  expect(flags.every((row) => row.must_change_password)).toBe(true);
  await signOut(page);
});

test('the parent, the child and the tutor each sign in on their temporary password and must change it', async ({ page }) => {
  for (const [label, who] of [['the parent', made.parent!], ['the child', made.child!], ['the tutor', made.tutor!]] as const) {
    await mustChoosePassword(page, who, label);
    // Their own password works, and the temporary one is gone.
    await signOut(page);
    await signIn(page, who.username, CHOSEN);
    await expect(page, `${label} reaches the dashboard`).toHaveURL(/\/dashboard/);
    await signOut(page);
    const refused = await page.request.post('/api/account/login', { data: { username: who.username, password: who.temporaryPassword } });
    expect(refused.status(), `${label}: the temporary password no longer works`).toBe(401);
  }
});

test('a forgotten password is reset by the one-time link, and the link works once', async ({ page }) => {
  const child = made.child!;
  await page.goto('/account/forgot');
  await hydrated(page);
  const card = page.locator('[data-auth-mode]');
  await card.getByLabel('Username', { exact: true }).fill(child.username);
  await expect(page.getByText('Checked: you are a person.')).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Send reset link' }).click();
  await expect(card, "the answer says nothing about whether the username exists").toContainText('goes to their parent');

  // The token real Auth issued for the link the site asked for (see the file header: Resend cannot post from this machine).
  const token = await recoveryTokenFor(sql, child.username);
  await page.goto(`/account/confirm?token_hash=${encodeURIComponent(token)}&type=recovery`);
  await hydrated(page);
  await page.getByRole('button', { name: 'Choose a new password' }).click();
  await page.waitForURL(/\/account\/reset/, { timeout: 60_000 });
  const second = 'the password after the reset link';
  await page.getByLabel('New password', { exact: true }).fill(second);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('Your password has been changed')).toBeVisible();

  await signOut(page);
  await signIn(page, child.username, second);
  await expect(page).toHaveURL(/\/dashboard/);
  await signOut(page);

  // Single use: the same token cannot be spent again.
  await page.goto(`/account/confirm?token_hash=${encodeURIComponent(token)}&type=recovery`);
  await hydrated(page);
  await page.getByRole('button', { name: 'Choose a new password' }).click();
  // The page's own message, not the layout's empty live region.
  await expect(page.getByText(/could not use that link|not valid|expired/i)).toBeVisible();
  await expect(page, 'a spent link opens nothing').toHaveURL(/\/account\/confirm/);
});

test('signing out closes the dashboard again', async ({ page }) => {
  await signIn(page, made.parent!.username, CHOSEN);
  await expect(page).toHaveURL(/\/dashboard/);
  await signOut(page);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get('/api/account/me')).status()).toBe(401);
});
