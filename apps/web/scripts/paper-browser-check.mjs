#!/usr/bin/env node
/**
 * The Paper Tutor through the REAL website, from the upload to the downloaded PDF, with the local model.
 *
 *   node --import tsx scripts/paper-browser-check.mjs --paper "<blank question 3 screenshot>.png" [--out <folder>] [--base http://localhost:3111]
 *
 * It signs in, then for each of the three output modes uploads the blank question image, reads what the selection panel offers, solves with the model the
 * server is configured for (not a mock), downloads the PDF, REOPENS it (page count, renders every page to a PNG for looking at) and reads the summary the
 * page posted into the chat. The "answers and working" run stays in its conversation: the page is RELOADED, the chat is opened again from its history, and a
 * picture of part (b) is uploaded to the same conversation to show the earlier question, diagram and result carried across the reload.
 *
 * Needs the dev server on the Ollama configuration (launch.json "study-buddy-ollama", :3111) and the models running (npm run ollama:local -- start).
 * Writes the downloaded PDFs, their page images and report.json to --out, and docs/benchmarks/paper-browser.json (the model and its digest, the context it ran
 * at, the storage and the provider, timestamps and artifact paths, what the panel offered, and every check with its result: no transcript, no image).
 * Exits non-zero if the original acceptance requirements do not pass. The expected figures live here, never in the solver's prompt.
 */
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { readPdfDocument, renderPdfPages } from "../src/lib/assistant/documents.ts";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
if (!args.paper) throw new Error('give --paper "<blank screenshot of question 3>.png"');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const base = args.base ?? "http://localhost:3111";
const OLLAMA = process.env.ASSISTANT_BASE_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.ASSISTANT_MODEL ?? "bonsai-2:9b";
const OUT = resolve(args.out ?? resolve(REPO, ".paper-browser"));
mkdirSync(OUT, { recursive: true });
const say = (t) => console.log(`[paper-browser] ${t}`);
const stamp = () => new Date().toISOString();
const MODE_LABEL = { hybrid: /Answers and working/, filled: /Answers on the paper/, worked: /Worked solutions/ };

const get = (url) => fetch(url, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
async function ollamaFacts() {
  const [tags, ps, version] = await Promise.all([get(`${OLLAMA}/api/tags`), get(`${OLLAMA}/api/ps`), get(`${OLLAMA}/api/version`)]);
  const tag = (tags?.models ?? []).find((m) => m.name === MODEL);
  const running = (ps?.models ?? []).map((m) => ({ name: m.name, digest: m.digest?.slice(0, 12), contextLength: m.context_length ?? null, sizeVramMiB: Math.round((m.size_vram ?? 0) / 1048576), expiresAt: m.expires_at }));
  return { server: version?.version ?? null, model: MODEL, digest: tag?.digest?.slice(0, 12) ?? null, quantisation: tag?.details?.quantization_level ?? null, running };
}
const chatRequests = () => {
  const log = resolve(REPO, ".ollama-local", "main.log");
  return existsSync(log) ? (readFileSync(log, "utf8").match(/POST\s+"\/api\/chat"/g) ?? []).length : null;
};

function partB() {
  const canvas = createCanvas(900, 360);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 900, 360);
  ctx.fillStyle = "#000";
  ctx.font = "26px serif";
  ctx.fillText("(b)  Petra finds that 1 litre of paint covers 11 m² of floor,", 50, 90);
  ctx.fillText("      not 10 m².", 50, 130);
  ctx.fillText("      Does this change your answer to part (a)?", 50, 180);
  ctx.fillText("      You must show your working.", 50, 220);
  ctx.fillStyle = "#777";
  ctx.fillText("(3)", 780, 330);
  return canvas.toBuffer("image/png");
}

