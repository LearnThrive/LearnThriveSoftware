import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hydrated } from './careers-support';
import { address, confirm, distinctVisitor, expectAxeClean, signUp } from './account-support';

// plan19 phase G: voice mode in a real browser. The server uses the MOCK speech provider (VOICE_PROVIDER=mock) and Chromium's fake
// microphone, so the whole path runs (press, capture in an AudioWorklet, 16 kHz WAV, transcript, correct, send, spoken answer) with no
// real speech service and no real microphone. Recognition quality and latency are measured separately (docs/VOICE_BENCHMARK.md).

distinctVisitor();

// Chromium's default fake microphone only beeps now and then, which can fall outside a short recording on a busy machine. A steady tone
// in a WAV file is looped instead, so every recording has sound in it.
function toneFile(): string {
  const rate = 16000;
  const samples = rate * 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) wav.writeInt16LE(Math.round(0.4 * 32767 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  const file = join(mkdtempSync(join(tmpdir(), 'lt-mic-')), 'tone.wav');
  writeFileSync(file, wav);
  return file;
}

test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${toneFile()}`] },
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

test('a long answer is read aloud sentence by sentence while it is still arriving, and closing the panel is silence', async ({ page }) => {
  await ready(page);
  await page.getByRole('checkbox', { name: /18 or over/ }).check();
  await page.getByRole('button', { name: 'Talk instead' }).click();
  const panel = page.getByRole('dialog', { name: 'Voice mode' });
  await panel.getByRole('button', { name: 'Talk' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Listening' })).toBeVisible();
  await page.waitForTimeout(1500);
  await panel.getByRole('button', { name: 'Talk' }).click();
  const box = panel.getByLabel(/What I heard/);
  await expect(box).toHaveValue(/Factorise/);
  await box.fill('[slow] go on');
  const firstSpeech = page.waitForRequest((r) => r.url().endsWith('/api/assistant/voice/speak'));
  await panel.getByRole('button', { name: 'Send' }).click();
  await firstSpeech;
  // The answer has not finished: the first sentence is already being spoken while the rest is still arriving.
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  const spoken: string[] = [];
  page.on('request', (r) => r.url().endsWith('/voice/speak') && spoken.push(r.postData() ?? ''));
  // Closing the voice panel is silence, and the answer stops arriving.
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  const after = spoken.length;
  await page.waitForTimeout(1500);
  expect(spoken.length, 'nothing more is spoken once the panel is closed').toBe(after);
});
