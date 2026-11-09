import { expect, test, type Page } from '@playwright/test';
import { distinctVisitor, hydrated } from './account-support';

// The safeguarding records in a browser (docs/SAFEGUARDING_RECORDS.md), on the dev server's in-memory backend. The dev server is started
// with SAFEGUARDING_LEAD_EMAILS=admin@learnthrive.dev (playwright.config.ts), so dev.admin is the named lead and dev.teaching-admin is an
// administrator who is NOT one: the case that matters. The rules themselves are proven on the data layer on memory and Postgres
// (packages/data safeguardingContract); this proves the screens keep to them.

distinctVisitor();

const DETAILS = 'The learner went quiet when asked about home and said something that worried me. Tuesday 17:20.';

async function signIn(page: Page, username: string, password: string) {
  await page.goto('/login');
  await hydrated(page);
  await page.getByLabel('Username').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 30_000 });
}

async function signOut(page: Page) {
  await page.request.post('/api/account/logout', { data: {} });
}

/** The dashboard streams its shell before a redirect or notFound runs, so a refusal is read from what the page says, not the status code. */
async function expectRefused(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/don.t have access|not found|can.t be found/i, { timeout: 30_000 });
}

test('a tutor raises a concern; only the named lead can read it, and every refusal is on its record', async ({ page }) => {
  test.setTimeout(180_000);

  // ---- the tutor raises it, and afterwards sees a reference, never what they wrote
  await signIn(page, 'dev.tutor', 'dev-tutor-pass');
  await page.goto('/dashboard/concerns');
  await expect(page.getByText('call 999 first')).toBeVisible();
  await page.getByLabel('What is it about').selectOption('DISCLOSURE');
  await page.getByLabel('Who is it about').fill('A learner in my Tuesday lesson');
  await page.getByLabel('What you saw or heard').fill(DETAILS);
  await page.getByLabel('Could someone be in immediate danger').selectOption('true');
  await page.getByRole('button', { name: 'Send to the safeguarding lead' }).click();
  const confirmation = page.getByRole('status').filter({ hasText: 'Your concern has been recorded' });
  await expect(confirmation).toBeVisible({ timeout: 30_000 });
  const reference = (await confirmation.textContent())!.match(/SC-\d{8}-[0-9A-F]{6}/)![0];
  await expect(page.getByText('Concerns you have raised')).toBeVisible();
  await expect(page.locator('.record-list__title', { hasText: reference })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('went quiet');

  // ---- the tutor cannot open the log, the register, or a concern by its address
  await expectRefused(page, '/dashboard/admin/concerns');
  await expectRefused(page, '/dashboard/admin/vetting');
  await signOut(page);

  // ---- the named lead finds it, flagged, and reads it
  await signIn(page, 'dev.admin', 'dev-admin-pass');
  await page.goto('/dashboard/admin/concerns');
  const row = page.locator('.record-list__item', { hasText: reference });
  await expect(row).toContainText('Immediate danger');
  await expect(row).not.toContainText('went quiet');
  await row.getByRole('link').click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(reference, { timeout: 30_000 });
  await expect(page.getByText(DETAILS)).toBeVisible();
  const concernPath = new URL(page.url()).pathname;
  await signOut(page);

  // ---- another administrator is not a lead: no list, and the address itself is refused
  await signIn(page, 'dev.teaching-admin', 'dev-teaching-admin-pass');
  await page.goto('/dashboard/admin/concerns');
  await expect(page.getByText('You are not a named safeguarding lead')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('body')).not.toContainText(reference);
  await expectRefused(page, concernPath);
  await expect(page.locator('body')).not.toContainText('went quiet');
  await signOut(page);

  // ---- a parent has no way in at all
  await signIn(page, 'dev.client', 'dev-client-pass');
  await expectRefused(page, '/dashboard/concerns');
  await expectRefused(page, concernPath);
  await signOut(page);

  // ---- back as the lead: the refused attempt is on the record, and the status moves with a note
  await signIn(page, 'dev.admin', 'dev-admin-pass');
  await page.goto(concernPath);
  await expect(page.getByText('tried to open it and was refused').first()).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Status').selectOption('IN_REVIEW');
  await page.getByLabel('Note').fill('Spoke to the tutor by phone.');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('OPEN to IN_REVIEW: Spoke to the tutor by phone.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DETAILS)).toBeVisible();
});

test('an administrator records a tutor check; a certificate number is refused; the register shows what is missing', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, 'dev.admin', 'dev-admin-pass');

  await page.goto('/dashboard/admin/vetting');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tutor checks');
  await expect(page.getByText('Required, not recorded').first()).toBeVisible();

  await page.goto('/dashboard/admin/tutors/tutor-jamie-patel');
  const dialog = page.getByRole('dialog');
  const open = async () => {
    await expect(async () => {
      if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Record a check' }).click({ timeout: 2000 });
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass();
  };

  // A 12-digit certificate number is refused with the reason, and nothing is recorded.
  await open();
  await dialog.locator('select[name="kind"]').selectOption('DBS');
  await dialog.getByLabel('How it was seen').fill('Certificate 001234567890');
  await dialog.getByRole('button', { name: 'Record check' }).click();
  await expect(page.getByText('Do not record a certificate number')).toBeVisible({ timeout: 30_000 });

  await open();
  await dialog.locator('select[name="kind"]').selectOption('DBS');
  await dialog.getByLabel('How it was seen').fill('Update Service');
  await dialog.getByRole('button', { name: 'Record check' }).click();
  await expect(page.getByText('Check recorded')).toBeVisible({ timeout: 30_000 });
  const dbs = page.locator('.record-list__item', { hasText: 'DBS check' });
  await expect(dbs).toContainText('Update Service');
  await expect(dbs).toContainText('Seen');
});
