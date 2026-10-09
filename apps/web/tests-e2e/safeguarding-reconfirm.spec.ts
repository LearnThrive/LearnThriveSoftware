import { test, expect, type Page } from '@playwright/test';
import { agreement, expectNoAxeViolations, humanCheckDone, mockPost } from './careers-support';

// The yearly reconfirmation page (/safeguarding/reconfirm). The dev server opens it for testing while the
// agreement is still a draft. POST /api/safeguarding/reconfirm is MOCKED in every test: this project has real
// email credentials, so a genuine POST would send a real email. The route itself is covered, with the email
// call replaced, by tests/reconfirm.test.mjs.

const SUCCESS = { success: true, reference: 'LT-RECONF-20261009-K7QX2M', changeDeclared: false };
const send = (page: Page) => page.getByRole('button', { name: 'Reconfirm the agreement' });

async function fill(page: Page, { change = 'none' }: { change?: 'none' | 'changed' } = {}) {
  await page.getByLabel('Full name', { exact: true }).fill('Jane Smith');
  await page.getByLabel('Email address', { exact: true }).fill('jane@example.com');
  const choice = page.getByRole('radio', { name: change === 'none' ? /Nothing has changed/ : /Something has changed/ });
  await choice.focus();
  await page.keyboard.press('Space');
  for (const part of agreement.parts) await page.getByRole('checkbox', { name: new RegExp(`Part ${part.id}: `) }).check();
  await page.getByLabel('Type your full name to confirm').fill('jane smith');
}

test.describe('reconfirming the safeguarding agreement', () => {
  test('shows the whole agreement with a tick-box for every part, and no understanding check by default', async ({ page }) => {
    await page.goto('/safeguarding/reconfirm');
    await expect(page.getByRole('heading', { level: 1, name: 'Reconfirm the safeguarding agreement' })).toBeVisible();
    for (const part of agreement.parts) {
      await expect(page.getByRole('heading', { name: new RegExp(`^Part ${part.id}: `) })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: new RegExp(`Part ${part.id}: `) })).not.toBeChecked();
    }
    await expect(page.getByRole('heading', { name: 'Check you have understood' })).toHaveCount(0);
    await expect(page.locator('main')).toContainText(`Agreement version ${agreement.version}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('a complete reconfirmation is sent, with the name typed and every part, and the success panel takes focus', async ({ page }) => {
    const sent = await mockPost(page, '**/api/safeguarding/reconfirm', { json: SUCCESS });
    await page.goto('/safeguarding/reconfirm');
    await fill(page);
    await humanCheckDone(page);
    await send(page).click();

    const panel = page.getByRole('status').filter({ hasText: 'Your reconfirmation has been recorded.' });
    await expect(panel).toBeVisible();
    await expect(panel).toBeFocused();
    await expect(panel).toContainText('LT-RECONF-20261009-K7QX2M');
    await expect(panel).not.toContainText('something has changed');
    expect(sent.calls).toBe(1);
    expect(sent.contentType).toContain('application/json');
    const body = JSON.parse(sent.body);
    expect(body).toMatchObject({ fullName: 'Jane Smith', change: 'none', typedName: 'jane smith', agreementVersion: agreement.version, agreedParts: agreement.parts.map((part) => part.id) });
    expect(body.humanCheck.kind).toBe('pow');
  });

  test('choosing "something has changed" says to contact the safeguarding lead at once, and marks the submission', async ({ page }) => {
    const sent = await mockPost(page, '**/api/safeguarding/reconfirm', { json: { ...SUCCESS, changeDeclared: true } });
    await page.goto('/safeguarding/reconfirm');
    await page.getByRole('radio', { name: /Something has changed/ }).check();
    const note = page.getByRole('note').filter({ hasText: 'Contact the safeguarding lead directly and immediately.' });
    await expect(note).toBeVisible();
    await expect(note.getByRole('link', { name: '+44 7459 839595' })).toBeVisible();
    await expect(note.getByRole('link', { name: 'info@learnthrivetuition.co.uk' })).toBeVisible();
    await expect(note).toContainText('It will be marked as a declared change.');
    await fill(page, { change: 'changed' });
    await humanCheckDone(page);
    await send(page).click();
    const panel = page.getByRole('status').filter({ hasText: 'Your reconfirmation has been recorded.' });
    await expect(panel).toContainText('You told us that something has changed.');
    await expect(panel.getByRole('link', { name: '+44 7883 745337' })).toBeVisible();
    expect(JSON.parse(sent.body).change).toBe('changed');
  });

  test('nothing is sent while anything is wrong; the summary takes focus and names every problem', async ({ page }) => {
    const sent = await mockPost(page, '**/api/safeguarding/reconfirm', { json: SUCCESS });
    await page.goto('/safeguarding/reconfirm');
    await send(page).click();
    const summary = page.getByRole('alert').filter({ hasText: 'things to check' });
    await expect(summary).toBeFocused();
    for (const message of ['Enter your full name.', 'Enter your email address.', 'Choose one of the two options.', 'Read and tick every part of the agreement.', 'Type your full name to confirm that you agree.']) {
      await expect(summary).toContainText(message);
    }
    expect(sent.calls).toBe(0);
    await summary.getByRole('link', { name: 'Enter your full name.' }).click();
    await expect(page.getByLabel('Full name', { exact: true })).toBeFocused();
  });

  test('the typed name must match the full name given', async ({ page }) => {
    await page.goto('/safeguarding/reconfirm');
    await page.getByLabel('Full name', { exact: true }).fill('Jane Smith');
    await page.getByLabel('Type your full name to confirm').fill('Jane');
    await send(page).click();
    await expect(page.locator('#field-typedName-error')).toContainText('exactly as you gave it above');
    await page.getByLabel('Type your full name to confirm').fill(' JANE   smith ');
    await expect(page.locator('#field-typedName-error')).toHaveCount(0);
  });

  test('a server refusal is shown with the direct way to reach the safeguarding lead, and the answers are kept', async ({ page }) => {
    await mockPost(page, '**/api/safeguarding/reconfirm', { status: 503, json: { code: 'closed', error: 'Online reconfirmation is not open yet. Please contact the safeguarding lead directly: info@learnthrivetuition.co.uk.' } });
    await page.goto('/safeguarding/reconfirm');
    await fill(page);
    await humanCheckDone(page);
    await send(page).click();
    const panel = page.getByRole('alert').filter({ hasText: 'There was a problem.' });
    await expect(panel).toBeFocused();
    await expect(panel).toContainText('Online reconfirmation is not open yet.');
    await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Jane Smith');
  });

  test('warns before leaving with unsent work, and not before', async ({ page }) => {
    await page.goto('/safeguarding/reconfirm');
    const warns = () => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
    expect(await warns()).toBe(false);
    await page.getByLabel('Full name', { exact: true }).fill('Jane');
    expect(await warns()).toBe(true);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`is axe-clean, with its errors showing (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
      await page.goto('/safeguarding/reconfirm');
      await send(page).click();
      await expect(page.getByRole('alert').filter({ hasText: 'things to check' })).toBeVisible();
      await expectNoAxeViolations(page, `/safeguarding/reconfirm (${scheme})`);
    });
  }

  test('has no horizontal overflow at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/safeguarding/reconfirm');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
