#!/usr/bin/env node
/**
 * The three-model benchmark (brief section 13): run against the models that are actually on this laptop, and record what was
 * measured, not what a publisher claims.
 *
 *   node --import tsx scripts/ollama-bench.mjs [options]
 *
 *   --models=a,b,c     default: the shortlist (qwen3.5:9b, bonsai-2:9b, bonsai-2:4b) that are installed
 *   --runs=10          warm runs per interactive case (default 10; the mean/median is meaningless below that)
 *   --photo-runs=5     warm runs for the image cases (each one is slower; still reported with its count)
 *   --hard-runs=3      thinking-enabled runs (deep reasoning is slow by design)
 *   --quick            runs=2, photo-runs=1, hard-runs=1, and no cold unload (a smoke run, not a result)
 *   --quality-only     only the exact-answer quality set (no timings, no helper roles): the model CHOICE check
 *   --no-cold          skip the cold-load measurements
 *   --out=path         where the JSON goes (default docs/benchmarks/ollama-results.json)
 *
 * Every fixture is generated here with @napi-rs/canvas: no copyrighted paper, no student work, no personal data. The output holds
 * timings, counts, model digests, backend details, VRAM and correctness flags ONLY: never an image, a prompt body or a transcript.
 *
 * Cold means the model was EVICTED first (`keep_alive: 0`, then `/api/ps` no longer lists it) and then loaded with the exact
 * options a turn uses. That is the load the previous Docker arrangement made take 215-251 s; whether it still does is the point.
 */
import { createCanvas } from "@napi-rs/canvas";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OllamaProvider } from "../src/lib/assistant/ollama.ts";
import { OllamaEmbeddingProvider, cosine } from "../src/lib/assistant/embeddings.ts";
import { SystemOneClient } from "../src/lib/assistant/decision.ts";
import { TOOL_DEFINITIONS, runTool } from "../src/lib/assistant/tools.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const QUICK = Boolean(args.quick);
const QUALITY_ONLY = Boolean(args["quality-only"]);
const RUNS = Number(args.runs ?? (QUICK ? 2 : 10));
const PHOTO_RUNS = Number(args["photo-runs"] ?? (QUICK ? 1 : 5));
const HARD_RUNS = Number(args["hard-runs"] ?? (QUICK ? 1 : 3));
const QUALITY_RUNS = Number(args["quality-runs"] ?? (QUICK ? 1 : 3));
const COLD = !args["no-cold"] && !QUICK;
const OUT = resolve(ROOT, args.out ?? "docs/benchmarks/ollama-results.json");
// A custom --out gets its OWN report name, so a partial run can never overwrite the full suite's summary.
const SUMMARY = args.out ? OUT.replace(/\.json$/i, "") + "-summary.md" : resolve(ROOT, "docs/benchmarks/ollama-summary.md");
const OLLAMA = process.env.ASSISTANT_BASE_URL?.trim() || "http://127.0.0.1:11434";
const HELPER = process.env.ASSISTANT_HELPER_BASE_URL?.trim() || "http://127.0.0.1:11435";
const CONTEXT = Number(process.env.ASSISTANT_CONTEXT ?? 4096);
const KEEP_ALIVE = process.env.ASSISTANT_KEEP_ALIVE ?? "30m";
const EMBED = process.env.ASSISTANT_EMBED_MODEL ?? "embeddinggemma-2:270m-q8_0-text";
const DECISION = process.env.ASSISTANT_DECISION_MODEL ?? "laya:421m-typed-decisions-bf16";
const SHORTLIST = ["qwen3.5:9b", "bonsai-2:9b", "bonsai-2:4b"];

