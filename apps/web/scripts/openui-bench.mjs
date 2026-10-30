#!/usr/bin/env node
/**
 * Plain Beam against Beam-generated interactive interfaces, on a fixed prompt set, with the numbers that decide whether an interface earns its place
 * (docs/OPENUI.md). Writes docs/OPENUI_BENCHMARK.md and docs/benchmarks/openui-results.json (every program, for a person to read).
 *
 *   OLLAMA_API_KEY=... npm run assistant:openui-bench -- --runs 3 --render http://localhost:3101
 *
 *   --runs N        runs per prompt (default 1)
 *   --render BASE   also draw every program on BASE/dev/ui-components/openui in a real browser and try its controls (BASE must be a running dev server)
 *   --price-out P   GBP per million OUTPUT tokens, as published by the provider on the day. Unset: no cost is estimated (a free promotion is not a price,
 *                   and no price is assumed here). Input tokens are not counted, so the figure is a floor
 *   --mock          the scripted stand-in instead of Beam. It checks THE HARNESS ONLY and the report is labelled so: it says nothing about Beam
 *
 * What is measured per run: time to first visible content, total time, output tokens, whether the first draft parsed and validated, repairs spent, whether a
 * valid interface was finally built, whether the browser drew it and whether its controls worked, and the share of quotations that were verified. What is NOT
 * measured here, and is said so in the report: educational correctness (it needs a teacher; the programs are written out for that).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assistantConfig } from "../src/lib/assistant/config.ts";
import { buildProvider } from "../src/lib/assistant/providers.ts";
import { buildResearch } from "../src/lib/assistant/runtime.ts";
import { runInterface } from "../src/lib/assistant/interface.ts";
import { ActivityLog } from "../src/lib/assistant/activity.ts";
import { SYSTEM_PROMPT } from "../src/lib/assistant/prompt.ts";
import { interfacePrompt } from "../src/lib/openui/library.ts";
import { planInterface } from "../src/lib/openui/intent.ts";
import { parseStoredMessage } from "../src/lib/openui/format.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const value = (name, fallback = "") => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? fallback) : fallback);
const runs = Math.max(1, Number(value("--runs", "1")) || 1);
const render = value("--render");
const mock = args.includes("--mock");
const priceOut = value("--price-out") ? Number(value("--price-out")) : null;
const outFile = resolve(value("--out", join(here, "..", "..", "..", "docs", "OPENUI_BENCHMARK.md")));

if (!mock && !process.env.OLLAMA_API_KEY?.trim()) {
  console.error("OLLAMA_API_KEY is not set, so nothing was run. Use your own environment, or --mock to check the harness only.");
  process.exit(2);
}
const env = { ...process.env, NODE_ENV: "development", ASSISTANT_PROVIDER: mock ? "mock" : "ollama_cloud" };
const config = assistantConfig(env);
const provider = buildProvider(config, env);

const PROMPTS = [
  ["explain", "Explain photosynthesis"],
  ["interactive", "Show me photosynthesis interactively"],
  ["quiz-bio", "Quiz me on photosynthesis"],
  ["quiz-fractions", "Quiz me on adding fractions"],
  ["graph-parabola", "Plot y = x² and let me move it"],
  ["graph-lines", "Graph y = 2x + 1 and y = -x + 4"],
  ["flashcards", "Make flashcards for the water cycle"],
  ["diagram", "Show me a diagram of the carbon cycle"],
  ["compare-poems", "Compare Remains and War Photographer"],
  ["compare-macbeth", "Compare how Macbeth is shown in Act 1 and in Act 5"],
  ["worked", "Take me through 3x - 5 = 16 step by step, one step at a time"],
  ["organiser", "Give me a knowledge organiser for forces in physics"],
  ["quiz-11plus", "Quiz me on 11+ verbal reasoning"],
];

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
const base = (extra = {}) => ({ maxTokens: config.maxOutputTokens + config.thinkingTokens, temperature: 0.3, contextSize: config.contextSize, firstTokenTimeoutMs: 90_000, firstAnswerTimeoutMs: 240_000, idleTimeoutMs: 90_000, totalTimeoutMs: 360_000, reasoning: true, think: "low", ...extra });

async function plain(ask) {
  const started = Date.now();
  let first = null;
  let text = "";
  let tokens = 0;
  try {
    for await (const chunk of provider.stream([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: ask }], base())) {
      if (chunk.type === "text") {
        first ??= Date.now() - started;
        text += chunk.text;
      } else if (chunk.type === "done") tokens = chunk.usage.completionTokens;
    }
    return { ok: text.trim().length > 0, firstMs: first, totalMs: Date.now() - started, tokens, chars: text.length };
  } catch (error) {
    return { ok: false, firstMs: first, totalMs: Date.now() - started, tokens, error: `${error.code ?? "error"} ${error.detail ?? ""}`.trim() };
  }
}

async function interactive(id, ask) {
  const plan = planInterface(ask) ?? planInterface("Show me this interactively") ?? { guidance: "Choose the interactive components that best suit what was asked." };
  const research = buildResearch(config, env).session("bench");
  const messages = [{ role: "system", content: `${SYSTEM_PROMPT}\n\n${interfacePrompt()}` }, { role: "user", content: `${ask}\n\n<interface-request>\n${plan.guidance}\n</interface-request>` }];
  let tokens = 0;
  let requests = 0;
  const started = Date.now();
  let first = null;
  try {
    const gen = runInterface({
      messages,
      generate: (prompt, options) => ((requests += 1), provider.stream(prompt, options)),
      charge: async (n) => void (tokens += n),
      activity: new ActivityLog(),
      research,
      extracts: [],
      maxRepairs: config.openui.maxRepairs,
      signal: AbortSignal.timeout(600_000),
      options: () => base(),
    });
    for (;;) {
      const next = await gen.next();
      if (!next.done) {
        if (next.value.type === "ui" && next.value.phase === "chunk") first ??= Date.now() - started;
        continue;
      }
      const o = next.value;
      if (!o.ok) return { id, ok: false, firstMs: first, totalMs: Date.now() - started, tokens, requests, repairs: o.repairs, firstDraftIssues: o.issues.length, reason: o.reason, issues: o.issues.map((i) => i.message).slice(0, 4) };
      const stored = parseStoredMessage(o.content);
      return { id, ok: true, firstMs: first, totalMs: Date.now() - started, tokens, requests, repairs: o.repairs, firstDraftIssues: o.firstDraft.length, validFirst: o.firstDraft.length === 0, components: o.components, quotes: stored.context.verifications.map((v) => v.status), program: stored.program };
    }
  } catch (error) {
    return { id, ok: false, firstMs: first, totalMs: Date.now() - started, tokens, requests, reason: "error", issues: [`${error.code ?? "error"} ${error.detail ?? error.message}`] };
  }
}

/** Draws a program in a browser and tries what it offers. Returns { drawn, tried, worked, notes }. */
async function draw(browser, program) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const b64 = Buffer.from(program, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const notes = [];
  let tried = 0;
  let worked = 0;
  try {
    await page.goto(`${render}/dev/ui-components/openui#program=${b64}`, { waitUntil: "networkidle" });
    const drawn = await page.locator('[data-interface="answer"]').first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
    const broken = await page.getByText("could not be shown").count();
    const attempt = async (label, fn) => {
      tried += 1;
      try {
        await fn();
        worked += 1;
      } catch (error) {
        notes.push(`${label}: ${String(error.message ?? error).split("\n")[0]}`);
      }
    };
    if (drawn && !broken) {
      if (await page.getByRole("button", { name: "Check answer" }).count()) {
        await attempt("quiz", async () => {
          const radio = page.getByRole("radio").first();
          if (await radio.count()) await radio.check();
          else await page.getByLabel("Your answer").fill("test");
          await page.getByRole("button", { name: "Check answer" }).click({ timeout: 3000 });
          await page.getByRole("status").filter({ hasText: /Correct!|Not quite\./ }).first().waitFor({ timeout: 3000 });
        });
      }
      if (await page.getByRole("button", { name: /Question|answer/i }).filter({ hasText: /^$/ }).count()) tried += 0;
      const card = page.locator("button[aria-pressed]").first();
      if (await card.count()) await attempt("flashcards", async () => { await card.click({ timeout: 3000 }); if ((await card.getAttribute("aria-pressed")) !== "true") throw new Error("did not flip"); });
      const slider = page.locator('input[type="range"]').first();
      if (await slider.count()) await attempt("slider", async () => { const before = await slider.inputValue(); await slider.fill(String(await slider.getAttribute("max"))); if ((await slider.inputValue()) === before) throw new Error("did not move"); });
      const steps = page.getByRole("button", { name: /Show the first step/ });
      if (await steps.count()) await attempt("steps", async () => { await steps.click({ timeout: 3000 }); await page.getByText(/1 of \d+ steps shown/).waitFor({ timeout: 3000 }); });
    }
    return { drawn: drawn && !broken && errors.length === 0, tried, worked, notes: [...notes, ...errors.slice(0, 2), ...(broken ? ["fell back to the plain version"] : [])] };
  } finally {
    await page.close();
  }
}

