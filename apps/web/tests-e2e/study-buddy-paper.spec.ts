import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hydrated } from './careers-support';
import { address, confirm, distinctVisitor, expectAxeClean, signUp } from './account-support';

// The Paper Tutor in a browser, with the MOCK provider: its solver always answers "6", so on the two-question worksheet the real
// checker passes question 1 (2x + 7 = 19) and fails question 2 (expand 3(x + 4)). Covers the offer, the checklist and mode choice,
// progress, the honest statuses, the download, the preview, the summary in the chat, and that another family cannot fetch the file.

distinctVisitor();

const WORKSHEET = readFileSync(join(__dirname, '..', 'tests', 'fixtures', 'documents', 'text-native.pdf'));

async function enrolledAndOpen(page: Page) {
  const email = address();
  await signUp(page, email);
  await confirm(page, email);
  expect((await page.request.post('/api/dev/library-seed', { data: { action: 'enrol', email } })).ok()).toBe(true);
  await page.goto('/library/ai');
  await expect(page.getByRole('heading', { level: 1, name: 'LearnThrive AI' })).toBeVisible();
  await hydrated(page);
}

test('a worksheet is solved: questions to choose, progress, honest statuses, a download, a preview and a summary in the chat', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await enrolledAndOpen(page);
  await page.getByRole('checkbox', { name: /18 or over/ }).check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /add file|file/i }).first().click();
  await (await chooser).setFiles({ name: 'worksheet.pdf', mimeType: 'application/pdf', buffer: WORKSHEET });

  await page.getByRole('button', { name: 'Solve this paper' }).click();
  const panel = page.getByRole('region', { name: 'Solve this paper' });
  await expect(panel.getByRole('group', { name: /Questions found \(2\)/ })).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole('checkbox', { name: /Q1 .*Solve 2x \+ 7 = 19/ })).toBeChecked();
  await expect(panel.getByRole('radio', { name: /Answers and working/ })).toBeChecked();
  await expectAxeClean(page, 'Paper Tutor: choosing questions');

  await panel.getByRole('button', { name: 'Solve all questions' }).click();
  await expect(panel.getByRole('link', { name: 'Download the worked paper' })).toBeVisible({ timeout: 45_000 });
  const progress = panel.getByRole('list', { name: 'Progress' });
  await expect(progress.getByRole('listitem').nth(0)).toContainText('Checked by calculation');
  await expect(progress.getByRole('listitem').nth(1)).toContainText('Not confidently solved');

  // The summary is posted into the chat, labelled as AI-generated.
  const summary = page.locator('article[aria-label="LearnThrive AI"]').last();
  await expect(summary).toContainText('AI-generated');
  await expect(summary).toContainText('Question 1');

  // The download is the family's own PDF, sent only to them.
  const href = (await panel.getByRole('link', { name: 'Download the worked paper' }).getAttribute('href'))!;
  const pdf = await page.request.get(href);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect(pdf.headers()['content-disposition']).toContain('attachment');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  await panel.getByRole('button', { name: 'Preview' }).click();
  const picture = panel.getByRole('img', { name: /Page 1 of the worked paper/ });
  await expect(picture).toBeVisible();
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(300);
  await panel.getByRole('button', { name: 'Next page' }).click();
  await expect(panel.getByText(/Page 2 of \d+ \(worked solutions\)/)).toBeVisible();
  await expectAxeClean(page, 'Paper Tutor: finished');

  // Another family, signed in, gets nothing.
  const other = await browser.newContext({ baseURL: 'http://localhost:3101' });
  const stranger = await other.newPage();
  await enrolledAndOpen(stranger);
  expect((await stranger.request.get(href)).status()).toBe(404);
  await other.close();
});

