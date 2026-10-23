#!/usr/bin/env node
/**
 * The Paper Tutor's fixes, proved with the REAL local model (not the mock), through the real job pipeline: the reader, the question tree, the
 * solver and its completion checks, the context link between uploads, and the three output modes.
 *
 *   node --import tsx scripts/paper-live-check.mjs --paper "<a screenshot of 3(a)>.png" [--out <folder>] [--part-b "<screenshot of 3(b)>.png"]
 *
 * Needs the native Ollama running (`npm run ollama:local -- start`). Writes the three PDFs (one per mode) and the (b) PDF to --out, and a sanitised
 * report (counts, statuses, figures: no image, no transcript) to docs/benchmarks/paper-live.json. Exits non-zero if the owner's requirements fail:
 *
 *   one selectable task, 3(a), four marks
 *   floor area 68 m², paint 7.5 litres, coverage 75 m², an explicit "Yes, because 75 m² exceeds 68 m²"
 *   a later upload of 3(b) is linked to the earlier one: coverage 7.5 x 11 = 82.5 m², and she STILL has enough paint, with a reason
 *
 * The expected figures live here, in the checker, never in the solver's prompt or code.
 */
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assistantConfig } from "../src/lib/assistant/config.ts";
import { OllamaProvider } from "../src/lib/assistant/ollama.ts";
import { GenerationQueue } from "../src/lib/assistant/queue.ts";
import { PaperJobs } from "../src/lib/paper/jobs.ts";
import { paperLimits } from "../src/lib/paper/limits.ts";
import { MemoryLibraryStorage } from "../src/lib/library/storage.ts";
import { InMemoryLibraryStore } from "../../../packages/data/src/library/memory.ts";

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1];
if (!args.paper) throw new Error('give --paper "<screenshot of question 3(a)>.png"');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = resolve(args.out ?? resolve(REPO, ".paper-live"));
mkdirSync(OUT, { recursive: true });
const say = (t) => console.log(`[paper-live] ${t}`);
const own = (clientId) => ({ clientId, studentId: null });

const config = assistantConfig({ ...process.env, ASSISTANT_PROVIDER: "ollama" });
const limits = paperLimits(process.env);
const provider = new OllamaProvider({ baseUrl: config.baseUrl ?? "http://127.0.0.1:11434", model: config.model, visionModel: config.visionModel ?? undefined, contextSize: limits.context, keepAlive: config.keepAlive });
const store = new InMemoryLibraryStore();
const client = await store.accounts.ensureClient(store.seedProfile({ email: "paper-live@example.invalid" }));
const uploads = new MemoryLibraryStorage();
const deps = { store, uploads, solve: { provider, queue: new GenerationQueue(1, 4), model: config.model, visionModel: config.visionModel ?? config.model, contextSize: limits.context, maxTokens: limits.maxTokens, reasoningTokens: limits.reasoningTokens, crossCheck: limits.crossCheck, trace: args.verbose !== undefined ? (e) => say(`    attempt ${e.kind}: ${e.status}; issues [${e.issues.join(",")}]; answer ${e.answer}; comparison ${e.comparison ?? "-"}${e.notes.length ? `; ${e.notes.join(",")}` : ""}`) : undefined } };
const jobs = new PaperJobs();
const now = () => new Date();

const wait = async (id, states, ms = 900_000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const job = await jobs.get(deps, own(client), id);
    if (states.includes(job?.state)) return job;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`job ${id} never reached ${states}`);
};

async function put(sessionId, name, bytes, contentType) {
  await uploads.put(`${sessionId}/${name}`, bytes, contentType);
  return store.chat.addFile(own(client), sessionId, { storagePath: `${sessionId}/${name}`, bytes: bytes.length, contentType }, now());
}

async function run(sessionId, file, mode, label) {
  const started = await jobs.start(deps, { owner: own(client), sessionId, fileId: file.id });
  if (!started.ok) throw new Error(`could not start: ${started.code}`);
  const ready = await wait(started.job.id, ["ready", "failed"]);
  if (ready.state !== "ready") throw new Error(`${label}: ${ready.message}`);
  const t = Date.now();
  await jobs.solve(deps, own(client), ready.id, { mode });
  const done = await wait(ready.id, ["done", "failed"]);
  const pdf = done.resultFileId ? await uploads.read((await store.chat.getFile(own(client), done.resultFileId)).storagePath) : null;
  if (pdf) writeFileSync(resolve(OUT, `${label}.pdf`), pdf);
  const saved = await store.papers.get(own(client), ready.id);
  const evidence = Object.values(saved.checkpoints).flatMap((c) => c.evidence ?? []);
  return { ready, done, ms: Date.now() - t, evidence };
}

