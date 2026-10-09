import { test, expect, type Locator, type Page } from '@playwright/test';
import { agreement, chooseByKeyboard, expectNoAxeViolations, humanCheckDone, hydrated, JPEG, mockPost, noisePng, PDF } from './careers-support';

// The one-page application (/careers/apply). The dev server opens it for testing while the safeguarding
// agreement is still a draft (playwright.config.ts). EVERY test here mocks POST /api/careers/apply: this project
// has real email credentials, so a genuine POST would send a real email. What the route does with a request
// is covered, with the email call replaced, by tests/careersApply.test.mjs.

/** A start date a month ahead, so the test stays valid whenever it runs (the form allows today to two years). */
const inThirtyDays = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

const SUCCESS = { success: true, reference: 'LT-APP-20261009-K7QX2M', role: 'Maths Tutor' };
const submit = (page: Page) => page.getByRole('button', { name: 'Send my application' });
const group = (page: Page, name: string | RegExp) => page.getByRole('group', { name });

/** How a value gets into a control: the mouse-and-keyboard way (fill, check) or the keyboard alone. */
function driver(page: Page, keyboard: boolean) {
  return {
    async type(target: Locator, text: string) {
      if (!keyboard) return target.fill(text);
      await target.focus();
      await page.keyboard.type(text);
    },
    async tick(target: Locator) {
      if (!keyboard) return target.check();
      await target.focus();
      await page.keyboard.press('Space');
      await expect(target).toBeChecked();
    },
    async choose(label: string | RegExp, option: string) {
      if (!keyboard) return page.getByLabel(label).selectOption({ label: option });
      return chooseByKeyboard(page, label, option);
    },
    async date(target: Locator, iso: string) {
      // The order of a date input's day, month and year follows the machine's own locale (day first in the UK,
      // month first in the US), which a test cannot read back, so the value is set directly. The control is the
      // browser's own and is operable from the keyboard by default; the test checks it is reachable and labelled.
      await target.focus();
      await target.fill(iso);
      await expect(target).toHaveValue(iso);
    },
  };
}

/** Fills every section with valid answers, without sending. */
async function fillApplication(page: Page, { keyboard = false, files = true } = {}) {
  const d = driver(page, keyboard);
  // 1. About you
  await d.type(page.getByLabel('First name'), 'Jane');
  await d.type(page.getByLabel('Last name'), 'Smith');
  await d.type(page.getByLabel('Email address', { exact: true }), 'jane@example.com');
  await d.type(page.getByLabel('Phone number'), '07700 900123');
  await d.type(page.getByLabel('Town or city'), 'Leeds');
  await d.tick(page.getByRole('checkbox', { name: /I confirm that I am 18 or over/ }));
  // 2. The role
  await d.choose('Role you are applying for', 'Maths Tutor');
  await d.tick(group(page, 'Subjects you could teach').getByLabel('Maths'));
  await d.tick(group(page, 'Year groups you could teach').getByLabel('Year 7'));
  await d.tick(group(page, 'Year groups you could teach').getByLabel('Year 8'));
  // 3. Experience, qualifications and results
  await d.choose('Highest relevant qualification', 'Undergraduate degree (completed)');
  await d.type(page.getByLabel('Subject of that qualification'), 'Mathematics');
  await d.type(page.getByLabel('GCSE results'), 'Maths 9, English 8, Physics 8');
  await d.choose('Tutoring or teaching experience', '1 to 2 years');
  await d.choose('Experience teaching online', 'Some');
  await d.choose('Experience supporting learners with additional needs', 'Some');
  // 4. Availability and set-up
  await d.tick(group(page, 'When you could teach').getByLabel('Weekday evenings'));
  await d.choose('Hours a week you could teach', '4 to 6 hours');
  await d.date(page.getByLabel('Earliest date you could start'), inThirtyDays());
  await d.tick(page.getByRole('checkbox', { name: /I can teach from a quiet, private space/ }));
  await d.tick(group(page, /Are you legally able to work in the UK/).getByRole('radio', { name: 'Yes', exact: true }));
  // 5. Your application
  if (files) await page.locator('#field-cv').setInputFiles({ name: 'Jane CV.pdf', mimeType: 'application/pdf', buffer: PDF });
  await d.type(page.getByLabel('Why do you want to tutor with LearnThrive?'), 'I enjoy explaining things clearly, and I have helped younger family members with their maths for years.');
  // 7. The safeguarding agreement
  for (const part of agreement.parts) await d.tick(page.getByRole('checkbox', { name: new RegExp(`Part ${part.id}: `) }));
  for (const [index, question] of agreement.understanding.entries()) {
    const correct = question.options.find((option) => option.id === question.correctOptionId)!;
    await d.tick(group(page, new RegExp(`^${index + 1}\\. `)).getByRole('radio', { name: correct.text, exact: true }));
  }
  await d.type(page.getByLabel('Type your full name to agree'), 'Jane Smith');
  // 8. Declarations
  await d.tick(page.getByRole('checkbox', { name: /The information I have given is accurate/ }));
  await d.tick(page.getByRole('checkbox', { name: /I agree to an Enhanced DBS check/ }));
  await d.tick(page.getByRole('checkbox', { name: /I understand that tutors are self-employed/ }));
  await d.tick(page.getByRole('checkbox', { name: /I have read the applicant privacy notice/ }));
}