test('a completed paper is checked: estimated marks only, what cannot be confirmed is left for checking, and each question opens', async ({ page }) => {
  test.setTimeout(90_000);
  await enrolledAndOpen(page);
  await page.getByRole('checkbox', { name: /18 or over/ }).check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /add file|file/i }).first().click();
  await (await chooser).setFiles({ name: 'my-paper.pdf', mimeType: 'application/pdf', buffer: WORKSHEET });

  await page.getByRole('button', { name: 'Check my completed paper' }).click();
  const panel = page.getByRole('region', { name: 'Check my completed paper' });
  await expect(panel.getByRole('group', { name: /Questions found \(2\)/ })).toBeVisible({ timeout: 20_000 });
  // Marking has no "how to write the answers" choice, and says up front that marks are estimates.
  await expect(panel.getByRole('radio')).toHaveCount(0);
  await expect(panel).toContainText("AI's estimates, never official marks");
  await expectAxeClean(page, 'Paper Tutor: choosing questions to check');

  await panel.getByRole('button', { name: 'Check all questions' }).click();
  await expect(panel.getByRole('link', { name: 'Download the checked paper' })).toBeVisible({ timeout: 45_000 });
  // The mock reads "6" for both answers: right for 2x + 7 = 19; the expansion has no confirmed answer, so it is not called wrong.
  const progress = panel.getByRole('list', { name: 'Progress' });
  await expect(progress.getByRole('listitem').nth(0)).toContainText('Correct');
  await expect(progress.getByRole('listitem').nth(1)).toContainText('Needs checking');

  const questions = panel.getByLabel('Questions');
  await questions.getByText('Q2').click();
  await expect(questions).toContainText('have not marked it');
  // Nothing is shown as zero that was not assessed; a worksheet that prints no marks has feedback, not an invented total.
  await expect(questions).toContainText('Needs a person to look');
  await questions.getByText('Q1').click();
  await expect(questions).toContainText('the paper prints no marks for this question');
  // A wrong reading can be corrected: the question is checked again and the change is kept.
  await questions.getByRole('button', { name: 'Correct how I read this' }).first().click();
  await questions.getByLabel('Your final answer').fill('5');
  await questions.getByLabel(/Your working/).fill('2x = 12\nx = 5');
  await questions.getByRole('button', { name: 'Save and check again' }).click();
  await expect(questions.getByText('Not right').first()).toBeVisible({ timeout: 30_000 });
  await expect(questions).toContainText('You corrected how I read this');
  const summary = page.locator('article[aria-label="LearnThrive AI"]').last();
  await expect(summary).toContainText('not official marks');

  const href = (await panel.getByRole('link', { name: 'Download the checked paper' }).getAttribute('href'))!;
  const pdf = await page.request.get(href);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await panel.getByRole('button', { name: 'Preview' }).click();
  await panel.getByRole('button', { name: 'Next page' }).click();
  await expect(panel.getByText(/Page 2 of \d+ \(feedback\)/)).toBeVisible();
  await expectAxeClean(page, 'Paper Tutor: checked');
});

test('the Paper Tutor routes refuse a signed-out visitor and nonsense input', async ({ page, request }) => {
  expect((await request.post('/api/assistant/papers', { data: { fileId: 'x', sessionId: 'y' }, headers: { Origin: 'http://localhost:3101' } })).status()).toBe(401);
  expect((await request.get('/api/assistant/files/00000000-0000-4000-8000-000000000000')).status()).toBe(401);
  await enrolledAndOpen(page);
  const bad = await page.request.post('/api/assistant/papers', { data: { fileId: 'not-a-uuid', sessionId: 'nope' }, headers: { Origin: 'http://localhost:3101' } });
  expect(bad.status()).toBe(400);
  const missing = await page.request.post('/api/assistant/papers', { data: { fileId: '00000000-0000-4000-8000-000000000000', sessionId: '00000000-0000-4000-8000-000000000001' }, headers: { Origin: 'http://localhost:3101' } });
  expect(missing.status()).toBe(404);
  expect((await page.request.get('/api/assistant/papers/00000000-0000-4000-8000-000000000000')).status()).toBe(404);
});