const text = (done) => done.results.map((r) => `${r.answer} ${r.note} ${r.steps.map((s) => `${s.say ?? ""} ${s.math ?? ""}`).join(" ")}`).join(" ");
const report = { checkedAt: new Date().toISOString(), model: config.model, context: limits.context, modes: {}, partB: null, checks: {} };
const bytesA = new Uint8Array(readFileSync(resolve(args.paper)));

const sessionHybrid = (await store.chat.createSession(own(client), {}, now())).id;
for (const mode of args.modes ? args.modes.split(",") : ["filled", "hybrid", "worked"]) {
  const session = mode === "hybrid" ? sessionHybrid : (await store.chat.createSession(own(client), {}, now())).id;
  const file = await put(session, `a-${mode}.png`, bytesA, "image/png");
  say(`3(a), mode ${mode}…`);
  const { ready, done, ms, evidence } = await run(session, file, mode, `q3a-${mode}`);
  if (args.verbose !== undefined) say(`  evidence: ${evidence.join(",") || "-"} | note: ${done.results[0]?.note.slice(0, 200)}`);
  const r = done.results[0];
  report.modes[mode] = { tasks: ready.questions.map((q) => ({ number: q.number, marks: q.marks })), state: done.state, status: r?.status, answer: r?.answer, steps: r?.steps.length, pages: done.pageCount, workedPages: done.workedPages, ms };
  say(`  ${mode}: tasks ${JSON.stringify(report.modes[mode].tasks)}, status ${r?.status}, answer ${r?.answer}, ${ms} ms`);
}

if (args.modes) {
  say("partial run (--modes): no report written");
  process.exit(0);
}
const a = report.modes.hybrid;
const hybrid = await wait((await store.papers.listForSession(own(client), sessionHybrid))[0].id, ["done"]);
const aText = text(hybrid);
report.checks.oneTaskThreeA = Object.values(report.modes).every((m) => m.tasks.length === 1 && m.tasks[0].number === "3(a)");
report.checks.fourMarks = Object.values(report.modes).every((m) => m.tasks[0].marks === 4);
report.checks.area68 = /\b68\b/.test(aText);
report.checks.paint75 = /\b7\.5\b/.test(aText);
report.checks.coverage75 = /\b75\b/.test(aText);
report.checks.conclusionYes = /^\s*yes/i.test(hybrid.results[0].answer) && /yes,?\s*because/i.test(hybrid.results[0].note) && /75/.test(hybrid.results[0].note) && /68/.test(hybrid.results[0].note);
report.checks.notContradictory = hybrid.results[0].status !== "partial" && hybrid.results[0].status !== "failed";

// 3(b): a picture of the part only, in the same chat as the hybrid run of (a).
const partBBytes = args["part-b"] ? new Uint8Array(readFileSync(resolve(args["part-b"]))) : (() => {
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
  return new Uint8Array(canvas.toBuffer("image/png"));
})();
const fileB = await put(sessionHybrid, "b.png", partBBytes, "image/png");
say("3(b) in the same chat…");
const b = await run(sessionHybrid, fileB, "worked", "q3b");
const rb = b.done.results[0];
const bText = text(b.done);
report.partB = { tasks: b.ready.questions.map((q) => ({ number: q.number, marks: q.marks, contextState: q.contextState })), notice: b.ready.message, status: rb?.status, answer: rb?.answer, steps: rb?.steps.length, ms: b.ms };
report.checks.partBLinked = b.ready.questions[0]?.contextState === "linked";
report.checks.partB825 = /82\.5/.test(bText);
// "Does this change your answer to (a)?": No, it does not change (or Yes, she still has enough), and the reason says she still has enough.
report.checks.partBStillEnough = /^\s*(yes|no)/i.test(rb?.answer ?? "") && /(still|not change|does not|doesn't|no change)/i.test(rb?.note ?? "") && /enough|more than|exceeds|greater/i.test(rb?.note ?? "");
report.checks.partBReason = /82\.5/.test(rb?.note ?? "") && /68/.test(rb?.note ?? "");
say(`  (b): ${JSON.stringify(report.partB.tasks)}, status ${rb?.status}, answer ${rb?.answer}`);
if (args.verbose !== undefined) say(`  (b) note: ${rb?.note} | steps: ${rb?.steps.map((s) => s.math ?? s.say).join(" ; ")}`);

report.passed = Object.values(report.checks).every(Boolean);
mkdirSync(resolve(REPO, "docs", "benchmarks"), { recursive: true });
writeFileSync(resolve(REPO, "docs", "benchmarks", "paper-live.json"), `${JSON.stringify(report, null, 2)}\n`);
say(JSON.stringify(report.checks));
say(`${report.passed ? "PASSED" : "FAILED"}; PDFs in ${OUT}`);
if (!report.passed) process.exitCode = 1;
void a;