test.describe('opening the application', () => {
  test('preselects the role from the link, and ignores a role that is not open', async ({ page }) => {
    await page.goto('/careers/apply?role=english-tutor');
    await expect(page.getByLabel('Role you are applying for')).toHaveValue('english-tutor');
    await page.goto('/careers/apply?role=astronaut');
    await expect(page.getByLabel('Role you are applying for')).toHaveValue('');
    await page.goto('/careers/apply?role=register-interest');
    await expect(page.getByLabel('Role you are applying for')).toHaveValue('register-interest');
  });

  test('is one page in eight numbered sections, with a section list that jumps to each', async ({ page }) => {
    await page.goto('/careers/apply');
    const nav = page.getByRole('navigation', { name: 'Application sections' });
    await expect(nav.getByRole('link')).toHaveCount(8);
    await expect(page.getByRole('form', { name: 'Tutor application' }).getByRole('heading', { level: 2 })).toHaveCount(8);
    for (let n = 1; n <= 8; n += 1) await expect(page.locator(`#section-${n}-heading`)).toContainText('');
    await expect(page.getByText('Section 1 of 8')).toBeVisible();
    await nav.getByRole('link', { name: /Section 7: Safeguarding agreement/ }).click();
    await expect(page).toHaveURL(/#section-7$/);
    // Focus lands on the section, so a keyboard or screen-reader visitor starts reading it.
    await expect(page.locator('#section-7')).toBeFocused();
    // Optional and to-do are said in words, not by colour alone.
    await expect(nav.getByRole('link', { name: /Section 6/ })).toContainText('Optional');
    await expect(nav.getByRole('link', { name: /Section 1: About you/ })).toContainText('To do');
  });

  test('is not indexed and not in the sitemap, and has an email way to apply', async ({ page, request }) => {
    await page.goto('/careers/apply');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('link', { name: 'info@learnthrivetuition.co.uk' }).last()).toBeVisible();
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('/careers</loc>');
    expect(sitemap).toContain('/careers/maths-tutor</loc>');
    expect(sitemap).not.toContain('/careers/apply');
    expect(sitemap).not.toContain('/safeguarding/reconfirm');
  });

  test('with JavaScript off, says the form needs it and offers email', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/careers/apply');
    // (Playwright's text engine skips <noscript>, so look inside it directly.)
    await expect(page.locator('noscript strong')).toContainText('The online application needs JavaScript.');
    await expect(page.locator('noscript a')).toHaveAttribute('href', /^mailto:info@learnthrivetuition\.co\.uk\?subject=/);
    await context.close();
  });
});

