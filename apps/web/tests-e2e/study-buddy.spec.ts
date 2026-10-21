import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hydrated } from './careers-support';
import { address, confirm, distinctVisitor, expectAxeClean, signUp } from './account-support';

// plan19 phase F: Study Buddy in a browser, on the server with the MOCK provider (ASSISTANT_PROVIDER=mock): no model, no network.
// Covers the screen, streaming, Stop, maths, safeguarding and blocked replies, uploads, deleting and exporting chats, and access.

distinctVisitor();

const JPEG = readFileSync(join(__dirname, '..', 'tests', 'fixtures', 'assistant', 'tiny.jpg'));

async function enrolled(page: Page) {
  const email = address();
  await signUp(page, email);
  await confirm(page, email);
  expect((await page.request.post('/api/dev/library-seed', { data: { action: 'enrol', email } })).ok()).toBe(true);
  return email;
}

async function open(page: Page) {
  await page.goto('/library/study-buddy');
  await expect(page.getByRole('heading', { level: 1, name: 'Study Buddy' })).toBeVisible();
  await hydrated(page);
}

async function ask(page: Page, text: string, { first = false } = {}) {
  if (first) await page.getByRole('checkbox', { name: /18 or over/ }).check();
  await page.getByLabel('Your message').fill(text);
  await page.getByRole('button', { name: /send/i }).click();
}

test('closed to an account without Library access, in the page and in the API', async ({ page }) => {
  const email = address();
  await signUp(page, email);
  await confirm(page, email);
  await page.goto('/library/study-buddy');
  await expect(page.getByText('included for enrolled students and Library subscribers')).toBeVisible();
  await expect(page.getByLabel('Your message')).toHaveCount(0);
  const response = await page.request.post('/api/assistant/chat', { data: { text: 'hi', adultAck: true } });
  expect(response.status()).toBe(403);
  expect((await response.json()).code).toBe('no_access');
  expect((await page.request.get('/api/assistant/sessions')).status()).toBe(403);
});

test('signed out, the page sends a visitor to sign in and the API says 401', async ({ page, request }) => {
  await page.goto('/library/study-buddy');
  await expect(page).toHaveURL(/\/account\/sign-in\?next=%2Flibrary%2Fstudy-buddy$/);
  expect((await request.post('/api/assistant/chat', { data: { text: 'hi' } })).status()).toBe(401);
});

test('an enrolled adult asks a question: an adult confirmation first, a streamed answer with maths, and the AI label', async ({ page }) => {
  await enrolled(page);
  await open(page);
  await expect(page.getByText('is an AI, not a tutor or a person')).toBeVisible();
  await expectAxeClean(page, 'study buddy, empty');

  await page.getByLabel('Your message').fill('Factorise x^2 + 3x');
  await page.getByRole('button', { name: /send/i }).click();
  await expect(page.getByText('Please tick the box to confirm you are 18 or over')).toBeVisible();
  await ask(page, 'Factorise x^2 + 3x', { first: true });

  const answer = page.locator('article[aria-label="Study Buddy"]').first();
  await expect(answer).toContainText('Good question');
  await expect(answer.locator('.katex')).toBeVisible();
  await expect(answer.locator('li')).toHaveCount(2);
  await expect(answer.getByText('AI-generated, may be wrong')).toBeVisible();
  await expect(answer.getByRole('button', { name: 'Copy' })).toBeVisible();
  await expect(page.locator('article[aria-label="You"]').first()).toContainText('Factorise x^2 + 3x');
  await expect(page.getByRole('status').filter({ hasText: 'The answer is ready.' })).toHaveCount(1);
  await expect(page.getByRole('list').filter({ has: page.getByRole('button', { name: /Factorise x\^2/ }) })).toBeVisible();
  await expectAxeClean(page, 'study buddy, an answer');

  // A follow-up in the same chat needs no confirmation.
  await ask(page, 'and x^2 - 9?');
  await expect(page.locator('article[aria-label="Study Buddy"]')).toHaveCount(2);

  // Nothing is kept in the browser, and only the session cookies exist.
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect((await page.context().cookies()).map((c) => c.name).sort()).toEqual(['learnthrive_acct', 'learnthrive_acct_r']);
});

