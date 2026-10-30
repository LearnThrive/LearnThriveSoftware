import { test, expect, type Page, type Request } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hydrated } from './careers-support';
import { address, confirm, distinctVisitor, expectAxeClean, signUp } from './account-support';

// Voice chat in a real browser, the hands-free path (the fake microphone says something for 1.5 s, then is silent for 4 s, looping): Chromium's fake microphone plays a WAV we write, the server uses the MOCK speech provider
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
  await page.goto('/library/ai');
  await expect(page.getByRole('heading', { level: 1, name: 'LearnThrive AI' })).toBeVisible();
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

// 1.5 s of "speech", then 4 s of silence, looping: the detector hears the end of each turn.
test.use(microphone(micFile([1.5, 4])));

test('speak once: the words are sent by themselves, once, as a normal message, and the answer is read out; no Send press', async ({ page }) => {
  await ready(page);
  const chats = chatRequests(page);
  expect(await micRequests(page)).toBe(0);
  await page.getByRole('button', { name: 'Talk instead of typing' }).click();
  await expect(panel(page)).toBeVisible();
  expect(await micRequests(page), 'the press is what asks for the microphone').toBe(1);
  await expect(state(page)).toHaveText(/Listening/);

  const spoke = page.waitForRequest((r) => r.url().endsWith('/api/assistant/voice/speak'));
  await expect(page.locator('article[aria-label="You"] p').first()).toHaveText(HEARD, { timeout: 15_000 });
  expect(chats).toHaveLength(1);
  expect(JSON.parse(chats[0]!.postData()!)).toMatchObject({ text: HEARD, voice: true });
  await expect(page.locator('article[aria-label="LearnThrive AI"]').first()).toContainText('Good question');
  const said = JSON.parse((await spoke).postData()!) as { text: string };
  expect(said.text, 'what is spoken has no LaTeX or Markdown').not.toMatch(/[$\\*#^]/);
  await expectAxeClean(page, 'voice chat panel');

  // Hands-free: the next turn starts by itself after the answer. Closing switches the microphone off.
  await expect.poll(() => micRequests(page), { timeout: 15_000 }).toBe(2);
  await panel(page).getByRole('button', { name: 'Close voice chat' }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(await liveTracks(page), 'no microphone track is left running').toBe(0);
  const before = chats.length;
  await page.waitForTimeout(3000);
  expect(chats.length, 'nothing more is sent after closing').toBe(before);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('with "Keep listening" off, the panel waits for a press after the answer; with read-aloud off nothing is spoken', async ({ page }) => {
  await ready(page);
  const speak: string[] = [];
  page.on('request', (r) => r.url().includes('/voice/speak') && speak.push(r.url()));
  await page.getByRole('button', { name: 'Talk instead of typing' }).click();
  await panel(page).getByRole('checkbox', { name: 'Keep listening' }).uncheck();
  await panel(page).getByRole('button', { name: 'Read aloud on' }).click();
  await expect(panel(page).getByRole('button', { name: 'Read aloud off' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('article[aria-label="LearnThrive AI"]').first()).toContainText('Good question', { timeout: 15_000 });
  await expect(state(page)).toHaveText('Tap to talk');
  await page.waitForTimeout(1500);
  expect(await micRequests(page)).toBe(1);
  expect(await liveTracks(page)).toBe(0);
  expect(speak).toEqual([]);
});