test.describe('completing and sending it', () => {
  test('a complete application is sent as one multipart request, and the success panel takes focus', async ({ page }) => {
    const sent = await mockPost(page, '**/api/careers/apply', { json: SUCCESS });
    await page.goto('/careers/apply?role=maths-tutor');
    await fillApplication(page);
    await humanCheckDone(page);
    await submit(page).click();

    const panel = page.getByRole('status').filter({ hasText: 'Your application has been sent.' });
    await expect(panel).toBeVisible();
    await expect(panel).toBeFocused();
    await expect(panel).toContainText('LT-APP-20261009-K7QX2M');
    await expect(panel).toContainText('We will reply within 5 working days.');
    await expect(panel).toContainText(`version ${agreement.version} of the safeguarding agreement`);

    expect(sent.calls).toBe(1);
    expect(sent.contentType).toMatch(/^multipart\/form-data; boundary=/);
    for (const expected of ['name="payload"', '"firstName":"Jane"', '"role":"maths-tutor"', '"typedName":"Jane Smith"', '"agreedParts":["A","B","C","D","E","F","G"]', '"kind":"pow"', '"solution":"', 'name="cv"; filename="Jane CV.pdf"', '"documentTypes":[]']) {
      expect(sent.body, expected).toContain(expected);
    }
    expect(sent.body).not.toContain('name="coverLetterFile"');
  });

  test('can be completed with the keyboard alone, every clause group, the questions and the typed name included', async ({ page }) => {
    const sent = await mockPost(page, '**/api/careers/apply', { json: SUCCESS });
    await page.goto('/careers/apply');
    // The first things a keyboard visitor meets are real controls, reachable in order.
    await page.getByRole('navigation', { name: 'Application sections' }).getByRole('link').first().focus();
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('Tab');
    await expect(page.getByLabel('First name')).toBeFocused();

    await fillApplication(page, { keyboard: true });
    await humanCheckDone(page);
    await submit(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Your application has been sent.' })).toBeFocused();
    expect(sent.calls).toBe(1);
  });

  test('a cover letter can be pasted, a file added, and the optional box to be kept for future roles is sent only if ticked', async ({ page }) => {
    const sent = await mockPost(page, '**/api/careers/apply', { json: SUCCESS });
    await page.goto('/careers/apply?role=maths-tutor');
    await fillApplication(page);
    await page.getByLabel('Or paste your cover letter here').fill('Dear LearnThrive, I would like to teach Maths.');
    await page.locator('#field-coverLetterFile').setInputFiles({ name: 'letter.pdf', mimeType: 'application/pdf', buffer: PDF });
    const talent = page.getByRole('checkbox', { name: /keep my application in mind for future roles/ });
    await expect(talent).not.toBeChecked();
    await talent.check();
    await humanCheckDone(page);
    await submit(page).click();
    await expect(page.getByText('Your application has been sent.')).toBeVisible();
    expect(sent.body).toContain('"talentPool":true');
    expect(sent.body).toContain('"coverLetterText":"Dear LearnThrive, I would like to teach Maths."');
    expect(sent.body).toContain('name="coverLetterFile"; filename="letter.pdf"');
  });

  test('nothing is sent while anything is wrong: the error summary takes focus, lists every problem and links to the fields', async ({ page }) => {
    const sent = await mockPost(page, '**/api/careers/apply', { json: SUCCESS });
    await page.goto('/careers/apply');
    await submit(page).click();

    const summary = page.getByRole('alert').filter({ hasText: 'things to check' });
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('Your application has not been sent yet.');
    for (const message of ['Enter your first name.', 'Enter your email address.', 'Choose the role you are applying for.', 'Attach your CV.', 'Read and tick every part of the agreement.', 'Type your full name to confirm that you agree.', 'Answer all six questions correctly to continue.', 'Tick the box to confirm you have read the applicant privacy notice.']) {
      await expect(summary).toContainText(message);
    }
    expect(sent.calls).toBe(0);

    // Each is linked to its field, and the link moves focus there.
    await summary.getByRole('link', { name: 'Enter your first name.' }).click();
    await expect(page.getByLabel('First name')).toBeFocused();
    await expect(page.getByLabel('First name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#field-firstName-error')).toHaveText('Enter your first name.');

    // The section list now says which sections need attention.
    const nav = page.getByRole('navigation', { name: 'Application sections' });
    await expect(nav.getByRole('link', { name: /Section 1: About you/ })).toContainText('Needs attention');
    await expect(nav.getByRole('link', { name: /Section 6/ })).toContainText('Optional');

    // An error clears as soon as it is fixed.
    await page.getByLabel('First name').fill('Jane');
    await expect(page.locator('#field-firstName-error')).toHaveCount(0);
  });

  test('the section list shows a section as complete once it is', async ({ page }) => {
    await page.goto('/careers/apply');
    const first = page.getByRole('navigation', { name: 'Application sections' }).getByRole('link', { name: /Section 1: About you/ });
    await expect(first).toContainText('To do');
    await page.getByLabel('First name').fill('Jane');
    await page.getByLabel('Last name').fill('Smith');
    await page.getByLabel('Email address', { exact: true }).fill('jane@example.com');
    await page.getByLabel('Phone number').fill('07700 900123');
    await page.getByLabel('Town or city').fill('Leeds');
    await page.getByRole('checkbox', { name: /I confirm that I am 18 or over/ }).check();
    await expect(first).toContainText('Complete');
  });

  test('"No" to the right to work is stopped with an explanation; "Not sure" can continue', async ({ page }) => {
    await page.goto('/careers/apply');
    await group(page, /Are you legally able to work in the UK/).getByRole('radio', { name: 'No', exact: true }).check();
    await submit(page).click();
    await expect(page.locator('#field-rightToWork-error')).toContainText('You need the right to work in the UK');
    await group(page, /Are you legally able to work in the UK/).getByRole('radio', { name: 'Not sure', exact: true }).check();
    await expect(page.locator('#field-rightToWork-error')).toHaveCount(0);
  });

  test('the results rule: at least one of the four boxes, with the reason given', async ({ page }) => {
    await page.goto('/careers/apply');
    await submit(page).click();
    await expect(page.locator('#field-results-error')).toContainText('We look at results at every level together.');
    await page.getByLabel('A Level results').fill('Maths A*');
    await expect(page.locator('#field-results-error')).toHaveCount(0);
  });

  test('the date cannot be in the past, and the minimum is today', async ({ page }) => {
    await page.goto('/careers/apply');
    await hydrated(page);
    const date = page.getByLabel('Earliest date you could start');
    await expect(date).toHaveAttribute('min', /^\d{4}-\d{2}-\d{2}$/);
    await date.fill('2020-01-01');
    await submit(page).click();
    await expect(page.locator('#field-startDate-error')).toContainText('today or later');
  });
});

test.describe('the files', () => {
  test('a CV is checked for type and size at once, can be removed and replaced', async ({ page }) => {
    await page.goto('/careers/apply');
    const cv = page.locator('#field-cv');
    await cv.setInputFiles({ name: 'cv.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
    await expect(page.locator('#field-cv-error')).toContainText('This type of file is not accepted.');
    await cv.setInputFiles({ name: 'cv.doc', mimeType: 'application/msword', buffer: Buffer.from('old word') });
    await expect(page.locator('#field-cv-error')).toContainText('Save as PDF');
    await cv.setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([PDF, Buffer.alloc(3 * 1024 * 1024)]) });
    await expect(page.locator('#field-cv-error')).toContainText('over the 3 MB limit');
    await cv.setInputFiles({ name: 'Jane CV.pdf', mimeType: 'application/pdf', buffer: PDF });
    await expect(page.locator('#field-cv-error')).toHaveCount(0);
    await expect(page.getByText('Jane CV.pdf', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Remove Your CV/ }).click();
    await expect(page.getByText('Jane CV.pdf', { exact: true })).toHaveCount(0);
    await expect(cv).toBeFocused();
  });

  test('each supporting document needs a type; up to five; the running total is shown against the limit', async ({ page }) => {
    await page.goto('/careers/apply');
    const input = page.locator('#field-supporting');
    await input.setInputFiles({ name: 'degree.pdf', mimeType: 'application/pdf', buffer: PDF });
    const rows = page.getByRole('list', { name: 'Supporting documents added' }).getByRole('listitem');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('degree.pdf');
    await expect(page.getByText(/Files chosen: .* of 12 MB/)).toBeVisible();

    await submit(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'things to check' })).toContainText('degree.pdf: Choose what type of document this is.');
    await rows.first().getByLabel(/Type of document/).selectOption('qualification');
    await expect(page.locator('[id^="field-docType-"][id$="-error"]')).toHaveCount(0);

    for (const name of ['b.pdf', 'c.pdf', 'd.pdf', 'e.pdf']) await input.setInputFiles({ name, mimeType: 'application/pdf', buffer: PDF });
    await expect(rows).toHaveCount(5);
    await expect(page.getByText('You have added the most you can: 5 documents.')).toBeVisible();
    await expect(page.locator('#field-supporting')).toHaveCount(0);
    await rows.nth(4).getByRole('button', { name: /^Remove e\.pdf/ }).click();
    await expect(rows).toHaveCount(4);
    await expect(page.locator('#field-supporting')).toBeVisible();
  });

  test('a total over the whole-application limit is refused with the figures', async ({ page }) => {
    await page.goto('/careers/apply');
    const big = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.concat([PDF, Buffer.alloc(3 * 1024 * 1024 - PDF.length)]) });
    await page.locator('#field-cv').setInputFiles(big('cv.pdf'));
    await page.locator('#field-coverLetterFile').setInputFiles(big('letter.pdf'));
    const input = page.locator('#field-supporting');
    await input.setInputFiles(big('a.pdf'));
    await input.setInputFiles(big('b.pdf'));
    await input.setInputFiles({ name: 'c.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([JPEG, Buffer.alloc(400 * 1024)]) });
    await expect(page.locator('#field-files-total')).toContainText('(too much)');
    await expect(page.locator('#field-files-error')).toContainText('over the 12 MB limit');
  });

  test('a large photo is shrunk in the browser to a JPEG that fits, and no larger file is ever sent', async ({ page }) => {
    const sent = await mockPost(page, '**/api/careers/apply', { json: SUCCESS });
    await page.goto('/careers/apply?role=maths-tutor');
    const png = noisePng(1100, 1000);
    expect(png.length).toBeGreaterThan(3 * 1024 * 1024);
    await page.locator('#field-supporting').setInputFiles({ name: 'degree scan.png', mimeType: 'image/png', buffer: png });
    const row = page.getByRole('list', { name: 'Supporting documents added' }).getByRole('listitem').first();
    await expect(row).toContainText('degree scan.jpg');
    await expect(row.locator('xpath=.//*[contains(text(), "MB") or contains(text(), "KB")]').first()).toBeVisible();
    await row.getByLabel(/Type of document/).selectOption('qualification');
    await expect(page.locator('[id^="field-docType-"][id$="-error"]')).toHaveCount(0);
    await fillApplication(page);
    await humanCheckDone(page);
    await submit(page).click();
    await expect(page.getByText('Your application has been sent.')).toBeVisible();
    expect(sent.body).toContain('name="support-0"; filename="degree scan.jpg"');
    expect(sent.body).toContain('"documentTypes":["qualification"]');
    expect(sent.body.length).toBeLessThan(3 * 1024 * 1024);
  });

  test('the privacy note on the documents step says what identity documents are for, and not to send a DBS certificate', async ({ page }) => {
    await page.goto('/careers/apply');
    const note = page.locator('#section-6');
    await expect(note).toContainText('This is where you can upload your identity and right-to-work documents for now, until we put a separate secure process in place.');
    await expect(note).toContainText('Uploading them now is optional');
    await expect(note).toContainText('Do not upload a DBS certificate.');
    await expect(note).toContainText('12 months after');
  });
});

