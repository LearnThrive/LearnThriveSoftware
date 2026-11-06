import { test, expect, type Page } from '@playwright/test';

// Launch checklist 3.12: administrators review tutor applications in the dashboard, and nobody else can. The application is put in the
// dev server's in-memory store by /api/dev/careers-seed rather than by posting the real form, because this project has real email
// credentials and a genuine POST would send real email (what the route stores is tests/careersApply.test.mjs). The same rules on real
// Postgres and the real bucket are the store contract (packages/data, realstack.careers.test.ts).

// Each test walks several routes that `next dev` compiles on first use (the pages, both API routes, the actions), so it needs longer
// than a single-page spec.
test.describe.configure({ timeout: 120_000 });

const ACCOUNTS = {
  admin: { username: 'dev.admin', password: 'dev-admin-pass' },
  tutor: { username: 'dev.tutor', password: 'dev-tutor-pass' },
  client: { username: 'dev.client', password: 'dev-client-pass' },
  student: { username: 'dev.student', password: 'dev-student-pass' },
} as const;

async function login(page: Page, who: keyof typeof ACCOUNTS) {
  await page.request.post('/api/auth/logout');
  await page.goto('/login');
  await page.getByLabel('Username').fill(ACCOUNTS[who].username);
  await page.locator('input[name="password"]').fill(ACCOUNTS[who].password);
  await Promise.all([page.waitForURL(/\/dashboard$/), page.getByRole('button', { name: 'Sign in' }).click()]);
}

async function seed(page: Page): Promise<{ id: string; cvFileId: string; idFileId: string; name: string }> {
  const response = await page.request.post('/api/dev/careers-seed');
  expect(response.status()).toBe(200);
  return response.json();
}

/**
 * The confirmation an action shows. Read from the toast, not the URL: the Toaster strips ?toast= with router.replace() as soon as it
 * has shown it (see people.spec.ts), so the query string is a race.
 */
const toast = (page: Page) => page.locator('.toaster');

/** A card, found by its heading (other cards may mention the same words in their text). */
const card = (page: Page, title: string) => page.locator('.card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

/** Waits for the page's content, not its streamed loading shell (see docs/SCOPING_AUDIT.md). */
async function settled(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('main')).not.toContainText('Loading…', { timeout: 60_000 });
}

/** A server action's fields as Next renders them for a form without JavaScript (see tests-e2e-realstack/purge-guard.spec.ts). */
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

