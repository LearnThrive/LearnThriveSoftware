#!/usr/bin/env node
/**
 * Screenshots and layout measurements of Study Buddy at the widths the redesign must hold (1440, 1024, 768, 390, 320), for before and
 * after comparisons. Needs a development server with the mock assistant (the "study-buddy-mock" launch configuration, port 3110):
 *
 *   node scripts/study-buddy-shots.mjs --label before          writes docs/screenshots/study-buddy/before/*.png and a JSON of checks
 *   node scripts/study-buddy-shots.mjs --label after --base http://localhost:3110
 *
 * Checks per width: horizontal overflow, how many elements scroll vertically at once (one is the goal), whether the composer is fully
 * on screen, the height of the page heading, and whether the last message is visible above the composer.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const label = arg("--label", "run");
const base = arg("--base", "http://localhost:3110");
const scheme = arg("--scheme", "light");
const out = join(here, "..", "..", "..", "docs", "screenshots", "study-buddy", label);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const context = await browser.newContext({ colorScheme: scheme, permissions: ["microphone"] });
const page = await context.newPage();
await page.goto(`${base}/api/dev/library-seed?action=tester`);
const login = await page.request.post(`${base}/api/account/login`, { data: { email: "tester@example.com", password: "study-buddy-test-2026" } });
if (!login.ok()) throw new Error(`sign-in failed: ${login.status()}`);

// A conversation with maths, a list and a long answer, through the real chat route (mock model).
const ask = async (text, sessionId) => {
  const response = await page.request.post(`${base}/api/assistant/chat`, { data: { text, sessionId, adultAck: true } });
  const first = (await response.text()).trim().split("\n")[0];
  return JSON.parse(first).sessionId;
};
const sid = await ask("Factorise x^2 + 5x + 6");
await ask("Can you show me the quadratic formula with a long worked example?", sid);
await ask("Please explain completing the square as well, step by step, with every line of working shown.", sid);
await ask("Thanks. And what is 3/4 + 1/8?", sid);

const results = [];
for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 640]]) {
  await page.setViewportSize({ width, height });
  await page.goto(`${base}/library/study-buddy`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  if (width === 1440 || width === 390) await page.screenshot({ path: join(out, `empty-${width}.png`) });
  const open = page.getByRole("button", { name: /Factorise x\^2/ }).first();
  if (await open.isVisible().catch(() => false)) await open.click();
  else {
    // A narrow layout may keep the chat list in a drawer.
    const drawer = page.getByRole("button", { name: /chats|history|menu/i }).first();
    if (await drawer.isVisible().catch(() => false)) {
      await drawer.click();
      await page.getByRole("button", { name: /Factorise x\^2/ }).first().click();
    }
  }
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  await page.screenshot({ path: join(out, `chat-${width}.png`) });
  if (width === 390) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `drawer-${width}.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  const checks = await page.evaluate(() => {
    const doc = document.documentElement;
    const scrollers = [...document.querySelectorAll("*")].filter((el) => {
      const s = getComputedStyle(el);
      return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 80;
    });
    const pageScrolls = doc.scrollHeight > doc.clientHeight + 2;
    const composer = document.querySelector("[data-ai-input]");
    const rect = composer?.getBoundingClientRect();
    const h1 = document.querySelector("h1");
    const messages = [...document.querySelectorAll('article[aria-label]')];
    const last = messages.at(-1)?.getBoundingClientRect();
    return {
      horizontalOverflow: doc.scrollWidth > doc.clientWidth,
      scrollingAreas: scrollers.length + (pageScrolls ? 1 : 0),
      scrollers: scrollers.map((el) => el.className.toString().slice(0, 40)),
      pageScrolls,
      composerOnScreen: Boolean(rect && rect.top >= 0 && rect.bottom <= window.innerHeight),
      headingPx: h1 ? Math.round(parseFloat(getComputedStyle(h1).fontSize)) : null,
      lastMessageAboveComposer: Boolean(last && rect && last.top < rect.top),
    };
  });
  results.push({ width, ...checks });
  console.log(width, JSON.stringify(checks));
}

// The voice panel, desktop and phone.
for (const [width, height] of [[1440, 900], [390, 844]]) {
  await page.setViewportSize({ width, height });
  await page.goto(`${base}/library/study-buddy`);
  await page.waitForLoadState("networkidle");
  const talk = page.getByRole("button", { name: /Talk instead|Voice/i }).first();
  if (await talk.isVisible().catch(() => false)) {
    const ack = page.getByRole("checkbox", { name: /18 or over/ });
    if (await ack.isVisible().catch(() => false)) await ack.check();
    await talk.click();
    await page.getByRole("region", { name: "Voice chat" }).getByRole("status").filter({ hasText: /Listening/ }).waitFor({ timeout: 10_000 }).catch(() => {});
    await page.screenshot({ path: join(out, `voice-${width}.png`) });
  }
}
// The Paper Tutor: the offer, the checklist, and the finished paper with its preview (the mock model, so the answers are canned).
const worksheet = join(here, "..", "tests", "fixtures", "documents", "text-native.pdf");
for (const [width, height] of [[1440, 900], [390, 844], [320, 640]]) {
  await page.setViewportSize({ width, height });
  await page.goto(`${base}/library/study-buddy`);
  await page.waitForLoadState("networkidle");
  const ack = page.getByRole("checkbox", { name: /18 or over/ });
  if (await ack.isVisible().catch(() => false)) await ack.check();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add a file", exact: true }).click();
  await (await chooser).setFiles(worksheet);
  const offer = page.getByRole("button", { name: "Solve this paper" });
  if (!(await offer.waitFor({ timeout: 15_000 }).then(() => true, () => false))) break;
  await page.screenshot({ path: join(out, `paper-offer-${width}.png`) });
  await offer.click();
  const panel = page.getByRole("region", { name: "Solve this paper" });
  await panel.getByRole("group", { name: /Questions found/ }).waitFor({ timeout: 30_000 });
  await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  await page.screenshot({ path: join(out, `paper-choose-${width}.png`) });
  await panel.getByRole("button", { name: /^Solve / }).click();
  await panel.getByRole("link", { name: "Download the worked paper" }).waitFor({ timeout: 120_000 });
  await panel.getByRole("button", { name: "Preview" }).click();
  await panel.getByRole("img").waitFor();
  await page.waitForTimeout(800);
  const checks = await page.evaluate(() => {
    const doc = document.documentElement;
    const rect = document.querySelector("[data-ai-input]")?.getBoundingClientRect();
    return { horizontalOverflow: doc.scrollWidth > doc.clientWidth, pageScrolls: doc.scrollHeight > doc.clientHeight + 2, composerOnScreen: Boolean(rect && rect.top >= 0 && rect.bottom <= window.innerHeight) };
  });
  results.push({ width, paperTutor: true, ...checks });
  console.log(width, "paper", JSON.stringify(checks));
  await page.screenshot({ path: join(out, `paper-done-${width}.png`) });
}
writeFileSync(join(out, "checks.json"), JSON.stringify({ label, base, scheme, date: new Date().toISOString(), results }, null, 2));
await browser.close();
console.log("written to", out);