test.describe('the safeguarding agreement section', () => {
  test('shows every clause on the page with a required tick-box for each part', async ({ page }) => {
    await page.goto('/careers/apply');
    const section = page.locator('#section-7');
    for (const part of agreement.parts) {
      await expect(section.getByRole('heading', { name: new RegExp(`^Part ${part.id}: `) })).toBeVisible();
      await expect(section.getByRole('checkbox', { name: new RegExp(`I have read and agree to every clause in Part ${part.id}: `) })).not.toBeChecked();
    }
    await expect(section).toContainText('I will not teach, or have any contact with, any LearnThrive student until every check is complete.');
    await expect(section.getByRole('link', { name: 'its own page' })).toHaveAttribute('href', '/careers/safeguarding-agreement');
    await expect(section).toContainText(`Agreement version ${agreement.version}`);
  });

  test('the understanding check names the questions to look at again, without giving the answer, and can be retried', async ({ page }) => {
    await page.goto('/careers/apply');
    const section = page.locator('#section-7');
    // Answer every question, getting questions 2 and 5 wrong.
    for (const [index, question] of agreement.understanding.entries()) {
      const wrong = index === 1 || index === 4;
      const option = question.options.find((entry) => (wrong ? entry.id !== question.correctOptionId : entry.id === question.correctOptionId))!;
      await group(page, new RegExp(`^${index + 1}\\. `)).getByRole('radio', { name: option.text, exact: true }).check();
    }
    await section.getByRole('button', { name: 'Check my answers' }).click();
    await expect(section.getByText('2 questions need another look: question 2, question 5.')).toBeVisible();
    await expect(section.getByText('Question 2 needs another look.')).toBeVisible();
    await expect(section.getByText('Question 1 needs another look.')).toHaveCount(0);
    // The feedback never says which option was right.
    await expect(section).not.toContainText('That is correct');
    await expect(section).not.toContainText('The right answer');

    for (const index of [1, 4]) {
      const question = agreement.understanding[index];
      const right = question.options.find((entry) => entry.id === question.correctOptionId)!;
      await group(page, new RegExp(`^${index + 1}\\. `)).getByRole('radio', { name: right.text, exact: true }).check();
    }
    await expect(section.getByText(/need another look/)).toHaveCount(0); // stale feedback is cleared as soon as an answer changes
    await section.getByRole('button', { name: 'Check my answers' }).click();
    await expect(section.getByText('All six answers are right. You can continue.')).toBeVisible();
  });

  test('the typed name must match the first and last name, ignoring case and spacing', async ({ page }) => {
    await page.goto('/careers/apply');
    await page.getByLabel('First name').fill('Jane');
    await page.getByLabel('Last name').fill('Smith');
    await page.getByLabel('Type your full name to agree').fill('Jane');
    await submit(page).click();
    await expect(page.locator('#field-typedName-error')).toContainText('exactly as you gave it in Section 1');
    await page.getByLabel('Type your full name to agree').fill('  jane   SMITH ');
    await expect(page.locator('#field-typedName-error')).toHaveCount(0);
  });
});

