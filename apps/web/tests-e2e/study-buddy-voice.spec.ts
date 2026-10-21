import { test, expect, type Page, type Request } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hydrated } from './careers-support';
import { address, confirm, distinctVisitor, expectAxeClean, signUp } from './account-support';

// Voice chat in a real browser: Chromium's fake microphone plays a WAV we write, the server uses the MOCK speech provider
// (VOICE_PROVIDER=mock: a fixed transcript, unsure of very short recordings) and the mock model. The whole path runs: the press,
// capture in an AudioWorklet, the end-of-speech detector, a 16 kHz WAV, the transcript, ONE automatic send, the spoken answer,
// and the next turn. Recognition quality and latency are measured separately (docs/VOICE_BENCHMARK.md).

distinctVisitor();

const HEARD = 'Factorise x squared plus five x plus six';

/** A looping fake-microphone file: `pattern` is [seconds of tone, seconds of silence, ...]. */
function micFile(pattern: number[]): string {
  const rate = 16000;
  const parts: number[] = [];
  pattern.forEach((seconds, i) => {
    for (let n = 0; n < seconds * rate; n += 1) parts.push(i % 2 === 0 ? Math.round(0.4 * 32767 * Math.sin((2 * Math.PI * 440 * n) / rate)) : 0);
  });
  const wav = Buffer.alloc(44 + parts.length * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + parts.length * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(parts.length * 2, 40);
  parts.forEach((v, i) => wav.writeInt16LE(v, 44 + i * 2));
  const file = join(mkdtempSync(join(tmpdir(), 'lt-mic-')), 'mic.wav');
  writeFileSync(file, wav);
  return file;
}
const microphone = (file: string) => ({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${file}`] },
});

async function ready(page: Page) {
  const email = address();
  await signUp(page, email);
  await confirm(page, email);
  expect((await page.request.post('/api/dev/library-seed', { data: { action: 'enrol', email } })).ok()).toBe(true);
  // Count microphone requests and keep every track, to prove nothing asks before a press and everything is switched off after.
  await page.addInitScript(() => {
    const w = window as unknown as { __mic: number; __tracks: MediaStreamTrack[] };
    w.__mic = 0;
    w.__tracks = [];
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    md.getUserMedia = async (constraints) => {
      w.__mic += 1;
      const stream = await real(constraints);
      w.__tracks.push(...stream.getTracks());
      return stream;
    };
  });
  await page.goto('/library/study-buddy');
  await expect(page.getByRole('heading', { level: 1, name: 'Study Buddy' })).toBeVisible();
  await hydrated(page);
  await page.getByRole('checkbox', { name: /18 or over/ }).check();
}

const micRequests = (page: Page) => page.evaluate(() => (window as unknown as { __mic: number }).__mic);
const liveTracks = (page: Page) => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.filter((t) => t.readyState === 'live').length);
const panel = (page: Page) => page.getByRole('region', { name: 'Voice chat' });
const state = (page: Page) => panel(page).getByRole('status');
function chatRequests(page: Page): Request[] {
  const seen: Request[] = [];
  page.on('request', (r) => {
    if (r.url().endsWith('/api/assistant/chat')) seen.push(r);
  });
  return seen;
}

// A steady tone: the detector never hears a silence, so only the button ends a turn.
test.use(microphone(micFile([10])));

test('tap to stop sends straight away, with no Send press', async ({ page }) => {
  await ready(page);
  const chats = chatRequests(page);
  await page.getByRole('button', { name: 'Talk instead of typing' }).click();
  await expect(state(page)).toHaveText(/Listening/);
  // Well over the mock's one-second "sure" threshold, allowing for the fake device starting late.
  await page.waitForTimeout(2500);
  const transcribed = page.waitForResponse((r) => r.url().endsWith('/api/assistant/voice/transcribe'));
  await panel(page).getByRole('button', { name: 'Stop and send' }).click();
  const response = await transcribed;
  const wav = response.request().postDataBuffer()!;
  expect(wav.subarray(0, 4).toString()).toBe('RIFF');
  expect(wav.readUInt32LE(24), 'sample rate').toBe(16000);
  expect(wav.readUInt16LE(22), 'channels').toBe(1);
  await expect(page.locator('article[aria-label="You"] p').first()).toHaveText(HEARD);
  expect(chats).toHaveLength(1);
});

test('when the words are uncertain it asks first: Edit, Try again and Send all work', async ({ page }) => {
  await ready(page);
  const chats = chatRequests(page);
  await page.getByRole('button', { name: 'Talk instead of typing' }).click();
  await expect(state(page)).toHaveText(/Listening/);
  // A very short recording: the mock recogniser is unsure of it.
  await page.waitForTimeout(600);
  await panel(page).getByRole('button', { name: 'Stop and send' }).click();
  await expect(state(page)).toHaveText('Did I hear that right?');
  await expect(panel(page).getByText(`“${HEARD}”`)).toBeVisible();
  await page.waitForTimeout(500);
  expect(chats, 'nothing is sent while it asks').toHaveLength(0);

  await panel(page).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Your message')).toHaveValue(HEARD);
  expect(chats).toHaveLength(0);

  await panel(page).getByRole('button', { name: 'Start talking' }).click();
  await expect(state(page)).toHaveText(/Listening/);
  await page.waitForTimeout(600);
  await panel(page).getByRole('button', { name: 'Stop and send' }).click();
  await expect(state(page)).toHaveText('Did I hear that right?');
  await panel(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('article[aria-label="You"] p').first()).toHaveText(HEARD);
  expect(chats).toHaveLength(1);
});

test('talking over a long answer stops it arriving and starts a new turn; Stop speaking is offered while it speaks', async ({ page }) => {
  await ready(page);
  // The spoken question is swapped on its way for one whose (mock) answer is long.
  await page.route('**/api/assistant/chat', async (route) => {
    const body = JSON.parse(route.request().postData()!);
    await route.continue({ postData: JSON.stringify({ ...body, text: '[slow] go on' }) });
  });
  await page.getByRole('button', { name: 'Talk instead of typing' }).click();
  await expect(state(page)).toHaveText(/Listening/);
  await page.waitForTimeout(1500);
  await panel(page).getByRole('button', { name: 'Stop and send' }).click();
  await expect(page.locator('article[aria-label="Study Buddy"]').first()).toContainText('Step 3', { timeout: 15_000 });
  await expect(panel(page).getByRole('button', { name: 'Stop speaking' })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Talk over the answer' }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await expect(state(page)).toHaveText(/Listening/);
  const shown = await page.locator('article[aria-label="Study Buddy"]').first().innerText();
  expect(shown).not.toContain('Step 80');
});


test('a blocked microphone says so plainly, nothing is recorded or sent, and typing still works', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  const voiceRequests: string[] = [];
  page.on('request', (r) => r.url().includes('/voice/') && voiceRequests.push(r.url()));
  await page.getByRole('button', { name: 'Talk instead of typing' }).click();
  await expect(state(page)).toHaveText('Microphone blocked');
  await expect(panel(page).getByText(/Allow it for this site/)).toBeVisible();
  expect(voiceRequests).toEqual([]);
  await page.getByLabel('Your message').fill('What is a fraction?');
  await page.getByRole('button', { name: /^send$/i }).click();
  await expect(page.locator('article[aria-label="Study Buddy"]').first()).toContainText('Good question');
});

test('a typed question is not sent as voice and is not read aloud', async ({ page }) => {
  await ready(page);
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
    await route.fulfill({ response, json: { ...(await response.json()), voice: false } });
  });
  await ready(page);
  await expect(page.getByLabel('Your message')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Talk instead of typing' })).toHaveCount(0);
});

test('leaving the page while it listens switches the microphone off', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Talk instead of typing' }).click();
  await expect(state(page)).toHaveText(/Listening/);
  expect(await liveTracks(page)).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(state(page)).toHaveText('Tap to talk');
  await expect(panel(page).getByText('I stopped listening because you left the page.')).toBeVisible();
  expect(await liveTracks(page)).toBe(0);
});