console.log(`${mock ? "STAND-IN (harness check only)" : "Beam"}: ${PROMPTS.length} prompts x ${runs} run(s)${render ? `, rendering at ${render}` : ""}`);
const results = [];
for (const [id, ask] of PROMPTS) {
  for (let r = 0; r < runs; r += 1) {
    const a = await plain(ask);
    const b = await interactive(id, ask);
    results.push({ id, ask, run: r + 1, plain: a, ui: b });
    console.log(`${id.padEnd(16)} text ${a.ok ? `${a.totalMs} ms ${a.tokens} tok` : `FAILED ${a.error ?? ""}`} | interface ${b.ok ? `${b.totalMs} ms ${b.tokens} tok, ${b.repairs} repair(s)` : `FAILED ${b.reason}`}`);
  }
}
if (render) {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  for (const r of results) if (r.ui.ok) r.ui.render = await draw(browser, r.ui.program);
  await browser.close();
}

/* ---- the report ----------------------------------------------------------------------------------------------------------------------------- */
const A = results.map((r) => r.plain);
const B = results.map((r) => r.ui);
const okA = A.filter((x) => x.ok);
const okB = B.filter((x) => x.ok);
const drawn = B.filter((x) => x.render);
const quoteStates = B.flatMap((x) => x.quotes ?? []);
const verified = quoteStates.filter((s) => s === "VERIFIED_EXACT" || s === "VERIFIED_VARIANT").length;
const tried = drawn.reduce((n, x) => n + x.render.tried, 0);
const worked = drawn.reduce((n, x) => n + x.render.worked, 0);
const cost = (tokens) => (priceOut === null ? null : (tokens / 1e6) * priceOut);
const gbp = (n) => (n === null ? "not estimated (no price supplied)" : `£${n.toFixed(4)}`);
const date = new Date().toISOString().slice(0, 10);