test.describe('when the server says no', () => {
  test('field errors from the server are shown in the summary, and nothing the visitor typed is lost', async ({ page }) => {
    await mockPost(page, '**/api/careers/apply', { status: 422, json: { error: 'Please check your answers and send again.', errors: { email: 'Enter a valid email address.' } } });
    await page.goto('/careers/apply?role=maths-tutor');
    await fillApplication(page);
    await humanCheckDone(page);
    await submit(page).click();
    const summary = page.getByRole('alert').filter({ hasText: 'thing to check' });
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('Enter a valid email address.');
    await expect(page.getByLabel('First name')).toHaveValue('Jane');
    await expect(page.getByLabel('Last name')).toHaveValue('Smith');
  });

  test('a closed, rate-limited or unavailable answer is shown plainly with the email way to apply', async ({ page }) => {
    for (const [status, text] of [[503, 'Online applications are not open yet.'], [429, 'Too many applications from this connection.'], [502, 'Nothing has been sent.'], [413, 'Your application is too large.']] as const) {
      await page.unroute('**/api/careers/apply').catch(() => undefined);
      await mockPost(page, '**/api/careers/apply', { status, json: { error: `${text} Please email info@learnthrivetuition.co.uk.` } });
      await page.goto('/careers/apply?role=maths-tutor');
      await fillApplication(page);
      await humanCheckDone(page);
      await submit(page).click();
      const panel = page.getByRole('alert').filter({ hasText: 'There was a problem.' });
      await expect(panel).toBeVisible();
      await expect(panel).toBeFocused();
      await expect(panel).toContainText(text);
      await expect(panel.getByRole('link', { name: 'info@learnthrivetuition.co.uk' })).toBeVisible();
      await expect(submit(page)).toBeEnabled();
    }
  });

  test('a rejected human check asks for a fresh challenge', async ({ page }) => {
    const challenges: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/careers/challenge')) challenges.push(request.url());
    });
    await mockPost(page, '**/api/careers/apply', { status: 400, json: { code: 'human-check', error: 'We could not confirm that you are a person. Please wait a moment for the check to finish, then send again.' } });
    await page.goto('/careers/apply?role=maths-tutor');
    await fillApplication(page);
    await humanCheckDone(page);
    const before = challenges.length;
    await submit(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'There was a problem.' })).toContainText('We could not confirm that you are a person.');
    await expect.poll(() => challenges.length).toBeGreaterThan(before);
  });

  test('a network failure says nothing was sent and keeps the answers', async ({ page }) => {
    await page.route('**/api/careers/apply', (route) => route.abort('failed'));
    await page.goto('/careers/apply?role=maths-tutor');
    await fillApplication(page);
    await humanCheckDone(page);
    await submit(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'There was a problem.' })).toContainText('Your application has not been sent.');
    await expect(page.getByLabel('First name')).toHaveValue('Jane');
  });
});