test('an administrator reviews an application: answers, a logged download, status, notes, checks, then deletion', async ({ page }) => {
  await login(page, 'admin');
  const app = await seed(page);
  const url = `/dashboard/admin/careers/${app.id}`;

  await settled(page, '/dashboard/admin/careers');
  await expect(page.getByRole('link', { name: new RegExp(app.name) })).toBeVisible();
  await page.getByRole('link', { name: new RegExp(app.name) }).click();
  await expect(page.getByRole('heading', { level: 1, name: app.name })).toBeVisible();
  await expect(page.getByText('A made-up application for testing.')).toBeVisible();

  // A download: always an attachment, never rendered as a page of this site, and never cached.
  const file = await page.request.get(`/api/admin/careers/${app.id}/files/${app.cvFileId}`);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('application/pdf');
  expect(file.headers()['content-disposition']).toMatch(/^attachment; filename="CV - test\.pdf"/);
  expect(file.headers()['x-content-type-options']).toBe('nosniff');
  expect(file.headers()['content-security-policy']).toContain('sandbox');
  expect(file.headers()['cache-control']).toContain('no-store');
  expect((await file.body()).subarray(0, 5).toString()).toBe('%PDF-');
  // One application's id does not reach another's file.
  const other = await seed(page);
  expect((await page.request.get(`/api/admin/careers/${other.id}/files/${app.cvFileId}`)).status()).toBe(404);

  // And the opening is in the history, with who.
  await settled(page, url);
  await expect(card(page, 'History')).toContainText('You opened CV');

  // Status: unsuccessful starts the retention clock.
  await page.getByLabel('Change the status').selectOption({ label: 'Unsuccessful' });
  await page.getByRole('button', { name: 'Save status' }).click();
  await expect(toast(page)).toContainText('Status updated');
  await expect(card(page, 'Status')).not.toContainText('Set when a decision is made');

  // A note.
  await page.getByLabel('Add a note').fill('Strong subject knowledge.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Strong subject knowledge.')).toBeVisible();

  // Identity seen, then the scan deleted: the record stays, the document goes.
  await page.getByRole('button', { name: 'Record identity as seen' }).click();
  await expect(toast(page)).toContainText('Identity recorded as seen');
  await expect(card(page, 'Checks')).toContainText('Seen');
  await page.getByLabel('Type DELETE DOCUMENTS to confirm').fill('DELETE DOCUMENTS');
  await page.getByRole('button', { name: 'Delete identity documents' }).click();
  await expect(toast(page)).toContainText('1 document deleted');
  expect((await page.request.get(`/api/admin/careers/${app.id}/files/${app.idFileId}`)).status()).toBe(404);

  // The subject access export carries the answers and the note, not the administrators' ids.
  const exported = await page.request.get(`/api/admin/careers/${app.id}/export`);
  expect(exported.status()).toBe(200);
  const body = await exported.json();
  expect(body.contact.lastName).toBe(app.name.replace('Test ', ''));
  expect(body.notes.map((n: { text: string }) => n.text)).toContain('Strong subject knowledge.');
  expect(JSON.stringify(body)).not.toMatch(/actorId|authorId|profile/);

  // Deleting needs the reason and the exact phrase; the wrong phrase changes nothing.
  await page.getByLabel('Why').selectOption({ label: 'The applicant asked us to delete it' });
  await page.getByLabel('Type DELETE APPLICATION to confirm').fill('delete it');
  await page.getByRole('button', { name: 'Delete for good' }).click();
  await expect(toast(page)).toContainText('Type DELETE APPLICATION exactly to confirm');
  await settled(page, url);
  await page.getByLabel('Why').selectOption({ label: 'The applicant asked us to delete it' });
  await page.getByLabel('Type DELETE APPLICATION to confirm').fill('DELETE APPLICATION');
  await page.getByRole('button', { name: 'Delete for good' }).click();
  await expect(toast(page)).toContainText('Application deleted');
  await expect(page).toHaveURL(/\/dashboard\/admin\/careers(\?|$)/);
  await expect(page.getByRole('link', { name: new RegExp(app.name) })).toHaveCount(0);
  expect((await page.request.get(`/api/admin/careers/${app.id}/files/${app.cvFileId}`)).status()).toBe(404);
  expect((await page.request.get(`/api/admin/careers/${app.id}/export`)).status()).toBe(404);
});

test('a tutor, a parent, a learner and a stranger can neither see an application, nor fetch its files, nor act on it', async ({ page }) => {
  await login(page, 'admin');
  const app = await seed(page);
  const url = `/dashboard/admin/careers/${app.id}`;
  const deletion = { ...(await replayOf(page, url, 'Delete for good')), reason: 'REQUEST', confirm: 'DELETE APPLICATION' };
  const note = { ...(await replayOf(page, url, 'Add note')), body: 'Should never be written.' };

  for (const who of ['tutor', 'client', 'student', null] as const) {
    const label = who ?? 'a stranger';
    if (who) await login(page, who);
    else await page.request.post('/api/auth/logout');

    expect((await page.request.get(`/api/admin/careers/${app.id}/files/${app.cvFileId}`)).status(), `${label}: file`).toBe(404);
    expect((await page.request.get(`/api/admin/careers/${app.id}/files/${app.idFileId}`)).status(), `${label}: identity file`).toBe(404);
    expect((await page.request.get(`/api/admin/careers/${app.id}/export`)).status(), `${label}: export`).toBe(404);

    // The page redirects after its loading shell has streamed, so a raw GET sees a 200: navigate and look where it lands.
    for (const path of ['/dashboard/admin/careers', url]) {
      await page.goto(path);
      await expect(page, `${label}: ${path}`).toHaveURL(who ? /\/403$/ : /\/login/);
      await expect(page.locator('body'), `${label}: nothing about the applicant`).not.toContainText(app.name);
    }

    // The forms' own action ids, replayed: refused by the action itself (a redirect to /403 or to sign in), not only by the page.
    for (const [what, body] of [['delete', deletion], ['note', note]] as const) {
      const reply = await page.request.post(url, { multipart: body, failOnStatusCode: false });
      expect(reply.url(), `${label}: ${what}`).toMatch(who ? /\/403$/ : /\/login/);
    }
  }

  // Still all there, untouched.
  await login(page, 'admin');
  await settled(page, url);
  await expect(page.getByRole('heading', { level: 1, name: app.name })).toBeVisible();
  await expect(page.getByText('Should never be written.')).toHaveCount(0);
});