const md = `# Plain Beam against Beam-generated interfaces

${mock ? "> **STAND-IN RUN. This used the scripted mock, not Beam. It proves the harness, and says nothing about whether Beam can write valid interfaces.**\n\n" : ""}Run on ${date} with \`npm run assistant:openui-bench\`: ${PROMPTS.length} fixed prompts, ${runs} run(s) each, provider \`${config.providers[0]}\`, model \`${config.model}\`, up to ${config.openui.maxRepairs} repair(s) per interface. Educational correctness is **not** measured here: it needs a teacher, and every program is written to \`docs/benchmarks/openui-results.json\` for that.

| Measure | A. Plain Beam (Markdown) | B. Beam-generated interface |
| --- | --- | --- |
| Runs that produced something | ${okA.length} of ${A.length} (${pct(okA.length, A.length)}) | ${okB.length} of ${B.length} (${pct(okB.length, B.length)}) |
| Median time to first visible content | ${median(okA.map((x) => x.firstMs).filter((x) => x !== null)) ?? "n/a"} ms | ${median(okB.map((x) => x.firstMs).filter((x) => x !== null)) ?? "n/a"} ms |
| Median total time | ${median(okA.map((x) => x.totalMs)) ?? "n/a"} ms | ${median(okB.map((x) => x.totalMs)) ?? "n/a"} ms |
| Median output tokens | ${median(okA.map((x) => x.tokens)) ?? "n/a"} | ${median(okB.map((x) => x.tokens)) ?? "n/a"} (all requests, repairs included) |
| First draft parsed and validated | n/a | ${B.filter((x) => x.validFirst).length} of ${B.length} (${pct(B.filter((x) => x.validFirst).length, B.length)}) |
| Invalid-syntax / failed-check rate (first draft) | n/a | ${pct(B.length - B.filter((x) => x.validFirst).length, B.length)} |
| Repair requests spent | 0 | ${B.reduce((n, x) => n + (x.repairs ?? 0), 0)} across ${B.length} runs |
| A valid interface in the end | n/a | ${okB.length} of ${B.length} (${pct(okB.length, B.length)}); the rest fell back to words |
| Drawn by the browser without error | n/a | ${render ? `${drawn.filter((x) => x.render.drawn).length} of ${drawn.length} (${pct(drawn.filter((x) => x.render.drawn).length, drawn.length)})` : "not run (use --render)"} |
| Controls that worked when tried | n/a | ${render ? `${worked} of ${tried} (${pct(worked, tried)})` : "not run (use --render)"} |
| Quotations confirmed in the text | n/a | ${quoteStates.length ? `${verified} of ${quoteStates.length} (${pct(verified, quoteStates.length)})` : "no quotations in this set"} |
| Model or tool errors | ${A.length - okA.length} | ${B.filter((x) => x.reason === "error").length} |
| Estimated cost (GBP, output tokens only) | ${gbp(cost(okA.reduce((n, x) => n + x.tokens, 0)))} | ${gbp(cost(okB.reduce((n, x) => n + x.tokens, 0)))} |

The cost line uses only the price supplied on the command line. Ollama has published no rate for Beam on its API pages, and any free promotion is not a permanent zero-cost guarantee.

## Per prompt

| Prompt | Text: total / tokens | Interface: total / tokens / repairs | First draft | Final |
| --- | --- | --- | --- | --- |
${results.map((r) => `| ${r.id} | ${r.plain.ok ? `${r.plain.totalMs} ms / ${r.plain.tokens}` : `failed ${r.plain.error ?? ""}`} | ${r.ui.totalMs} ms / ${r.ui.tokens} / ${r.ui.repairs ?? 0} | ${r.ui.validFirst ? "valid" : `${r.ui.firstDraftIssues ?? "?"} problem(s)`} | ${r.ui.ok ? "interface" : `fell back (${r.ui.reason})`}${r.ui.render ? `; drew ${r.ui.render.drawn ? "yes" : "NO"}, controls ${r.ui.render.worked}/${r.ui.render.tried}` : ""} |`).join("\n")}

## When words are better than an interface

${(() => {
  const slower = results.filter((r) => r.plain.ok && r.ui.ok && r.ui.totalMs > r.plain.totalMs * 1.5).map((r) => r.id);
  const failed = results.filter((r) => !r.ui.ok).map((r) => r.id);
  return [
    `- **Speed and cost:** an interface carries a prompt of several thousand tokens and asks for structure, so it is ${okA.length && okB.length ? `${(median(okB.map((x) => x.totalMs)) / Math.max(1, median(okA.map((x) => x.totalMs)))).toFixed(1)} times the median time of the text answer here` : "slower than text where both ran"}. ${slower.length ? `It was more than 1.5 times slower for: ${slower.join(", ")}.` : ""}`,
    `- **Where it did not work:** ${failed.length ? failed.join(", ") : "every interface was built in this run"}. Those turns fell back to a text answer, as designed.`,
    "- **A plain explanation is better** for a definition, a one-off fact, a long argument, or anything the student will copy into their own work. The router never turns an ordinary question into an interface for this reason.",
    "- **An interface is better** when the student should *do* something: move a number and watch a curve, answer and be marked, flip a card, reveal working one line at a time, compare two things side by side.",
  ].join("\n");
})()}

## What this does not tell you

- Whether the interfaces are *right* (a teacher has to read \`openui-results.json\`), or whether a child learns more from them.
- Anything about a different model, a different day, or a quieter or busier service.
`;
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, md);
mkdirSync(join(dirname(outFile), "benchmarks"), { recursive: true });
writeFileSync(join(dirname(outFile), "benchmarks", "openui-results.json"), JSON.stringify({ date, mock, model: config.model, runs, results }, null, 2));
console.log(`\nWrote ${outFile}`);
