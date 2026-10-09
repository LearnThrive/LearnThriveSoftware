import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations, humanCheckDone, mockPost } from './careers-support';

// "Can't see your subject?" on /subjects. POST /api/subject-request is MOCKED in every test: this project has real
// email credentials, so a genuine POST would send a real email. The route itself is covered, with the email call
// replaced, by tests/subjectRequest.test.mjs.

const section = (page: Page) => page.locator('#request-a-subject');
const send = (page: Page) => section(page).getByRole('button', { name: 'Send request' });

test.describe('requesting a subject', () => {
  test('explains the request without promising a subject, a date or a number', async ({ page }) => {
    await page.goto('/subjects');
    const text = (await section(page).innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('You can ask for a subject we do not offer yet.');
    expect(text).toContain('If enough families ask, we may add it');
    expect(text).toContain('we cannot promise that any subject will be added, or when');
    expect(text.replace('we cannot promise that any subject will be added, or when', '')).not.toContain('will be added');
    expect(text).not.toMatch(/\b(\d+|several|many) (families|requests)\b/i);
  });

  test('sits after the subject content and before the closing call to action', async ({ page }) => {
    await page.goto('/subjects');
    const order = await page.evaluate(() => {
      const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top + window.scrollY;
      return { eleven: top('#eleven-plus'), request: top('#request-a-subject'), cta: top('h2:has(+ p)') };
    });
    expect(order.request).toBeGreaterThan(order.eleven);
    const ctaHeading = page.getByRole('heading', { name: 'Found the right fit for your child?' });
    const ctaTop = await ctaHeading.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(order.request).toBeLessThan(ctaTop);
  });

  test('the subject list is the one the owners asked for, ending in Other', async ({ page }) => {
    await page.goto('/subjects');
    const options = await section(page).getByLabel('Subject you would like').locator('option').allTextContents();
    expect(options).toEqual(['Choose a subject', 'Computer Science', 'Biology', 'Chemistry', 'Physics', 'History', 'Geography', 'French', 'Spanish', 'Business Studies', 'Economics', 'Psychology', 'Music', 'Other']);
  });

  test('"Other" reveals a text box directly below, announces it, and takes focus nowhere', async ({ page }) => {
    await page.goto('/subjects');
    const subject = section(page).getByLabel('Subject you would like');
    await expect(section(page).getByLabel('Which subject?')).toHaveCount(0);
    await subject.focus();
    await subject.selectOption('Other');
    const other = section(page).getByLabel('Which subject?');
    await expect(other).toBeVisible();
    await expect(subject).toBeFocused(); // focus does not jump
    await expect(section(page).getByText('A text box has appeared below: which subject?')).toBeAttached();
    // It is the next field after the subject list, in reading order and in the tab order.
    const nextAfterSubject = await subject.evaluate((el) => {
      const fields = [...(el.closest('form') as HTMLFormElement).querySelectorAll<HTMLElement>('input:not([tabindex="-1"]), select, textarea')];
      const at = fields.indexOf(el as HTMLElement);
      return fields.slice(at + 1, at + 3).map((field) => field.id);
    });
    expect(nextAfterSubject).toContain('field-other');
    await expect(other).toHaveAttribute('maxlength', '60');
  });

  test('choosing a listed subject again removes the box and its value is not sent', async ({ page }) => {
    const sent = await mockPost(page, '**/api/subject-request', { json: { success: true } });
    await page.goto('/subjects');
    const form = section(page);
    await form.getByLabel('Subject you would like').selectOption('Other');
    await form.getByLabel('Which subject?').fill('Latin');
    await form.getByLabel('Subject you would like').selectOption('History');
    await expect(form.getByLabel('Which subject?')).toHaveCount(0);
    await form.getByLabel('Level').selectOption('Year 9');
    await form.getByRole('radio', { name: 'A parent or guardian' }).check();
    await humanCheckDone(page);
    await send(page).click();
    await expect(form.getByText('Thank you. Your request has been sent.')).toBeVisible();
    const body = JSON.parse(sent.body);
    expect(body).toMatchObject({ subject: 'History', other: '', level: 'Year 9', askedBy: 'parent', notify: false });
  });

  test('a typed subject is required and limited, and a request can be completed with the keyboard alone', async ({ page }) => {
    const sent = await mockPost(page, '**/api/subject-request', { json: { success: true } });
    await page.goto('/subjects');
    const form = section(page);
    const subject = form.getByLabel('Subject you would like');
    await subject.focus();
    await page.keyboard.type('Other');
    await expect(subject).toHaveValue('Other');
    await form.getByLabel('Level').focus();
    await page.keyboard.type('Year 10');
    await form.getByRole('radio', { name: 'A student' }).focus();
    await page.keyboard.press('Space');
    await humanCheckDone(page);
    await send(page).focus();
    await page.keyboard.press('Enter');
    await expect(form.getByRole('alert').filter({ hasText: 'thing' })).toBeFocused();
    await expect(form.getByRole('alert')).toContainText('Type the subject you would like (at least 2 characters).');
    await form.getByRole('link', { name: /Type the subject you would like/ }).click();
    const other = form.getByLabel('Which subject?');
    await expect(other).toBeFocused();
    await page.keyboard.type('Ancient Greek');
    await send(page).focus();
    await page.keyboard.press('Enter');
    await expect(form.getByText('Thank you. Your request has been sent.')).toBeVisible();
    expect(JSON.parse(sent.body)).toMatchObject({ subject: 'Other', other: 'Ancient Greek', level: 'Year 10', askedBy: 'student' });
  });

  test('the email box is used only if the separate, unticked box is ticked', async ({ page }) => {
    const sent = await mockPost(page, '**/api/subject-request', { json: { success: true } });
    await page.goto('/subjects');
    const form = section(page);
    const notify = form.getByRole('checkbox', { name: 'Email me if this subject becomes available.' });
    await expect(notify).not.toBeChecked();
    await form.getByLabel('Subject you would like').selectOption('Computer Science');
    await form.getByLabel('Level').selectOption('Year 9');
    await form.getByRole('radio', { name: 'A parent or guardian' }).check();
    await notify.check();
    await send(page).click();
    await expect(form.locator('#field-email-error')).toContainText('Enter your email address, or untick the box.');
    await form.getByLabel('Email address').fill('family@example.com');
    await humanCheckDone(page);
    await send(page).click();
    await expect(form.getByText('Thank you. Your request has been sent.')).toBeVisible();
    await expect(form.getByText('we will email you only if this subject becomes available')).toBeVisible();
    expect(JSON.parse(sent.body)).toMatchObject({ subject: 'Computer Science', email: 'family@example.com', notify: true });
  });

  test('the note is optional and limited to 500 characters, and there is no field for a child’s name', async ({ page }) => {
    await page.goto('/subjects');
    const form = section(page);
    await expect(form.getByLabel(/Anything else you would like us to know/)).toHaveAttribute('maxlength', '500');
    await expect(form.getByText('Please do not include a child’s name or any other personal details.')).toBeVisible();
    await expect(form.getByLabel(/child.s name/i)).toHaveCount(0);
  });

  test('an unavailable or rate-limited answer is shown plainly, and the answers are kept', async ({ page }) => {
    await mockPost(page, '**/api/subject-request', { status: 503, json: { code: 'unavailable', error: 'Subject requests are not being accepted right now. Please email info@learnthrivetuition.co.uk instead.' } });
    await page.goto('/subjects');
    const form = section(page);
    await form.getByLabel('Subject you would like').selectOption('Music');
    await form.getByLabel('Level').selectOption('Year 6');
    await form.getByRole('radio', { name: 'A parent or guardian' }).check();
    await humanCheckDone(page);
    await send(page).click();
    const panel = form.getByRole('alert').filter({ hasText: 'There was a problem.' });
    await expect(panel).toBeFocused();
    await expect(panel).toContainText('Subject requests are not being accepted right now.');
    await expect(form.getByLabel('Subject you would like')).toHaveValue('Music');
  });

  test('with JavaScript off, offers an email link', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/subjects');
    await expect(page.locator('#request-a-subject noscript strong, #request-a-subject noscript p')).toContainText(['The request form needs JavaScript.']);
    await expect(page.locator('#request-a-subject noscript a')).toHaveAttribute('href', /^mailto:info@learnthrivetuition\.co\.uk\?subject=/);
    await context.close();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`the subjects page is axe-clean with the request form open and its errors showing (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
      await page.goto('/subjects');
      const form = section(page);
      await form.getByLabel('Subject you would like').selectOption('Other');
      await send(page).click();
      await expect(form.getByRole('alert').filter({ hasText: 'things to check' })).toBeVisible();
      await expectNoAxeViolations(page, `/subjects with the request form (${scheme})`);
    });
  }

  test('no horizontal overflow at 360px with the "Other" box open', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/subjects');
    await section(page).getByLabel('Subject you would like').selectOption('Other');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