test.describe('the human check', () => {
  test('finishes by itself in the background and is announced', async ({ page }) => {
    await page.goto('/careers/apply');
    await expect(page.getByRole('status').filter({ hasText: /Checking that you are a person|Checked: you are a person/ })).toBeVisible();
    await humanCheckDone(page);
  });

  test('in a browser that cannot run the proof, a short sum is asked instead, and answering it works', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, 'Worker', { value: undefined, configurable: true }));
    const sent = await mockPost(page, '**/api/careers/apply', { json: SUCCESS });
    await page.goto('/careers/apply?role=maths-tutor');
    const question = page.getByLabel(/To show you are a person: What is \d+ plus \d+\?/);
    await expect(question).toBeVisible();
    const [, a, b] = /What is (\d+) plus (\d+)\?/.exec((await page.locator('label[for="field-humanAnswer"]').innerText()))!;
    await fillApplication(page);
    await question.fill(String(Number(a) + Number(b)));
    await submit(page).click();
    await expect(page.getByText('Your application has been sent.')).toBeVisible();
    expect(sent.body).toContain('"kind":"text"');
  });

  test('without an answer yet, sending says to wait a moment instead of failing', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, 'Worker', { value: undefined, configurable: true }));
    const sent = await mockPost(page, '**/api/careers/apply', { json: SUCCESS });
    await page.goto('/careers/apply?role=maths-tutor');
    await expect(page.getByLabel(/To show you are a person/)).toBeVisible();
    await fillApplication(page);
    await submit(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'There was a problem.' })).toContainText('has not finished yet');
    expect(sent.calls).toBe(0);
  });
});

