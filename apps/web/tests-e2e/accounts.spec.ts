import { expect, test, type Page } from '@playwright/test';
import { distinctVisitor, expectAxeClean, hydrated, link } from './account-support';
import { humanCheckDone } from './careers-support';

// LearnThrive makes every account and people sign in with a username (launch checklist 3.2.9, 3.11.4; docs/AUTHENTICATION.md). All of this runs
// on the dev server's in-memory backend; the real Auth service is proved in tests/realstack.accounts.test.mjs.

distinctVisitor();

const NEW_PASSWORD = 'a password of their own';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await hydrated(page);
  await page.getByLabel('Username').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Wherever they land, it is not /login: the dev server may still be compiling that page, so this waits longer than an expect would.
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 30_000 });
}

async function signOut(page: Page) {
  await page.request.post('/api/account/logout', { data: {} });
}

/** One name per test attempt: the in-memory backend lives as long as the dev server. */
function unique(base: string): string {
  return `${base}-${test.info().workerIndex}${test.info().retry}${Date.now().toString(36)}`;
}

/**
 * Opens one of the dashboard's dialogs. The dashboard sets no hydration marker (hydrated() waits for one the public and account pages set),
 * and a click before hydration does nothing, so the button is pressed again until the dialog is open: never once it is, because the
 * open dialog covers the button.
 */
async function openDialog(page: Page, button: string) {
  const dialog = page.getByRole('dialog');
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: button }).first().click({ timeout: 2000 });
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass();
  return dialog;
}

async function temporaryPassword(page: Page): Promise<string> {
  const shown = page.getByTestId('temporary-password');
  await expect(shown).toBeVisible();
  return (await shown.textContent())!.trim();
}

async function addClient(page: Page, name: string, username: string, email: string): Promise<string> {
  await page.goto('/dashboard/admin/people/clients');
  const dialog = await openDialog(page, 'Add client');
  await dialog.getByLabel('Full name').fill(name);
  await dialog.getByLabel('Username').fill(username);
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('button', { name: 'Add client' }).click();
  return temporaryPassword(page);
}

test('a refused username keeps what was typed, and says why', async ({ page }) => {
  test.slow(); // the first visit to each admin page is compiled by the dev server
  await signIn(page, 'dev.admin', 'dev-admin-pass');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/dashboard/admin/people/clients');
  const dialog = await openDialog(page, 'Add client');
  await dialog.getByLabel('Full name').fill('Kept Name');
  await dialog.getByLabel('Username').fill('admin');
  await dialog.getByLabel('Email').fill('kept@example.com');
  await dialog.getByRole('button', { name: 'Add client' }).click();
  await expect(dialog.getByRole('alert')).toContainText('reserved');
  await expect(dialog.getByLabel('Full name')).toHaveValue('Kept Name');
  await expect(dialog.getByLabel('Email')).toHaveValue('kept@example.com');
});

test('a new parent: the temporary password opens nothing until they choose their own, and then their account is theirs', async ({ page }) => {
  test.slow(); // a whole journey across two accounts and several pages
  const username = unique('parent');
  await signIn(page, 'dev.admin', 'dev-admin-pass');
  await expect(page).toHaveURL(/\/dashboard$/);
  const password = await addClient(page, 'New Parent', username, `${username}@example.com`);
  await expect(page).not.toHaveURL(new RegExp(password), { timeout: 1 });
  await signOut(page);

  await signIn(page, username, password);
  await expect(page).toHaveURL(/\/account\/reset$/);
  await expect(page.getByText('You signed in with a temporary password')).toBeVisible();
  await expectAxeClean(page, 'choose a password');
  for (const path of ['/dashboard', '/account', '/library']) {
    await page.goto(path);
    if (path !== '/library') await expect(page, `${path} stays shut`).toHaveURL(/\/account\/reset$/);
  }
  expect((await page.request.get('/api/account/me')).status()).toBe(401);

  await page.goto('/account/reset');
  await hydrated(page);
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('Your password has been changed')).toBeVisible();

  // At once, not after a cache has expired: this is what the page-and-route cache bug broke.
  await page.goto('/account');
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator('dl')).toContainText(username);
  await expect(page.locator('dl')).toContainText(`${username}@example.com`);
  await expect(page.locator('dl')).not.toContainText('accounts.learnthrivetuition.co.uk');
});