await fetch(`${OLLAMA}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, prompt: "", keep_alive: 0, stream: false }) }).catch(() => {});
const before = { at: stamp(), ollama: await ollamaFacts(), chatRequests: chatRequests() };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })).newPage();
await page.goto(`${base}/api/dev/library-seed?action=tester`);
const login = await page.request.post(`${base}/api/account/login`, { data: { email: "tester@example.com", password: "study-buddy-test-2026" } });
if (!login.ok()) throw new Error(`sign-in failed: ${login.status()}`);
await page.goto(`${base}/library/ai`);
await page.waitForLoadState("networkidle");
const status = await (await page.request.get(`${base}/api/assistant/status`)).json();
const report = { startedAt: stamp(), base, server: { launch: "launch.json study-buddy-ollama (npm run dev -- -p 3111)", storage: "in-memory library store, chat store, job store and upload storage (no LEARNTHRIVE_SUPABASE_USE): nothing here is written to a database", assistantStatus: { open: status.open, paperTutor: status.paperTutor } }, before, rounds: {}, checks: {} };

const ticked = async () => {
  const adult = page.getByRole("checkbox", { name: /18 or over/ });
  if (await adult.count()) await adult.check();
};
await ticked();

const lastSummary = async () => ((await page.locator('article[aria-label="LearnThrive AI"]').last().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();

/** One run through the panel: upload, look at the selection, solve in the chosen mode, download, reopen. */
async function round(label, name, buffer, mode) {
  const t0 = Date.now();
  await page.getByTestId("ai-input-image").setInputFiles({ name, mimeType: "image/png", buffer });
  await page.getByRole("button", { name: `Preview ${name}` }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Solve this paper" }).first().click();
  await page.getByText(/Questions found \(\d+\)/).waitFor({ timeout: 300_000 });
  const found = (await page.getByText(/Questions found \(\d+\)/).textContent()) ?? "";
  const rows = (await page.locator("li").filter({ hasText: /^Q\d/ }).allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
  const notes = (await page.locator("[class*=note]").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  await page.screenshot({ path: resolve(OUT, `${label}-selection.png`) });
  await page.getByRole("radio", { name: MODE_LABEL[mode] }).check();
  await page.getByRole("button", { name: /^Solve (all|\d+|selected)/i }).first().click();
  const link = page.getByRole("link", { name: /Download the worked paper/ });
  await link.waitFor({ timeout: 1_200_000 });
  const solvedMs = Date.now() - t0;
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  const path = resolve(OUT, `${label}.pdf`);
  await download.saveAs(path);
  await page.screenshot({ path: resolve(OUT, `${label}-done.png`) });
  // Reopen the downloaded PDF: it must open, have the paper's page and the pages the mode adds, and render.
  const bytes = new Uint8Array(readFileSync(path));
  const opened = await readPdfDocument(bytes, { render: false, maxPages: 60 });
  const pages = [];
  for (const drawn of await renderPdfPages(bytes, { scale: 1.3 })) {
    const png = resolve(OUT, `${label}-page${drawn.number}.jpg`);
    writeFileSync(png, drawn.jpeg());
    pages.push(png);
  }
  const summary = await lastSummary();
  say(`${label} (${mode}): ${found.trim()} ${JSON.stringify(rows)}${notes.length ? ` | ${notes.at(-1).slice(0, 160)}` : ""} | solved in ${Math.round(solvedMs / 1000)} s | PDF ${opened.ok ? opened.pageCount : "does not open"} pages`);
  return { mode, found: found.trim(), selection: rows, notes, solvedMs, pdf: path, pdfOpens: opened.ok, pdfPages: opened.ok ? opened.pageCount : 0, pageImages: pages, summary, finishedAt: stamp() };
}

const closePanel = async () => {
  const close = page.getByRole("button", { name: /Close|Dismiss/i }).first();
  if (await close.count()) await close.click().catch(() => {});
};
const newChat = async () => {
  await page.getByRole("button", { name: "New chat", exact: true }).first().click();
  await ticked();
};

const blank = readFileSync(resolve(args.paper));
report.rounds.filled = await round("q3a-filled", "question-3a-filled.png", blank, "filled");
await closePanel();
await newChat();
report.rounds.worked = await round("q3a-worked", "question-3a-worked.png", blank, "worked");
await closePanel();
await newChat();
report.rounds.hybrid = await round("q3a-hybrid", "question-3a-hybrid.png", blank, "hybrid");
await closePanel();

// The conversation of the "answers and working" run: reload the page, open it again from its history, then upload part (b) to it.
await page.reload();
await page.waitForLoadState("networkidle");
await ticked();
const history = page.locator("[aria-label='Your chats'] button").filter({ hasText: /./ });
const titles = (await history.allTextContents()).map((t) => t.trim()).filter(Boolean);
report.afterReload = { chatsListed: titles.length };
await page.locator("[aria-label='Your chats'] li button").first().click().catch(async () => history.nth(1).click());
await page.waitForTimeout(2000);
report.rounds.partB = await round("q3b", "question-3b.png", partB(), "worked");

// Checks. The expected figures are the owner's; none is in the solver's prompt.
const text = (r) => r.summary;
const a = report.rounds;
report.checks.selectionIsOneTask = [a.filled, a.worked, a.hybrid].every((r) => /Questions found \(1\)/.test(r.found) && r.selection.length === 1 && /3\(a\)/.test(r.selection[0]) && !/^Q3\s/.test(r.selection[0]));
report.checks.fourMarksOffered = [a.filled, a.worked, a.hybrid].every((r) => /4 marks/.test(r.selection[0] ?? ""));
report.checks.pdfsReopen = Object.values(a).every((r) => r.pdfOpens && r.pdfPages >= 1);
report.checks.extraPagesWhereAsked = a.worked.pdfPages > 1 && a.hybrid.pdfPages > 1;
report.checks.area68 = /\b68\b/.test(text(a.hybrid)) && /\b68\b/.test(text(a.worked));
report.checks.paint7_5 = /\b7\.5\b/.test(text(a.hybrid)) && /\b7\.5\b/.test(text(a.worked));
report.checks.coverage75 = /\b75\b/.test(text(a.hybrid)) && /\b75\b/.test(text(a.worked));
// (The page renders maths twice in its text, so "Yes" can read "YesYes".) A supported Yes: the reason is given and names both figures.
report.checks.supportedYes = /Yes/.test(text(a.hybrid)) && /Yes,? because[^.]*\b75\b[^.]*\b68\b/i.test(text(a.hybrid));
report.checks.partBLinkedAfterReload = a.partB.notes.some((n) => /using its shared words|earlier upload/i.test(n));
report.checks.partB82_5 = /\b82\.5\b/.test(text(a.partB));
report.checks.partBStillEnough = /(still|not change|does not|no change)/i.test(text(a.partB)) && /enough|more than|exceeds/i.test(text(a.partB));
report.checks.noInternalWords = Object.values(a).every((r) => !/\bcomparison\b|final_answer|\bJSON\b|\bfield\b|schema/i.test(`${r.summary} ${r.notes.join(" ")}`));
report.passed = Object.values(report.checks).every(Boolean);
report.after = { at: stamp(), ollama: await ollamaFacts(), chatRequests: chatRequests() };
report.finishedAt = stamp();
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
// The committed report keeps the facts and the checks, not the chat text.
const committed = JSON.parse(JSON.stringify(report));
for (const r of Object.values(committed.rounds)) r.summary = `${r.summary.length} characters (not stored)`;
mkdirSync(resolve(REPO, "docs", "benchmarks"), { recursive: true });
writeFileSync(resolve(REPO, "docs", "benchmarks", "paper-browser.json"), `${JSON.stringify(committed, null, 2)}\n`);
say(JSON.stringify(report.checks));
say(`${report.passed ? "PASSED" : "FAILED"}; artifacts in ${OUT}`);
await browser.close();
if (!report.passed) process.exitCode = 1;
