import { test, expect, type Page } from '@playwright/test';
import { hydrated } from './careers-support';
import { address, confirm, distinctVisitor, expectAxeClean, signUp } from './account-support';

// plan19 phase G: voice mode in a real browser. The server uses the MOCK speech provider (VOICE_PROVIDER=mock) and Chromium's fake
// microphone, so the whole path runs (press, capture in an AudioWorklet, 16 kHz WAV, transcript, correct, send, spoken answer) with no
// real speech service and no real microphone. Recognition quality and latency are measured separately (docs/VOICE_BENCHMARK.md).

distinctVisitor();

test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

async function ready(page: Page) {
  const email = address();
  await signUp(page, email);
  await confirm(page, email);
  expect((await page.request.post('/api/dev/library-seed', { data: { action: 'enrol', email } })).ok()).toBe(true);
  // Count microphone requests from the very first script, to prove nothing asks before a press.
  await page.addInitScript(() => {
    const w = window as unknown as { __mic: number };
    w.__mic = 0;
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    md.getUserMedia = (constraints) => {
      w.__mic += 1;
      return real(constraints);
    };
  });
  await page.goto('/library/study-buddy');
  await expect(page.getByRole('heading', { level: 1, name: 'Study Buddy' })).toBeVisible();
  await hydrated(page);
}

const micRequests = (page: Page) => page.evaluate(() => (window as unknown as { __mic: number }).__mic);

test('talk, check the words, send: the answer is short-spoken and read aloud, and the microphone is only asked for at the press', async ({ page }) => {
  await ready(page);
  await page.getByRole('checkbox', { name: /18 or over/ }).check();
  expect(await micRequests(page)).toBe(0);

  await page.getByRole('button', { name: 'Talk instead' }).click();
  const panel = page.getByRole('dialog', { name: 'Voice mode' });
  await expect(panel).toBeVisible();
  expect(await micRequests(page), 'opening the panel does not ask for the microphone').toBe(0);
  await expectAxeClean(page, 'voice panel, idle');

  await panel.getByRole('button', { name: 'Talk' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Listening' })).toBeVisible();
  expect(await micRequests(page)).toBe(1);
  await page.waitForTimeout(1500);
  const transcribed = page.waitForResponse((r) => r.url().endsWith('/api/assistant/voice/transcribe'));
  await panel.getByRole('button', { name: 'Talk' }).click();
  const response = await transcribed;
  expect(response.status()).toBe(200);
  expect(response.request().headers()['content-type']).toBe('audio/wav');
  const wav = response.request().postDataBuffer()!;
  expect(wav.subarray(0, 4).toString()).toBe('RIFF');
  expect(wav.readUInt32LE(24), 'sample rate').toBe(16000);
  expect(wav.readUInt16LE(22), 'channels').toBe(1);
  expect(wav.readUInt16LE(34), 'bits').toBe(16);

  // The words are shown to be checked, and can be corrected, before anything is sent.
  const box = panel.getByLabel(/What I heard/);
  await expect(box).toHaveValue('Factorise x squared plus five x plus six');
  await box.fill('Factorise x squared plus five x plus six please');
  await expectAxeClean(page, 'voice panel, with a transcript');

  const chat = page.waitForRequest((r) => r.url().endsWith('/api/assistant/chat'));
  const spoke = page.waitForResponse((r) => r.url().endsWith('/api/assistant/voice/speak'));
  await panel.getByRole('button', { name: 'Send' }).click();
  const sent = JSON.parse((await chat).postData()!) as { text: string; voice?: boolean };
  expect(sent.text).toBe('Factorise x squared plus five x plus six please');
  expect(sent.voice, 'a spoken question asks for speakable wording').toBe(true);
  const audio = await spoke;
  expect(audio.status()).toBe(200);
  expect(audio.headers()['content-type']).toBe('audio/wav');
  const said = JSON.parse(audio.request().postData()!) as { text: string };
  expect(said.text, 'what is spoken has no LaTeX or Markdown').not.toMatch(/[$\\*#^]/);

  await expect(panel.getByRole('status').filter({ hasText: /Ready|Speaking/ })).toBeVisible();
  await expect(panel.getByRole('status').filter({ hasText: 'Ready' })).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await micRequests(page)).toBe(1);
});

test('a typed question is not sent as voice, and is not read aloud', async ({ page }) => {
  await ready(page);
  await page.getByRole('checkbox', { name: /18 or over/ }).check();
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  const chat = page.waitForRequest((r) => r.url().endsWith('/api/assistant/chat'));
  await page.getByLabel('Your message').fill('What is a fraction?');
  await page.getByRole('button', { name: /^send$/i }).click();
  expect(JSON.parse((await chat).postData()!).voice).toBeUndefined();
  await expect(page.locator('article[aria-label="Study Buddy"]').first()).toContainText('Good question');
  await page.waitForTimeout(500);
  expect(requests.filter((u) => u.includes('/voice/'))).toEqual([]);
});

test('without a speech service the microphone button is not offered at all', async ({ page }) => {
  await page.route('**/api/assistant/status', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, voice: false } });
  });
  await ready(page);
  await expect(page.getByLabel('Your message')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Talk instead' })).toHaveCount(0);
});

test('a blocked microphone says so and nothing is sent', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  const sentAudio: string[] = [];
  page.on('request', (r) => r.url().includes('/voice/') && sentAudio.push(r.url()));
  await page.getByRole('button', { name: 'Talk instead' }).click();
  await page.getByRole('dialog', { name: 'Voice mode' }).getByRole('button', { name: 'Talk' }).click();
  await expect(page.getByText('The microphone is blocked')).toBeVisible();
  expect(sentAudio).toEqual([]);
});

test('a recording that is too short is not sent', async ({ page }) => {
  await ready(page);
  const sentAudio: string[] = [];
  page.on('request', (r) => r.url().includes('/voice/') && sentAudio.push(r.url()));
  await page.getByRole('button', { name: 'Talk instead' }).click();
  const talk = page.getByRole('dialog', { name: 'Voice mode' }).getByRole('button', { name: 'Talk' });
  // The page's clock is frozen at the moment of the press, so the recording is (deterministically) shorter than the minimum.
  const pressed = await page.evaluate(() => Date.now());
  await talk.click();
  await expect(page.getByRole('dialog', { name: 'Voice mode' }).getByRole('status').filter({ hasText: 'Listening' })).toBeVisible();
  await page.evaluate((t) => { Date.now = () => t; }, pressed);
  await talk.click();
  await expect(page.getByText('That was too short')).toBeVisible();
  expect(sentAudio).toEqual([]);
});
