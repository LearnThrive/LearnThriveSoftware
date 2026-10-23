#!/usr/bin/env node
/**
 * The measurements the benchmark leaves out (docs/OLLAMA_BENCHMARK.md, "What was not measured"), through the REAL service:
 *
 *   A. idle expiry: the tutor loaded with a short keep_alive disappears, and the next turn pays (and reports) a reload
 *   B. helpers beside the tutor: an embedding and a decision call neither evict the tutor nor take VRAM
 *   C. a PDF follow-up ("explain question 4(b)"): the second turn must not re-read or re-send the pages
 *   D. two students at once, one of them while the first file is being indexed: the second waits, nobody errors
 *   E. backend restart: a turn while the server is down reports an honest error; after a restart the next turn works
 *
 *   node --import tsx scripts/ollama-lifecycle-check.mjs [--model=bonsai-2:9b] [--out=path.json] [--skip-restart]
 *
 * Prints and writes timings, counts and booleans only: no image, no PDF text, no transcript.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { assistantConfig } from "../src/lib/assistant/config.ts";
import { sendMessage } from "../src/lib/assistant/service.ts";
import { OllamaProvider } from "../src/lib/assistant/ollama.ts";
import { GenerationQueue } from "../src/lib/assistant/queue.ts";
import { OllamaEmbeddingProvider } from "../src/lib/assistant/embeddings.ts";
import { SystemOneClient } from "../src/lib/assistant/decision.ts";
import { inspectChatUpload } from "../src/lib/assistant/uploads.ts";
import { MemoryLibraryStorage } from "../src/lib/library/storage.ts";
import { InMemoryLibraryStore } from "../../../packages/data/src/library/memory.ts";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const MODEL = args.model ?? process.env.ASSISTANT_MODEL ?? "bonsai-2:9b";
const BASE = process.env.ASSISTANT_BASE_URL ?? "http://127.0.0.1:11434";
const HELPER = process.env.ASSISTANT_HELPER_BASE_URL ?? "http://127.0.0.1:11435";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = resolve(REPO, args.out ?? "docs/benchmarks/lifecycle-check.json");
const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (t) => console.log(`[lifecycle] ${t}`);
const post = (path, body, base = BASE) => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ps = async (base = BASE) => (await fetch(`${base}/api/ps`).then((r) => r.json()).catch(() => ({ models: [] }))).models ?? [];
const resident = async (model, base = BASE) => (await ps(base)).some((m) => m.name === model || m.model === model);
const vramUsed = () => {
  try {
    return Number(execFileSync("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 3000 }).trim());
  } catch {
    return null;
  }
};

async function evict(model) {
  await post("/api/generate", { model, prompt: "", keep_alive: 0, stream: false }).catch(() => {});
  for (let i = 0; i < 40; i += 1) {
    if (!(await resident(model))) return true;
    await sleep(250);
  }
  return false;
}

/** A text PDF with numbered questions, like a worksheet: no real paper, no student data. */
async function worksheet() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  const lines = [
    ["Worksheet: Algebra", 760, 20],
    ["Question 3", 700, 14],
    ["Solve 2x + 4 = 18.", 675, 12],
    ["Question 4", 620, 14],
    ["(a) Expand and simplify (x + 3)(x + 5).", 595, 12],
    ["(b) Solve the equation x^2 + 8x + 15 = 0 by factorising.", 570, 12],
    ["Question 5", 520, 14],
    ["Find the 10th term of the sequence 5, 12, 19, 26.", 495, 12],
  ];
  for (const [text, y, size] of lines) page.drawText(text, { x: 60, y, size, font });
  return new Uint8Array(await pdf.save());
}

