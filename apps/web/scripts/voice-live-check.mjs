#!/usr/bin/env node
/**
 * Voice chat end to end with the REAL pieces: Chromium's fake microphone plays a spoken question (synthesised by the speech sidecar's
 * own voice, then silence), the page's detector ends the turn, the sidecar's recogniser transcribes it (Parakeet by default,
 * `VOICE_STT_ENGINE=whisper` for the old path), the question is sent by itself, the local model answers on Ollama, and the answer is
 * spoken back (Kokoro by default, `VOICE_TTS_ENGINE=piper` for the old voice). Prints what was heard, the answer, and the timings.
 *
 *   npm run voice:dev                       (the sidecar, in one terminal)
 *   npm run dev -- -p 3111                  (LIBRARY_PHASE=enrolled; Ollama running; in another)
 *   node scripts/voice-live-check.mjs --base http://localhost:3111 --say "What is three quarters of twenty four?"
 *
 * Synthetic speech, a development machine: this checks the wiring and gives honest timings, not recognition quality for children.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const base = arg("--base", "http://localhost:3111");
const sidecar = arg("--voice", "http://127.0.0.1:8765");
const say = arg("--say", "What is three quarters of twenty four?");

// 1. The question as speech: Piper's WAV, resampled to 16 kHz mono, then 5 s of silence so the detector hears the end.
const dir = mkdtempSync(join(tmpdir(), "lt-voice-live-"));
const spoken = await fetch(`${sidecar}/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: say }) });
if (!spoken.ok) throw new Error(`the speech sidecar is not answering at ${sidecar}`);
writeFileSync(join(dir, "raw.wav"), Buffer.from(await spoken.arrayBuffer()));
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", join(dir, "raw.wav"), "-af", "apad=pad_dur=5", "-ar", "16000", "-ac", "1", "-sample_fmt", "s16", join(dir, "mic.wav")]);
const speechSeconds = (readFileSync(join(dir, "raw.wav")).length - 44) / 2 / 22050;

// 2. A browser with that file as its microphone.
const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${join(dir, "mic.wav")}%noloop`] });
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();
await page.goto(`${base}/api/dev/library-seed?action=tester`);
const login = await page.request.post(`${base}/api/account/login`, { data: { email: "tester@example.com", password: "study-buddy-test-2026" } });
if (!login.ok()) throw new Error(`sign-in failed (${login.status()})`);
await page.goto(`${base}/library/study-buddy`);
await page.getByRole("button", { name: "Talk instead of typing" }).waitFor({ timeout: 30_000 });
await page.getByRole("checkbox", { name: /18 or over/ }).check();

const times = {};
const speakLog = [];
page.on("request", (r) => {
  const url = r.url();
  if (url.endsWith("/voice/transcribe")) times.transcribeSent ??= Date.now();
  if (url.endsWith("/assistant/chat")) times.chatSent ??= Date.now();
});
page.on("response", (r) => {
  const url = r.url();
  if (url.endsWith("/voice/transcribe")) times.transcribed ??= Date.now();
  if (url.endsWith("/voice/speak")) {
    times.firstSpeech ??= Date.now();
    speakLog.push(r.status());
  }
});
const pressed = Date.now();
await page.getByRole("button", { name: "Talk instead of typing" }).click();
const you = page.locator('article[aria-label="You"] p').first();
await you.waitFor({ timeout: 60_000 });
const answer = page.locator('article[aria-label="LearnThrive AI"]').first();
await page.getByRole("button", { name: "Copy" }).first().waitFor({ timeout: 120_000 });
await page.waitForTimeout(4000); // let the spoken answer play
const panelState = await page.getByRole("region", { name: "Voice chat" }).getByRole("status").innerText();
const heard = await you.innerText();
const reply = await answer.innerText();
await page.getByRole("region", { name: "Voice chat" }).getByRole("button", { name: "Close voice chat" }).click();
await browser.close();

// The fake microphone starts playing when capture starts; the end of speech is that plus the length of the speech.
const endOfSpeech = (times.transcribeSent ?? pressed) - 900; // the detector waits 0.9 s of silence before ending the turn
const ms = (a, b) => (a && b ? `${b - a} ms` : "n/a");
console.log(`said:   ${say}  (${speechSeconds.toFixed(1)} s of speech)`);
console.log(`heard:  ${heard}`);
console.log(`answer: ${reply.replace(/\s+/g, " ").slice(0, 240)}`);
console.log(`silence detected, turn ended -> transcript: ${ms(times.transcribeSent, times.transcribed)}`);
console.log(`transcript -> sent automatically:          ${ms(times.transcribed, times.chatSent)}`);
console.log(`end of speech -> first spoken answer clip: ${ms(endOfSpeech, times.firstSpeech)} (includes the 0.9 s end-of-turn wait)`);
console.log(`press -> first spoken answer clip:         ${ms(pressed, times.firstSpeech)}`);
console.log(`speech clips: ${speakLog.length} (statuses ${[...new Set(speakLog)].join(", ") || "none"}); panel afterwards: "${panelState}"`);