test('Stop ends a long answer and keeps what was shown', async ({ page }) => {
  await enrolled(page);
  await open(page);
  await ask(page, '[slow] go on', { first: true });
  const answer = page.locator('article[aria-label="Study Buddy"]').first();
  await expect(answer).toContainText('Step 1 of the long working.');
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  const kept = await answer.innerText();
  expect(kept).toContain('Step 1');
  expect(kept).not.toContain('Step 80');
  await page.reload();
  await page.getByRole('button', { name: /go on/ }).first().click();
  await expect(page.locator('article[aria-label="Study Buddy"]').first()).toContainText('Step 1 of the long working.');
});

test('safeguarding and blocked messages get the fixed replies, and personal details are not kept', async ({ page }) => {
  await enrolled(page);
  await open(page);
  await ask(page, 'I want to die', { first: true });
  const reply = page.locator('article[aria-label="Study Buddy"]').first();
  await expect(reply).toContainText('Childline');
  await expect(reply).toContainText('0800 1111');
  await expect(reply).toContainText('999');
  await ask(page, 'my number is 07700 900123');
  await expect(page.locator('article[aria-label="Study Buddy"]').nth(1)).toContainText('do not share personal details');
  await page.locator('aside').getByRole('button', { name: 'New chat', exact: true }).first().click();
  const sessions = await page.request.get('/api/assistant/sessions');
  const list = (await sessions.json()).sessions as Array<{ id: string; title: string }>;
  expect(list.length).toBe(1);
  expect(list[0].title).toBe('New chat');
  const detail = await (await page.request.get(`/api/assistant/sessions/${list[0].id}`)).json();
  expect(JSON.stringify(detail)).not.toContain('07700');
});

test('a photo is attached, uploaded and seen by the model; a bad file says why', async ({ page }) => {
  await enrolled(page);
  await open(page);
  await page.getByRole('checkbox', { name: /18 or over/ }).check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /add file|file/i }).first().click();
  await (await chooser).setFiles({ name: 'working.jpg', mimeType: 'image/jpeg', buffer: JPEG });
  await expect(page.getByText('working.jpg')).toBeVisible();
  await page.getByLabel('Your message').fill('Is this right?');
  await page.getByRole('button', { name: /send/i }).click();
  await expect(page.locator('article[aria-label="Study Buddy"]').first()).toContainText('I can see your photo.');

  const bad = await page.request.post('/api/assistant/files', { multipart: { file: { name: 'run.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ not an image') } } });
  expect(bad.status()).toBe(422);
  expect((await bad.json()).error).toContain('JPEG or PNG photo, or a PDF');
});

test('chats can be opened again, deleted one at a time or all at once, and exported', async ({ page }) => {
  await enrolled(page);
  await open(page);
  await ask(page, 'First chat question', { first: true });
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
  await page.locator('aside').getByRole('button', { name: 'New chat', exact: true }).first().click();
  await ask(page, 'Second chat question', { first: true });
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'First chat question', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'First chat question', exact: true }).click();
  await expect(page.locator('article[aria-label="You"]').first()).toContainText('First chat question');

  const exported = await page.request.get('/api/assistant/export');
  expect(exported.headers()['content-disposition']).toContain('study-buddy-export.json');
  const data = await exported.json();
  expect(data.sessions.map((s: { title: string }) => s.title).sort()).toEqual(['First chat question', 'Second chat question']);

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete chat: First chat question' }).click();
  await expect(page.getByRole('button', { name: 'First chat question', exact: true })).toHaveCount(0);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete all my chats' }).click();
  await expect(page.getByText('No chats yet.')).toBeVisible();
  expect((await (await page.request.get('/api/assistant/sessions')).json()).sessions).toEqual([]);
});

test('the screen has no horizontal scroll at 360px and talks only to this site', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (r) => { const u = new URL(r.url()); if (u.protocol.startsWith('http')) hosts.add(u.host); });
  await page.setViewportSize({ width: 360, height: 800 });
  await enrolled(page);
  await open(page);
  await ask(page, 'Hello', { first: true });
  await expect(page.locator('article[aria-label="Study Buddy"]').first()).toContainText('Good question');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect([...hosts]).toEqual(['localhost:3101']);
});
