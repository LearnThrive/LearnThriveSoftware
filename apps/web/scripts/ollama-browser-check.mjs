#!/usr/bin/env node
/**
 * The owner's failing case through the REAL website: sign in, open LearnThrive AI, attach a photo of a worked answer, ask for it to be
 * checked, and time what the page shows. Needs the dev server on the Ollama configuration (launch.json "study-buddy-ollama", :3111)
 * and the models running (`npm run ollama:local -- start`).
 *
 *   node scripts/ollama-browser-check.mjs [--base http://localhost:3111] [--cold] [--out=path.json]
 *
 * --cold evicts the tutor first, so the page must show "Preparing the model" and still answer. Writes timings and the visible state
 * sequence only: no screenshot of the answer, no transcript, no image.
 */
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const base = arg("--base", "http://localhost:3111");
const cold = process.argv.includes("--cold");
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const out = resolve(REPO, (process.argv.find((a) => a.startsWith("--out="))?.slice(6)) ?? "docs/benchmarks/browser-check.json");
const OLLAMA = process.env.ASSISTANT_BASE_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.ASSISTANT_MODEL ?? "bonsai-2:9b";
const say = (t) => console.log(`[browser-check] ${t}`);

function photo() {
  const canvas = createCanvas(1000, 780);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fbfbf5";
  ctx.fillRect(0, 0, 1000, 780);
  ctx.fillStyle = "#141414";
  const line = (text, x, y, size = 27) => {
    ctx.font = `${size}px sans-serif`;
    ctx.fillText(text, x, y);
  };
  line("Question 7", 60, 80, 32);
  line("An arithmetic sequence has first term 5 and common difference 7.", 60, 140, 26);
  line("(a) Write down the 10th term.", 60, 200);
  line("(b) The sum of the first n terms is S = n/2 (2a + (n-1)d).", 60, 260, 26);
  line("     Find the least n for which S > 800.", 60, 305, 26);
  line("My working", 60, 380, 30);
  line("a = 5, d = 7", 80, 440);
  line("10th term = 5 + 9 x 7 = 5 + 63 = 68", 80, 500);
  line("S = n/2 (10 + 7(n-1)) = n/2 (7n + 3)", 80, 560);
  line("Try n = 15: 7.5 x 108 = 810. So n = 15.", 80, 620);
  return canvas.toBuffer("image/png");
}

if (cold) {
  await fetch(`${OLLAMA}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, prompt: "", keep_alive: 0, stream: false }) }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
}

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
// Tee the chat stream so the server events (and when they arrived) are recorded next to what the page showed.
await page.addInitScript(() => {
  const original = window.fetch;
  window.__events = [];
  window.fetch = async (...args) => {
    const response = await original(...args);
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
    if (!url.includes("/api/assistant/chat") || !response.body) return response;
    const [a, b] = response.body.tee();
    const t0 = performance.now();
    (async () => {
      const reader = b.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(String.fromCharCode(10));
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          try { const e = JSON.parse(line); window.__events.push({ ms: Math.round(performance.now() - t0), type: e.type + (e.state ? ":" + e.state : "") }); } catch {}
        }
      }
    })();
    return new Response(a, { status: response.status, headers: response.headers });
  };
});
await page.goto(`${base}/api/dev/library-seed?action=tester`);
const login = await page.request.post(`${base}/api/account/login`, { data: { email: "tester@example.com", password: "study-buddy-test-2026" } });
if (!login.ok()) throw new Error(`sign-in failed: ${login.status()}`);
await page.goto(`${base}/library/study-buddy`);
await page.waitForLoadState("networkidle");

await page.locator('input[type="file"]').first().setInputFiles({ name: "question-7.png", mimeType: "image/png", buffer: photo() });
const box = page.getByPlaceholder("Ask about your work");
await box.fill("Please check my working on question 7 and tell me if part (b) is right.");

// Record every notice the page shows, with the time it first appeared.
const started = Date.now();
await page.evaluate(() => {
  window.__seen = [];
  const t0 = performance.now();
  new MutationObserver(() => {
    for (const el of document.querySelectorAll('[role="status"], [class*="thinking"] span')) {
      const text = el.textContent?.trim();
      if (text && !window.__seen.some((s) => s.text === text)) window.__seen.push({ text, ms: Math.round(performance.now() - t0) });
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
  window.__t0 = t0;
});
await page.getByRole("button", { name: /^send/i }).first().click();

const answer = page.getByRole("article", { name: "LearnThrive AI" }).last();
let firstTextMs = null;
let finalMs = null;
let error = null;
let last = "";
let stable = 0;
while (Date.now() - started < 300_000) {
  await page.waitForTimeout(300);
  const text = ((await answer.textContent().catch(() => "")) ?? "").trim();
  const real = text.length > 20 && !/^(thinking|LearnThrive AI is thinking|preparing|reading|working)/i.test(text);
  if (real && firstTextMs === null) firstTextMs = Date.now() - started;
  if (real && text === last) stable += 1;
  else stable = 0;
  last = text;
  if (/took too long|try a shorter|couldn.t|unavailable/i.test(text)) { error = text.slice(0, 120); break; }
  if (stable >= 10 && firstTextMs !== null) { finalMs = Date.now() - started; break; }
}
const seen = await page.evaluate(() => window.__seen ?? []);
const events = await page.evaluate(() => (window.__events ?? []).filter((e, i, all) => e.type !== "delta" || all.findIndex((x) => x.type === "delta") === i));
const result = {
  checkedAt: new Date().toISOString(),
  base,
  model: MODEL,
  cold,
  viewport: "1440x900",
  firstVisibleMs: firstTextMs,
  settledMs: finalMs,
  error,
  answerChars: last.length,
  answerMentionsQuestion: /(sum|n\s*=|term|810|800|S\s*>)/i.test(last),
  serverEvents: events,
  noticesShown: seen.map((s) => ({ ms: s.ms, text: s.text.slice(0, 60) })),
  passed: !error && firstTextMs !== null && last.length > 40,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
say(`${cold ? "cold" : "warm"}: ${error ?? "no error"}, first visible ${firstTextMs} ms, settled ${finalMs} ms, notices ${JSON.stringify(seen.map((s) => s.text.slice(0, 40)))}`);
await browser.close();
if (!result.passed) process.exitCode = 1;