async function main() {
  const config = assistantConfig({ ...process.env, ASSISTANT_PROVIDER: "ollama", ASSISTANT_MODEL: MODEL, ASSISTANT_VISION_MODEL: MODEL });
  const store = new InMemoryLibraryStore();
  const uploads = new MemoryLibraryStorage();
  const make = async (email) => {
    const profile = store.seedProfile({ email });
    return { clientId: await store.accounts.ensureClient(profile), studentId: null };
  };
  const ownerA = await make("lifecycle-a@example.invalid");
  const ownerB = await make("lifecycle-b@example.invalid");
  const provider = new OllamaProvider({ baseUrl: BASE, model: config.model, visionModel: config.visionModel ?? undefined, contextSize: config.contextSize, keepAlive: config.keepAlive });
  const embeddings = new OllamaEmbeddingProvider({ ...config.retrieval.embedding });
  const deps = { store, provider, queue: new GenerationQueue(1, 4), uploads, config, embeddings, decision: new SystemOneClient(config.decision), hosted: false, log: () => {} };

  const turn = async (owner, sessionId, text, fileIds = []) => {
    const started = now();
    let firstStatus = null;
    let firstDelta = null;
    let error = null;
    let done = null;
    const statuses = [];
    for await (const event of sendMessage(deps, { owner, sessionId, text, fileIds })) {
      if (event.type === "status") {
        statuses.push(event.state);
        firstStatus ??= { state: event.state, ms: Math.round(now() - started) };
      }
      if (event.type === "delta") firstDelta ??= Math.round(now() - started);
      if (event.type === "error") error = event.code;
      if (event.type === "done") done = event;
    }
    return { wallMs: Math.round(now() - started), firstStatus, firstVisibleMs: firstDelta, statuses: [...new Set(statuses)], error, ok: Boolean(done) && !error };
  };

  const result = { checkedAt: new Date().toISOString(), model: MODEL, context: config.contextSize, keepAlive: config.keepAlive };

  // A. idle expiry. A short keep_alive stands in for the 30 m default: same mechanism, observable in under a minute.
  say("A. idle expiry");
  await evict(MODEL);
  await post("/api/chat", { model: MODEL, messages: [{ role: "user", content: "Say ok." }], stream: false, think: false, keep_alive: "15s", options: { num_ctx: config.contextSize, num_predict: 8 } });
  const residentAfterLoad = await resident(MODEL);
  await sleep(22_000);
  const residentAfterIdle = await resident(MODEL);
  const session = await store.chat.createSession(ownerA, { title: "idle" }, new Date());
  const afterIdle = await turn(ownerA, session.id, "What is 7 times 8?");
  result.idleExpiry = { keepAlive: "15s", residentAfterLoad, residentAfterIdle, evictedByIdle: residentAfterLoad && !residentAfterIdle, nextTurn: afterIdle };
  say(`   resident ${residentAfterLoad} -> ${residentAfterIdle} after 22 s; next turn ${afterIdle.ok ? "ok" : afterIdle.error} in ${afterIdle.wallMs} ms, status ${afterIdle.firstStatus?.state ?? "none"}`);

  // B. helpers beside the tutor.
  say("B. helper calls beside the tutor");
  await turn(ownerA, session.id, "What is 3 plus 4?");
  const vramBefore = vramUsed();
  const tutorBefore = await resident(MODEL);
  const embedStarted = now();
  const vectors = await embeddings.embed(["how do I factorise a quadratic"], { kind: "query" }).catch(() => null);
  const embedMs = Math.round(now() - embedStarted);
  const decisionStarted = now();
  const decided = await new SystemOneClient(config.decision).route("Explain question 4b to me").catch(() => null);
  const decisionMs = Math.round(now() - decisionStarted);
  const vramAfter = vramUsed();
  const helperModels = await ps(HELPER);
  result.helpers = {
    tutorResidentBefore: tutorBefore,
    tutorResidentAfter: await resident(MODEL),
    embedOk: Boolean(vectors), embedMs,
    decisionAnswered: Boolean(decided), decisionMs,
    helperModelsResident: helperModels.map((m) => ({ name: m.name, sizeVramMiB: Math.round((m.size_vram ?? 0) / 1048576) })),
    vramUsedMiB: { before: vramBefore, after: vramAfter },
  };
  say(`   tutor stays ${result.helpers.tutorResidentAfter}, helper size_vram ${JSON.stringify(result.helpers.helperModelsResident.map((m) => m.sizeVramMiB))}, GPU ${vramBefore} -> ${vramAfter} MiB`);

  // C. PDF follow-up.
  say("C. PDF follow-up");
  const pdfBytes = await worksheet();
  const pdf = await inspectChatUpload("worksheet.pdf", pdfBytes);
  if (!pdf.ok) throw new Error(`the generated PDF was refused: ${pdf.problem.code}`);
  const pdfSession = await store.chat.createSession(ownerA, { title: "pdf" }, new Date());
  const path = `${pdfSession.id}/worksheet.pdf`;
  await uploads.put(path, pdf.bytes);
  const file = await store.chat.addFile(ownerA, pdfSession.id, { storagePath: path, bytes: pdf.bytes.length, contentType: "application/pdf" }, new Date());
  const first = await turn(ownerA, pdfSession.id, "Please explain question 4(b) from my worksheet.", [file.id]);
  await sleep(4000); // indexing runs after the answer, one file at a time
  const chunks = await store.chat.listFileChunks(ownerA, pdfSession.id, { fileId: file.id });
  const followUp = await turn(ownerA, pdfSession.id, "Why did you factorise it that way?");
  result.pdf = {
    bytes: pdf.bytes.length,
    firstTurn: first,
    chunksIndexed: chunks.length,
    chunkDimension: chunks[0]?.dimension ?? null,
    followUp,
    followUpReusedReading: !followUp.statuses.includes("reading"),
  };
  say(`   first ${first.ok ? "ok" : first.error} ${first.wallMs} ms; ${chunks.length} chunks; follow-up ${followUp.ok ? "ok" : followUp.error} ${followUp.wallMs} ms (statuses ${followUp.statuses.join(",") || "-"})`);

  // D. two students at once.
  say("D. two students at once");
  const sa = await store.chat.createSession(ownerA, { title: "a" }, new Date());
  const sb = await store.chat.createSession(ownerB, { title: "b" }, new Date());
  const t0 = now();
  const [ra, rb] = await Promise.all([
    turn(ownerA, sa.id, "Explain what a prime number is in two sentences."),
    turn(ownerB, sb.id, "Explain what a square number is in two sentences."),
  ]);
  result.concurrent = { a: ra, b: rb, wallMs: Math.round(now() - t0), bothOk: ra.ok && rb.ok };
  say(`   a ${ra.ok ? "ok" : ra.error} ${ra.wallMs} ms; b ${rb.ok ? "ok" : rb.error} ${rb.wallMs} ms (first visible ${ra.firstVisibleMs}/${rb.firstVisibleMs})`);

  // E. backend restart.
  if (!args["skip-restart"]) {
    say("E. backend restart");
    const local = resolve(REPO, "scripts", "ollama-local.mjs");
    spawnSync(process.execPath, [local, "stop"], { encoding: "utf8", timeout: 60_000 });
    await sleep(1500);
    const sd = await store.chat.createSession(ownerA, { title: "down" }, new Date());
    const down = await turn(ownerA, sd.id, "What is 2 plus 2?");
    const start = spawnSync(process.execPath, [local, "start"], { encoding: "utf8", timeout: 120_000 });
    const sr = await store.chat.createSession(ownerA, { title: "restarted" }, new Date());
    const restarted = await turn(ownerA, sr.id, "What is 2 plus 2?");
    result.restart = { whileDown: down, startExit: start.status, afterRestart: restarted, honestWhileDown: !down.ok && Boolean(down.error) };
    say(`   down: ${down.ok ? "answered?!" : down.error} in ${down.wallMs} ms; after restart: ${restarted.ok ? "ok" : restarted.error} in ${restarted.wallMs} ms`);
  }

  result.passed = Boolean(result.idleExpiry.evictedByIdle && result.idleExpiry.nextTurn.ok && result.helpers.tutorResidentAfter
    && result.helpers.helperModelsResident.every((m) => m.sizeVramMiB === 0) && result.pdf.firstTurn.ok && result.pdf.followUp.ok
    && result.concurrent.bothOk && (!result.restart || (result.restart.honestWhileDown && result.restart.afterRestart.ok)));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  say(`wrote ${OUT}; passed=${result.passed}`);
  if (!result.passed) process.exitCode = 1;
}

await main();