const say = (text) => console.log(`[bench] ${text}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

async function get(path, base = OLLAMA, ms = 5000) {
  try {
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(ms) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
async function post(path, body, base = OLLAMA, ms = 300_000) {
  try {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    return { ok: response.ok, status: response.status, json: await response.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

// ---- GPU sampling ------------------------------------------------------------------------------------------------

let sampling = null;
function startGpu() {
  const samples = [];
  sampling = setInterval(() => {
    try {
      const out = execFileSync("nvidia-smi", ["--query-gpu=memory.used,memory.free,temperature.gpu,power.draw,utilization.gpu", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 2000 });
      const [used, free, temp, power, util] = out.trim().split(/\r?\n/)[0].split(",").map((v) => Number(v.trim()));
      if ([used, free, temp, power, util].every(Number.isFinite)) samples.push({ used, free, temp, power, util, at: Date.now() });
    } catch {
      // A machine without nvidia-smi records no GPU samples rather than inventing them.
    }
  }, 750);
  sampling.unref?.();
  return samples;
}
function stopGpu(samples) {
  if (sampling) clearInterval(sampling);
  sampling = null;
  if (!samples.length) return null;
  return {
    samples: samples.length,
    usedPeakMiB: Math.max(...samples.map((s) => s.used)),
    freeMinMiB: Math.min(...samples.map((s) => s.free)),
    tempMaxC: Math.max(...samples.map((s) => s.temp)),
    powerMaxW: Math.max(...samples.map((s) => s.power)),
    utilPeakPct: Math.max(...samples.map((s) => s.util)),
  };
}

// ---- generated fixtures (original, non-sensitive) ----------------------------------------------------------------

function board(width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fdfdf7";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "28px sans-serif";
  return { canvas, ctx };
}
function line(ctx, text, x, y, size = 28, colour = "#1a1a1a") {
  ctx.fillStyle = colour;
  ctx.font = `${size}px sans-serif`;
  ctx.fillText(text, x, y);
}
/** A worked answer to "What is 3/4 of 24?", the kind of photo the owner uploaded. */
function arithmeticPhoto() {
  const { canvas, ctx } = board(1000, 760);
  line(ctx, "Question 1", 60, 90, 34);
  line(ctx, "What is 3/4 of 24? Show your working.", 60, 150, 30);
  line(ctx, "Step 1:  24 / 4 = 6", 90, 250, 30);
  line(ctx, "Step 2:  6 x 3 = 18", 90, 320, 30);
  line(ctx, "Answer: 18", 90, 420, 32);
  line(ctx, "Step 3: check 18 / 24 = 3/4", 90, 510, 28);
  line(ctx, "Question 2", 60, 600, 32);
  line(ctx, "Simplify  x^2 / x^5", 60, 660, 28);
  return canvas.toBuffer("image/png");
}
/** A diagram with labels that must not be invented, plus a table. */
function diagramPhoto() {
  const { canvas, ctx } = board(1100, 820);
  line(ctx, "Question 3", 60, 80, 32);
  line(ctx, "Find the length marked x. The triangle is right-angled.", 60, 130, 26);
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(150, 500);
  ctx.lineTo(450, 500);
  ctx.lineTo(450, 260);
  ctx.closePath();
  ctx.stroke();
  line(ctx, "6 cm", 270, 545, 26);
  line(ctx, "8 cm", 465, 390, 26);
  line(ctx, "x", 270, 360, 26);
  line(ctx, "Table of values", 640, 260, 28);
  line(ctx, "n    1    2    3", 640, 320, 26);
  line(ctx, "T    5    9    13", 640, 370, 26);
  line(ctx, "Question 4", 60, 650, 30);
  line(ctx, "Write the rule for T in terms of n.", 60, 710, 26);
  return canvas.toBuffer("image/png");
}
/** A rotated photo whose small superscripts and roots must survive. */
function rotatedPhoto() {
  const { canvas, ctx } = board(760, 1000);
  ctx.save();
  ctx.translate(760, 0);
  ctx.rotate(Math.PI / 2);
  line(ctx, "Evaluate without a calculator", 50, 90, 30);
  line(ctx, "a)  2^5 + 3^2", 70, 180, 30);
  line(ctx, "b)  sqrt(144) - 2^3", 70, 250, 30);
  line(ctx, "c)  (2/3)^2 x 9", 70, 320, 30);
  line(ctx, "Show each step.", 70, 420, 28);
  ctx.restore();
  return canvas.toBuffer("image/png");
}
// Generated once per run, in memory: nothing is written to the repository.
const ARITHMETIC_PHOTO = arithmeticPhoto();
const DIAGRAM_PHOTO = diagramPhoto();
const ROTATED_PHOTO = rotatedPhoto();

/** A hard multi-step question, for thinking-enabled runs. */
const HARD = "A sequence has first term 3. Each term after the first is 4 more than the previous term. Prove that the sum of the first n terms is n(2n + 1). Then find the least n for which the sum exceeds 500, showing your reasoning.";

/** Exact-answer questions with an acceptance pattern. Automatic content checks, not a human mark. */
const QUALITY = [
  { id: "fraction of a number", q: "What is 3/4 of 24? Give only the number.", accept: /(^|\D)18(\D|$)/ },
  { id: "linear equation", q: "Solve 3x - 5 = 16. Give only the value of x.", accept: /(^|\D)7(\D|$)/ },
  { id: "percentage", q: "What is 15% of 240? Give only the number.", accept: /(^|\D)36(\D|$)/ },
  { id: "index laws", q: "Simplify x^2 * x^5. Give only the simplified expression.", accept: /x\s*\^?\s*7/i },
  { id: "nth term", q: "The sequence is 5, 9, 13, 17. Write its nth term. Give only the expression.", accept: /4\s*n\s*\+\s*1/ },
  { id: "factorise", q: "Factorise x^2 + 5x + 6. Give only the factorised form.", accept: /\(\s*x\s*\+\s*2\s*\)\s*\(\s*x\s*\+\s*3\s*\)|\(\s*x\s*\+\s*3\s*\)\s*\(\s*x\s*\+\s*2\s*\)/ },
];
const ARITHMETIC_ASK = "Read the photo and answer Question 1, showing the working.";
const DIAGRAM_ASK = "Read the photo. For Question 3, write only the value of x and say which theorem you used. Do not invent labels that are not in the diagram.";
const ROTATED_ASK = "Read the rotated photo and answer parts a, b and c, showing one line of working each.";
const FOLLOW_UP = "Now check the working in Step 2 of that photo and say whether it is correct.";

// ---- statistics --------------------------------------------------------------------------------------------------

function summary(values) {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const at = (p) => clean[Math.min(clean.length - 1, Math.max(0, Math.round((clean.length - 1) * p)))];
  return {
    count: clean.length,
    min: Math.round(clean[0] * 10) / 10,
    median: Math.round(at(0.5) * 10) / 10,
    p90: Math.round(at(0.9) * 10) / 10,
    max: Math.round(clean.at(-1) * 10) / 10,
    mean: Math.round((clean.reduce((a, b) => a + b, 0) / clean.length) * 10) / 10,
  };
}

async function runStream(provider, messages, options) {
  const started = now();
  const out = { firstActivityMs: null, firstAnswerMs: null, totalMs: null, text: "", activities: [], toolCalls: [], metrics: null, error: null, usage: null };
  try {
    for await (const chunk of provider.stream(messages, options)) {
      if (chunk.type === "activity") {
        out.activities.push(chunk.kind);
        if (out.firstActivityMs === null) out.firstActivityMs = now() - started;
      } else if (chunk.type === "tool_call") out.toolCalls.push(chunk.call);
      else if (chunk.type === "text") {
        if (out.firstActivityMs === null) out.firstActivityMs = now() - started;
        if (out.firstAnswerMs === null) out.firstAnswerMs = now() - started;
        out.text += chunk.text;
      } else {
        out.totalMs = now() - started;
        out.metrics = chunk.metrics ?? null;
        out.usage = chunk.usage;
      }
    }
  } catch (error) {
    out.error = error?.code ?? "error";
    out.totalMs = now() - started;
  }
  return out;
}

const OPTIONS = (over = {}) => ({ maxTokens: 320, temperature: 0.3, contextSize: CONTEXT, keepAlive: KEEP_ALIVE, firstTokenTimeoutMs: 120_000, firstAnswerTimeoutMs: 120_000, totalTimeoutMs: 300_000, ...over });
const textCase = (over = {}) => OPTIONS({ maxTokens: 220, ...over });

async function unload(model) {
  await post("/api/generate", { model, keep_alive: 0, prompt: "", stream: false }, OLLAMA, 10_000);
  for (let i = 0; i < 40; i += 1) {
    const ps = await get("/api/ps", OLLAMA, 3000);
    if (!ps || !(ps.models ?? []).some((m) => m.name === model || m.model === model)) return true;
    await sleep(250);
  }
  return false;
}

// ---- one model ---------------------------------------------------------------------------------------------------

async function caseRuns(provider, name, makeMessages, runs, over = {}) {
  const records = [];
  const gpu = startGpu();
  for (let i = 0; i < runs; i += 1) {
    const result = await runStream(provider, makeMessages(i), textCase(over));
    records.push(result);
    if (result.error) say(`   ${name} ${i + 1}/${runs}: ${result.error}`);
  }
  const gpuStats = stopGpu(gpu);
  const ok = records.filter((r) => !r.error);
  return {
    case: name,
    runs,
    errors: records.filter((r) => r.error).length,
    errorCodes: [...new Set(records.filter((r) => r.error).map((r) => r.error))],
    firstActivityMs: summary(ok.map((r) => r.firstActivityMs)),
    firstAnswerMs: summary(ok.map((r) => r.firstAnswerMs)),
    totalMs: summary(ok.map((r) => r.totalMs)),
    tokensPerSecond: summary(ok.map((r) => r.metrics?.tokensPerSecond).filter((v) => v !== null && v !== undefined)),
    promptEvalMs: summary(ok.map((r) => r.metrics?.promptEvalMs).filter((v) => v !== null && v !== undefined)),
    loadMs: summary(ok.map((r) => r.metrics?.loadMs).filter((v) => v !== null && v !== undefined && v > 0)),
    gpu: gpuStats,
    sampleAnswer: ok[0]?.text?.slice(0, 160) ?? null,
  };
}

/** The exact-answer set: short enough to mark automatically, and checked by content, not by speed. */
async function measureQuality(provider) {
  const messages = (content) => [{ role: "system", content: "You are a GCSE tutor. Answer with the final answer only, as short as possible." }, { role: "user", content }];
  const quality = [];
  for (const item of QUALITY) {
    let correct = 0;
    const samples = [];
    for (let i = 0; i < QUALITY_RUNS; i += 1) {
      const run = await runStream(provider, messages(item.q), textCase({ maxTokens: 260 }));
      const hit = !run.error && item.accept.test(run.text);
      if (hit) correct += 1;
      if (i === 0) samples.push({ error: run.error, excerpt: run.text.replace(/\s+/g, " ").slice(0, 120) });
    }
    quality.push({ question: item.id, runs: QUALITY_RUNS, correct, samples });
  }
  return quality;
}

async function benchmarkModel(model, details) {
  const provider = new OllamaProvider({ baseUrl: OLLAMA, model, visionModel: model, contextSize: CONTEXT, keepAlive: KEEP_ALIVE });
  const caps = await provider.capabilities(model);
  const health = await provider.health();
  const result = { model, digest: details?.digest ?? null, sizeBytes: details?.size ?? null, quantisation: details?.details?.quantization_level ?? null, capabilities: caps, health, context: CONTEXT, cases: [], cold: null };
  say(`${model}: ${caps.vision ? "vision" : "no vision"}, ${caps.toolUse ? "tools" : "no tools"}, thinking ${String(caps.thinking)}`);

  if (QUALITY_ONLY) {
    const quality = await measureQuality(provider);
    result.quality = quality;
    result.qualityCorrect = quality.reduce((sum, q) => sum + q.correct, 0);
    result.qualityTotal = quality.reduce((sum, q) => sum + q.runs, 0);
    say(`${model}: quality ${result.qualityCorrect}/${result.qualityTotal}`);
    return result;
  }

  if (COLD) {
    const evicted = await unload(model);
    const started = now();
    const warmed = await provider.warm({ model, contextSize: CONTEXT, keepAlive: KEEP_ALIVE });
    const wall = now() - started;
    const ps = await get("/api/ps", OLLAMA, 5000);
    const loaded = (ps?.models ?? []).find((m) => m.name === model || m.model === model) ?? null;
    result.cold = { evicted, warm: warmed, wallMs: Math.round(wall), sizeVramBytes: loaded?.size_vram ?? null, contextLoaded: loaded?.context_length ?? null, count: 1 };
    say(`   cold load: ${warmed.ok ? `${wall.toFixed(0)} ms wall` : `failed (${warmed.detail})`}`);
  }
  const warmStart = now();
  const warmed = await provider.warm({ model, contextSize: CONTEXT, keepAlive: KEEP_ALIVE });
  result.warmUp = { ok: warmed.ok, loadMs: warmed.loadMs, detail: warmed.detail, wallMs: Math.round(now() - warmStart) };

  const msgs = (content, images) => [{ role: "system", content: "You are a GCSE tutor. Answer in at most six short sentences. Show working where asked." }, { role: "user", content, ...(images ? { images } : {}) }];

  result.cases.push(await caseRuns(provider, "warm text: a short explanation", () => msgs("Explain in two sentences why 3/4 of 24 is 18."), RUNS));
  result.cases.push(await caseRuns(provider, "warm text: solve 2x + 7 = 19", () => msgs("Solve 2x + 7 = 19. Show each step and state the answer."), RUNS));
  result.cases.push(await caseRuns(provider, "photo: worked arithmetic answer", (i) => msgs(`${ARITHMETIC_ASK} (attempt ${i + 1})`, [ARITHMETIC_PHOTO.toString("base64")]), PHOTO_RUNS));
  result.cases.push(await caseRuns(provider, "photo: diagram and table", (i) => msgs(`${DIAGRAM_ASK} (attempt ${i + 1})`, [DIAGRAM_PHOTO.toString("base64")]), PHOTO_RUNS));
  result.cases.push(await caseRuns(provider, "photo: rotated, superscripts and roots", () => msgs(ROTATED_ASK, [ROTATED_PHOTO.toString("base64")]), PHOTO_RUNS));
  result.cases.push(await caseRuns(provider, "photo follow-up: check step 2", () => msgs(FOLLOW_UP, [ARITHMETIC_PHOTO.toString("base64")]), PHOTO_RUNS));
  // Mirrors the app after the fix: the answer's 700 tokens PLUS the thinking allowance (ASSISTANT_THINKING_TOKENS). Before that
  // change, 700 tokens of thinking left no room for an answer at all.
  result.cases.push(
    await caseRuns(provider, "thinking: hard multi-step proof", () => msgs(HARD), HARD_RUNS, { reasoning: true, maxTokens: 700 + 600, totalTimeoutMs: 600_000, firstAnswerTimeoutMs: 300_000 }),
  );

  const quality = await measureQuality(provider);
  result.quality = quality;
  result.qualityCorrect = quality.reduce((sum, q) => sum + q.correct, 0);
  result.qualityTotal = quality.reduce((sum, q) => sum + q.runs, 0);

  // A real allowed tool call: offer the tools, run whatever the model asks for through the SAME executor the chat uses, then
  // continue the conversation with the result. One round, exactly as the service bounds it.
  const toolRuns = [];
  for (let i = 0; i < Math.max(1, Math.min(3, RUNS)); i += 1) {
    const messages = msgs("Use the check_calculation tool to verify that 3/4 of 24 is 18, then answer with one sentence.");
    const first = await runStream(provider, messages, OPTIONS({ maxTokens: 160, tools: TOOL_DEFINITIONS }));
    let round = null;
    if (first.toolCalls.length) {
      const call = first.toolCalls[0];
      const outcome = await runTool(call.name, call.arguments, { store: {}, owner: { clientId: "bench", studentId: null }, sessionId: "bench", fileNames: new Map(), search: async () => [] });
      const second = await runStream(
        provider,
        [...messages, { role: "assistant", content: "", toolCalls: [call] }, { role: "tool", toolName: call.name, content: outcome.content }],
        OPTIONS({ maxTokens: 160 }),
      );
      round = { name: call.name, argumentsValid: outcome.ok, resultClass: outcome.ok ? "ok" : outcome.code, answered: Boolean(second.text), firstAnswerMs: second.firstAnswerMs };
    }
    toolRuns.push({ requested: first.toolCalls.length, error: first.error, round });
  }
  result.cases.push({ case: "tool: a real allowed call (check_calculation)", runs: toolRuns.length, toolRequests: toolRuns.filter((r) => r.requested).length, completed: toolRuns.filter((r) => r.round?.answered).length, details: toolRuns });
  // An adversarial tool name: the executor must refuse it, and the model must still answer.
  const refused = await runTool("run_shell", { command: "del /s /q D:\\" }, { store: {}, owner: { clientId: "bench", studentId: null }, sessionId: "bench", fileNames: new Map(), search: async () => [] });
  result.cases.push({ case: "tool: a disallowed call is refused", runs: 1, refused: refused.code === "unknown_tool", code: refused.code });

  // Cancellation: a long answer stopped after the first visible token.
  const controller = new AbortController();
  let cancelled = null;
  try {
    const started = now();
    let first = null;
    for await (const chunk of provider.stream(msgs("Write a long, detailed revision plan for algebra."), OPTIONS({ maxTokens: 600, signal: controller.signal, totalTimeoutMs: 120_000 }))) {
      if (chunk.type === "text" && first === null) {
        first = now() - started;
        controller.abort();
      }
    }
    cancelled = { stopped: false, firstTokenMs: first };
  } catch (error) {
    cancelled = { stopped: error?.code === "aborted", code: error?.code ?? "error" };
  }
  result.cases.push({ case: "cancel: stop after the first token", runs: 1, ...cancelled });

  // Two at once: the second waits for the slot (one GPU, one answer) and its wait is measured, not hidden.
  const both = await Promise.all([
    runStream(provider, msgs("What is 15% of 240? One sentence."), OPTIONS({ maxTokens: 80 })),
    (async () => {
      await sleep(50);
      return runStream(provider, msgs("What is 20% of 350? One sentence."), OPTIONS({ maxTokens: 80 }));
    })(),
  ]);
  result.cases.push({ case: "two requests at once", runs: 2, first: { firstAnswerMs: both[0].firstAnswerMs, error: both[0].error }, second: { firstAnswerMs: both[1].firstAnswerMs, error: both[1].error } });

  // A missing model and an unreachable helper are honest failures, never a fabricated answer.
  const missing = new OllamaProvider({ baseUrl: OLLAMA, model: "learnthrive-does-not-exist:1b", contextSize: CONTEXT });
  const missingRun = await runStream(missing, msgs("hello"), OPTIONS({ maxTokens: 10, firstTokenTimeoutMs: 8000, firstAnswerTimeoutMs: 8000, totalTimeoutMs: 10_000 }));
  result.cases.push({ case: "missing model", runs: 1, code: missingRun.error, timeout: missingRun.error === "timeout" });
  const deadHelper = new OllamaEmbeddingProvider({ model: EMBED, baseUrl: "http://127.0.0.1:11439", keepAlive: "1m", batch: 4 });
  const dead = await deadHelper.embed(["x"]).then(() => null).catch((e) => e.code);
  result.cases.push({ case: "embedding helper unreachable", runs: 1, code: dead });

  return result;
}

// ---- the helper roles --------------------------------------------------------------------------------------------

const CORPUS = [
  { id: "fractions", text: "A fraction has a numerator on top and a denominator below. To find three quarters of 24, divide by 4 then multiply by 3." },
  { id: "quadratics", text: "The quadratic formula is x = (-b +/- sqrt(b^2 - 4ac)) / 2a. It solves ax^2 + bx + c = 0." },
  { id: "pythagoras", text: "Pythagoras' theorem: in a right-angled triangle the square of the hypotenuse equals the sum of the squares of the other two sides." },
  { id: "sequences", text: "An arithmetic sequence adds a constant difference each time. Its nth term is a + (n - 1)d." },
  { id: "percentages", text: "To find 15 percent of 240, multiply 240 by 0.15, which is 36." },
  { id: "indices", text: "To multiply powers with the same base, add the indices. To divide them, subtract the indices." },
  { id: "simultaneous", text: "Simultaneous equations can be solved by elimination: make one coefficient match, then add or subtract the equations." },
  { id: "area", text: "The area of a triangle is half the base times the perpendicular height." },
];
const QUERIES = [
  { q: "How do I find three quarters of a number?", want: "fractions" },
  { q: "Which formula solves a quadratic equation?", want: "quadratics" },
  { q: "How do I find the hypotenuse of a right angled triangle?", want: "pythagoras" },
  { q: "What is the rule for the nth term of an arithmetic sequence?", want: "sequences" },
  { q: "What is 15 percent of 240?", want: "percentages" },
  { q: "How do I simplify x squared times x cubed?", want: "indices" },
];

async function benchmarkRetrieval() {
  const provider = new OllamaEmbeddingProvider({ model: EMBED, baseUrl: HELPER, keepAlive: "10m", batch: 8 });
  const started = now();
  let docs;
  try {
    docs = await provider.embed(CORPUS.map((c) => c.text), { kind: "document", title: "revision notes" });
  } catch (error) {
    return { ok: false, error: error.code ?? "error", model: EMBED, baseUrl: HELPER };
  }
  const indexMs = now() - started;
  const hits = [];
  const latencies = [];
  for (const query of QUERIES) {
    const q0 = now();
    const [vector] = await provider.embed([query.q], { kind: "query" });
    latencies.push(now() - q0);
    const ranked = CORPUS.map((c, i) => ({ id: c.id, score: cosine(vector, docs[i]) })).filter((r) => r.score !== null).sort((a, b) => b.score - a.score);
    hits.push({ want: query.want, top: ranked.slice(0, 4).map((r) => r.id), hitAt1: ranked[0]?.id === query.want, hitAt4: ranked.slice(0, 4).some((r) => r.id === query.want), topScore: Math.round((ranked[0]?.score ?? 0) * 1000) / 1000 });
  }
  return {
    ok: true,
    model: EMBED,
    dimension: provider.dimension,
    documents: CORPUS.length,
    queries: QUERIES.length,
    indexMs: Math.round(indexMs),
    queryMs: summary(latencies),
    hitAt1: hits.filter((h) => h.hitAt1).length,
    hitAt4: hits.filter((h) => h.hitAt4).length,
    cases: hits,
  };
}

const ROUTING = [
  { text: "hello", want: "general_chat" },
  { text: "What is a prime number?", want: "general_chat" },
  { text: "Can you explain question 4b of my paper?", want: "explain_question" },
  { text: "I am stuck on part (c) of this question", want: "explain_question" },
  { text: "Please find the notes on fractions in my uploads", want: "search_material" },
  { text: "Look through my notes for the quadratic formula", want: "search_material" },
  { text: "Can you work through the whole paper for me?", want: "solve_paper" },
  { text: "Please solve all of the questions on this paper", want: "solve_paper" },
  { text: "How do I get better at maths?", want: "general_chat" },
  { text: "This thing here, what about it?", want: "clarify" },
  { text: "Where do I start with the homework?", want: "clarify" },
  { text: "Check my answer to question 3 please", want: "explain_question" },
];

async function benchmarkRouting() {
  const client = new SystemOneClient({
    enabled: true,
    model: DECISION,
    baseUrl: HELPER,
    keepAlive: "10m",
    timeoutMs: 5000,
    minConfidence: Number(process.env.ASSISTANT_DECISION_MIN_CONFIDENCE ?? 0.3),
    minMargin: Number(process.env.ASSISTANT_DECISION_MIN_MARGIN ?? 0.12),
  });
  const health = await client.health();
  if (!health.ok) return { ok: false, ...health, model: DECISION, baseUrl: HELPER };
  const results = [];
  const latencies = [];
  for (const item of ROUTING) {
    const started = now();
    const route = await client.route(item.text);
    latencies.push(now() - started);
    results.push({ want: item.want, got: route?.intent ?? null, confidence: route?.confidence ?? null, abstained: route === null });
  }
  const answered = results.filter((r) => !r.abstained);
  return {
    ok: true,
    model: DECISION,
    cases: ROUTING.length,
    answered: answered.length,
    abstained: results.length - answered.length,
    correct: answered.filter((r) => r.got === r.want).length,
    latencyMs: summary(latencies),
    details: results,
  };
}

// ---- main -------------------------------------------------------------------------------------------------------

const tags = await get("/api/tags");
if (!tags) {
  console.error(`[bench] no Ollama server answers on ${OLLAMA}. Start it: node scripts/ollama-local.mjs start`);
  process.exit(1);
}
const installed = new Map((tags.models ?? []).map((m) => [m.name, m]));
const asked = String(args.models ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const models = (asked.length ? asked : SHORTLIST).filter((m) => installed.has(m) || installed.has(`${m}:latest`));
say(`installed: ${[...installed.keys()].join(", ")}`);
say(
  QUALITY_ONLY
    ? `quality-checking: ${models.join(", ") || "(none)"}; ${QUALITY_RUNS} run(s) per question`
    : `benchmarking: ${models.join(", ") || "(none)"}; runs ${RUNS} warm / ${PHOTO_RUNS} photo / ${HARD_RUNS} hard; context ${CONTEXT}`,
);
const startedAt = new Date();
const machine = {
  platform: `${process.platform} ${process.arch}`,
  cpus: (await import("node:os")).cpus().length,
  cpu: (await import("node:os")).cpus()[0]?.model ?? "unknown",
  memoryGiB: Math.round((await import("node:os")).totalmem() / 1024 ** 3),
};
let gpuInfo = null;
try {
  gpuInfo = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"], { encoding: "utf8" }).trim();
} catch {
  gpuInfo = null;
}
const results = { startedAt: startedAt.toISOString(), finishedAt: null, machine: { ...machine, gpu: gpuInfo }, ollama: { main: OLLAMA, helper: HELPER, context: CONTEXT, keepAlive: KEEP_ALIVE }, runs: { warm: RUNS, photo: PHOTO_RUNS, hard: HARD_RUNS }, models: [], retrieval: null, routing: null, notes: [] };
for (const model of models) {
  const entry = installed.get(model) ?? installed.get(`${model}:latest`);
  try {
    results.models.push(await benchmarkModel(model, entry));
  } catch (error) {
    results.models.push({ model, error: String(error?.message ?? error) });
  }
}
if (!QUALITY_ONLY) {
  results.retrieval = await benchmarkRetrieval();
  results.routing = await benchmarkRouting();
} else {
  results.notes.push("quality-only run: no timings, no helper roles");
}
const ps = await get("/api/ps");
results.residentAtEnd = (ps?.models ?? []).map((m) => ({ name: m.name, sizeVramMiB: m.size_vram ? Math.round(m.size_vram / 1048576) : null, context: m.context_length ?? null }));
results.finishedAt = new Date().toISOString();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
say(`wrote ${OUT}`);

const md = [];
md.push(`# Ollama three-model benchmark: measured numbers\n`);
md.push(`Run ${results.startedAt} to ${results.finishedAt}.`);
md.push(`Machine: ${results.machine.cpu}, ${results.machine.cpus} CPUs, ${results.machine.memoryGiB} GiB RAM; GPU ${String(results.machine.gpu).replace(/\r?\n/g, "; ")}.`);
md.push(
  QUALITY_ONLY
    ? `Quality-only run: the exact-answer set, ${QUALITY_RUNS} run(s) per question; no timings and no helper roles.\n`
    : `Context ${CONTEXT}, keep_alive ${KEEP_ALIVE}. Warm runs per interactive case: ${RUNS} text, ${PHOTO_RUNS} photo, ${HARD_RUNS} thinking. Percentiles from small samples are estimates and are labelled with their count.\n`,
);
for (const model of results.models) {
  if (model.error) {
    md.push(`## ${model.model}: FAILED (${model.error})\n`);
    continue;
  }
  md.push(`## ${model.model}\n`);
  md.push(`Digest \`${model.digest}\`, ${(model.sizeBytes / 1024 ** 3).toFixed(2)} GiB, ${model.quantisation}, context requested ${model.context}. Capabilities: ${Object.entries(model.capabilities).filter(([k]) => ["vision", "toolUse", "thinking"].includes(k)).map(([k, v]) => `${k}=${v}`).join(", ")}.`);
  if (model.cold) md.push(`\nCold load (evicted first, count ${model.cold.count}): ${model.cold.warm.ok ? `${model.cold.wallMs} ms wall, server load ${model.cold.warm.loadMs ?? "n/a"} ms` : `failed (${model.cold.warm.detail})`}. VRAM at load ${model.cold.sizeVramBytes ? `${Math.round(model.cold.sizeVramBytes / 1048576)} MiB` : "not reported"}.`);
  if (model.quality) md.push(`\nExact-answer quality set: ${model.qualityCorrect}/${model.qualityTotal} (${QUALITY_RUNS} run(s) per question; automatic content check).\n`);
  for (const q of model.quality ?? []) md.push(`- ${q.question}: ${q.correct}/${q.runs}${q.samples?.[0]?.error ? ` (error ${q.samples[0].error})` : ""}`);
  if (QUALITY_ONLY) {
    md.push("");
    continue;
  }
  md.push(`\n| Case | n | errors | first answer ms (median / p90 / max) | total ms (median) | tok/s (median) | VRAM used peak / free min MiB |`);
  md.push(`| --- | --- | --- | --- | --- | --- | --- |`);
  for (const c of model.cases) {
    if (c.firstAnswerMs === undefined && c.totalMs === undefined) {
      md.push(`| ${c.case} | ${c.runs ?? 1} | ${c.errors ?? 0} | ${c.toolRequests !== undefined ? `${c.toolRequests} tool request(s), ${c.completed} completed` : c.code ?? c.refused ?? "see JSON"} | | | |`);
      continue;
    }
    md.push(
      `| ${c.case} | ${c.runs} | ${c.errors} | ${c.firstAnswerMs ? `${c.firstAnswerMs.median} / ${c.firstAnswerMs.p90} / ${c.firstAnswerMs.max}` : "-"} | ${c.totalMs?.median ?? "-"} | ${c.tokensPerSecond?.median ?? "-"} | ${c.gpu ? `${c.gpu.usedPeakMiB} / ${c.gpu.freeMinMiB}` : "-"} |`,
    );
  }
  md.push("");
}
if (QUALITY_ONLY) md.push(`## Embeddings and typed decisions\n\nNot measured in a quality-only run (\`--quality-only\`).\n`);
else if (results.retrieval?.ok) md.push(`## Embeddings and retrieval\n\nModel \`${results.retrieval.model}\`, dimension ${results.retrieval.dimension}. Indexed ${results.retrieval.documents} chunks in ${results.retrieval.indexMs} ms; query embedding median ${results.retrieval.queryMs?.median} ms (n=${results.retrieval.queryMs?.count}). Retrieval hit@1 ${results.retrieval.hitAt1}/${results.retrieval.queries}, hit@4 ${results.retrieval.hitAt4}/${results.retrieval.queries}.\n`);
else md.push(`## Embeddings and retrieval\n\nNOT MEASURED: ${JSON.stringify(results.retrieval)}\n`);
if (!QUALITY_ONLY) {
  if (results.routing?.ok) md.push(`## Typed decisions\n\nModel \`${results.routing.model}\`: ${results.routing.correct}/${results.routing.answered} answered correctly (${results.routing.abstained} abstained of ${results.routing.cases}); latency median ${results.routing.latencyMs?.median} ms.\n`);
  else md.push(`## Typed decisions\n\nNOT MEASURED: ${JSON.stringify(results.routing)}\n`);
}
writeFileSync(SUMMARY, `${md.join("\n")}\n`);
say(`wrote ${SUMMARY}`);