test('a child: a generated username, and their forgotten password goes to their parent', async ({ page }) => {
  test.slow(); // a whole journey: a family, a student, a login and a reset
  const parent = unique('family');
  const email = `${parent}@example.com`;
  await signIn(page, 'dev.admin', 'dev-admin-pass');
  await expect(page).toHaveURL(/\/dashboard$/);
  await addClient(page, 'Family Parent', parent, email);

  await page.goto('/dashboard/admin/people/students');
  const dialog = await openDialog(page, 'Add student');
  await dialog.getByLabel('Full name').fill(`Child of ${parent}`);
  await dialog.getByRole('combobox').selectOption({ label: 'Family Parent' });
  await dialog.getByRole('button', { name: 'Add student' }).click();
  await expect(page.locator('.person-list')).toContainText(`Child of ${parent}`);
  await page.goto(`/dashboard/admin/people/students?q=${encodeURIComponent(parent)}`);
  // Straight to the profile: a click waits only five seconds for a page the dev server may still be compiling.
  await page.goto((await page.locator('a[href*="/dashboard/admin/students/"]').first().getAttribute('href'))!);
  await page.getByRole('button', { name: 'Create login' }).click();
  await temporaryPassword(page);
  const shown = page.locator('dl').filter({ has: page.getByTestId('temporary-password') });
  const username = (await shown.locator('dd').first().textContent())!.trim();
  expect(username).toMatch(/^[a-z]+-\d{4}$/);
  await signOut(page);

  await page.goto('/account/forgot');
  await hydrated(page);
  const card = page.locator('[data-auth-mode]');
  await card.getByLabel('Username', { exact: true }).fill(username);
  await humanCheckDone(page);
  await card.getByRole('button', { name: 'Send reset link' }).click();
  await expect(card).toContainText('goes to their parent');
  await page.goto(await link(page, email, 'recovery'));
  await hydrated(page);
  await expect(page).toHaveURL(/\/account\/confirm/);
});