test.describe('unsent work', () => {
  test('the browser is asked to warn before leaving once something has been typed, and not before', async ({ page }) => {
    await page.goto('/careers/apply');
    const warns = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    expect(await warns()).toBe(false);
    await page.getByLabel('First name').fill('Jane');
    expect(await warns()).toBe(true);
  });

  test('following a link inside the site asks first, and staying keeps the page', async ({ page }) => {
    await page.goto('/careers/apply');
    await page.getByLabel('First name').fill('Jane');
    const messages: string[] = [];
    page.once('dialog', async (dialog) => {
      messages.push(dialog.message());
      await dialog.dismiss();
    });
    await page.getByRole('link', { name: 'About', exact: true }).first().click();
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toContain('You have not sent your application yet.');
    await expect(page).toHaveURL(/\/careers\/apply$/);
    await expect(page.getByLabel('First name')).toHaveValue('Jane');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('link', { name: 'About', exact: true }).first().click();
    await expect(page).toHaveURL(/\/about$/);
  });

  test('after a successful send nothing is kept: the form is cleared and leaving is not warned about', async ({ page }) => {
    await mockPost(page, '**/api/careers/apply', { json: SUCCESS });
    await page.goto('/careers/apply?role=maths-tutor');
    await fillApplication(page);
    await humanCheckDone(page);
    await submit(page).click();
    await expect(page.getByText('Your application has been sent.')).toBeVisible();
    const warns = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(warns).toBe(false);
    const stored = await page.evaluate(() => ({ cookie: document.cookie, local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
    expect(stored.cookie).toBe('');
    expect(stored.local).toEqual([]);
    expect(stored.session).toEqual([]);
    await page.reload();
    await expect(page.getByLabel('First name')).toHaveValue('');
  });
});

test.describe('layout and accessibility', () => {
  for (const width of [360, 390, 768, 1024, 1440]) {
    test(`no horizontal overflow at ${width}px, with the errors showing`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/careers/apply');
      await submit(page).click();
      await expect(page.getByRole('alert').filter({ hasText: 'things to check' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe-clean with every error showing and a file added (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
      await page.goto('/careers/apply');
      await page.locator('#field-supporting').setInputFiles({ name: 'degree.pdf', mimeType: 'application/pdf', buffer: PDF });
      await page.locator('#field-cv').setInputFiles({ name: 'cv.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
      await submit(page).click();
      await expect(page.getByRole('alert').filter({ hasText: 'things to check' })).toBeVisible();
      await expectNoAxeViolations(page, `/careers/apply with errors (${scheme})`);
    });
  }

  test('every control has an accessible name and the form has a name', async ({ page }) => {
    await page.goto('/careers/apply');
    await expect(page.getByRole('form', { name: 'Tutor application' })).toBeVisible();
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('form input:not([type=hidden]):not([tabindex="-1"]), form select, form textarea')]
        .filter((el) => !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el as HTMLInputElement).labels?.length))
        .map((el) => el.outerHTML.slice(0, 100)),
    );
    expect(unnamed).toEqual([]);
  });

  test('touch targets are at least 44px for buttons, tick-boxes and the file areas', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/careers/apply');
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('form button, form label[class*="option"], form label[class*="declaration"], form [class*="drop"]')]
        .map((el) => ({ el: el.className.toString().slice(0, 40), h: el.getBoundingClientRect().height }))
        .filter((item) => item.h > 0 && item.h < 44),
    );
    expect(small).toEqual([]);
  });
});