/** A server action's fields as Next renders them for a form without JavaScript (as in careers-review.spec.ts). */
async function replayOf(page: Page, url: string, button: string): Promise<Record<string, string>> {
  const html = await (await page.request.get(url)).text();
  for (const chunk of html.split('<form').slice(1)) {
    const body = chunk.split('</form>')[0] ?? '';
    if (!body.includes(`>${button}<`)) continue;
    const actionId = /name="(\$ACTION_ID_[0-9a-f]+)"/.exec(body)?.[1];
    expect(actionId, `the ${button} form posts a server action`).toBeTruthy();
    const replay: Record<string, string> = { [actionId!]: '' };
    for (const field of body.matchAll(/name="([a-zA-Z]+)"(?:\s+value="([^"]*)")?/g)) replay[field[1]!] = field[2] ?? '';
    return replay;
  }
  throw new Error(`no form with a ${button} button in ${url}`);
}

test("a child's login from the staff side: suspended and restored, nobody else can, then removed for good and a new one offered", async ({ page }) => {
  test.slow(); // a family, a student, a login, and the page several times over
  const parent = unique('staffside');
  await signIn(page, 'dev.admin', 'dev-admin-pass');
  await expect(page).toHaveURL(/\/dashboard$/);
  await addClient(page, 'Staffside Parent', parent, `${parent}@example.com`);
  await page.goto('/dashboard/admin/people/students');
  const dialog = await openDialog(page, 'Add student');
  await dialog.getByLabel('Full name').fill(`Pupil of ${parent}`);
  await dialog.getByRole('combobox').selectOption({ label: 'Staffside Parent' });
  await dialog.getByRole('button', { name: 'Add student' }).click();
  await expect(page.locator('.person-list')).toContainText(`Pupil of ${parent}`);
  await page.goto(`/dashboard/admin/people/students?q=${encodeURIComponent(parent)}`);
  const url = new URL((await page.locator('a[href*="/dashboard/admin/students/"]').first().getAttribute('href'))!, page.url()).pathname;
  await page.goto(url);
  await page.getByRole('button', { name: 'Create login' }).click();
  const password = await temporaryPassword(page);
  const username = (await page.locator('dl').filter({ has: page.getByTestId('temporary-password') }).locator('dd').first().textContent())!.trim();

  const login = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Login', exact: true }) });
  await page.goto(url);
  await expect(login).toContainText('Open');
  await login.getByRole('button', { name: 'Suspend login' }).click();
  await expect(page.locator('.toaster')).toContainText('Login suspended');
  // Still the same login, not "no login": the record's own link names only an active one.
  await expect(login).toContainText(username);
  await expect(login).toContainText('Suspended: they can sign in, but nothing opens');
  await expect(page.getByRole('button', { name: 'Create login' })).toHaveCount(0);
  await expectAxeClean(page, 'a student with a suspended login');

  // The forms' own action ids, replayed by a tutor and a parent: refused by the action itself, and nothing changes.
  const restore = await replayOf(page, url, 'Restore login');
  const remove = { ...(await replayOf(page, url, 'Remove login')), confirm: 'yes' };
  for (const [who, pass] of [['dev.tutor', 'dev-tutor-pass'], ['dev.client', 'dev-client-pass']] as const) {
    await signOut(page);
    await signIn(page, who, pass);
    for (const [what, body] of [['restore', restore], ['remove', remove]] as const) {
      const reply = await page.request.post(url, { multipart: body, failOnStatusCode: false });
      expect(reply.url(), `${who}: ${what}`).toMatch(/\/403$/);
    }
  }
  await signOut(page);
  await signIn(page, 'dev.admin', 'dev-admin-pass');
  await page.goto(url);
  await expect(login).toContainText('Suspended');

  await login.getByRole('button', { name: 'Restore login' }).click();
  await expect(page.locator('.toaster')).toContainText('Login restored');
  await expect(login).toContainText('Open');

  // Removing needs the box ticked: the browser will not send the form without it.
  await login.getByRole('button', { name: 'Remove login' }).click();
  await expect(login).toContainText(username);
  await login.getByLabel(/Remove this login for good/).check();
  await login.getByRole('button', { name: 'Remove login' }).click();
  await expect(page.locator('.toaster')).toContainText('Login removed');
  await expect(page.getByText("This student's last login was removed.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create login' })).toBeVisible();

  // The old username cannot sign in at all.
  await signOut(page);
  await page.goto('/login');
  await hydrated(page);
  await page.getByLabel('Username').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('form [role="alert"]')).toContainText('disabled');
  await expect(page).toHaveURL(/\/login/);
});

test('an administrator who teaches has the tutor tools and the admin screens, and teaches only their own lessons', async ({ page }) => {
  test.slow(); // several pages, each compiled on its first visit
  await signIn(page, 'dev.teaching-admin', 'dev-teaching-admin-pass');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('.app-usermenu__role')).toContainText('Admin');
  await expect(page.getByRole('heading', { name: 'Your teaching' })).toBeVisible();
  const nav = page.getByRole('navigation').first();
  await expect(nav.getByRole('link', { name: 'Availability' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'My students' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Tutors' })).toBeVisible();

  await page.goto('/dashboard/tutor/availability');
  await expect(page.getByRole('heading', { name: 'My availability' })).toBeVisible();
  await page.goto('/dashboard/students');
  await expect(page.locator('main')).not.toContainText('Brian', { timeout: 5000 });

  // Another tutor's lesson: they may manage it as an administrator, and cannot walk in as its tutor.
  await page.goto('/dashboard/lessons/lesson-gcse-maths-upcoming');
  await expect(page.getByRole('button', { name: /join/i })).toHaveCount(0);
});

test('an administrator who does not teach has no tutor tools, and the pages are shut as well as hidden', async ({ page }) => {
  await signIn(page, 'dev.admin', 'dev-admin-pass');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Your teaching' })).toHaveCount(0);
  await expect(page.getByRole('navigation').first().getByRole('link', { name: 'Availability' })).toHaveCount(0);
  for (const path of ['/dashboard/tutor/availability', '/dashboard/students']) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/403$/);
  }
});

test('a tutor has no admin screens', async ({ page }) => {
  await signIn(page, 'dev.tutor', 'dev-tutor-pass');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/dashboard/admin/people/clients');
  await expect(page).toHaveURL(/\/403$/);
});
