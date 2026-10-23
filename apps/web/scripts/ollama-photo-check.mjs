#!/usr/bin/env node
/**
 * The end-to-end proof of the owner's original failure (brief section 13/14): a photo of a worked arithmetic-sequence question
 * sent through the REAL Study Buddy service, provider, document reader and deadlines, once with the model evicted (cold) and once
 * warm. It is the same code path the chat route runs; only the HTTP framing and the sign-in are left out, so no cookie or account
 * is needed to reproduce a model-timeout.
 *
 *   node --import tsx scripts/ollama-photo-check.mjs [--model=bonsai-2:9b] [--out=path.json]
 *
 * Prints sanitised timings only: no image, no base64, no transcript. Exits non-zero if either turn fails or times out.
 */
import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = resolve(REPO, args.out ?? "docs/benchmarks/photo-check.json");
const now = () => performance.now();
const say = (t) => console.log(`[photo-check] ${t}`);

/** A photo of a worked arithmetic-sequence answer, in the shape a student would send: no real person's work. */
function fixture() {
  const canvas = createCanvas(1000, 780);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fbfbf5";
  ctx.fillRect(0, 0, 1000, 780);
  const line = (text, x, y, size = 27) => {
    ctx.fillStyle = "#141414";
    ctx.font = `${size}px sans-serif`;
    ctx.fillText(text, x, y);
  };
  line("Question 7", 60, 80, 32);
  line("An arithmetic sequence has first term 5 and common difference 7.", 60, 140, 26);
  line("(a) Write down the 10th term.", 60, 200, 27);
  line("(b) The sum of the first n terms is S = n/2 (2a + (n-1)d).", 60, 260, 26);
  line("     Find the least n for which S > 800.", 60, 305, 26);
  line("My working", 60, 380, 30);
  line("a = 5, d = 7", 80, 440, 27);
  line("10th term = 5 + 9 x 7 = 5 + 63 = 68", 80, 500, 27);
  line("S = n/2 (10 + 7(n-1)) = n/2 (7n + 3)", 80, 560, 27);
  line("Try n = 15: 7.5 x 108 = 810. So n = 15.", 80, 620, 27);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

async function evict(model) {
  await fetch(`${BASE}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, prompt: "", keep_alive: 0, stream: false }) }).catch(() => {});
  for (let i = 0; i < 40; i += 1) {
    const ps = await fetch(`${BASE}/api/ps`).then((r) => r.json()).catch(() => null);
    if (!ps || !(ps.models ?? []).some((m) => m.name === model || m.model === model)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  const config = assistantConfig({ ...process.env, ASSISTANT_PROVIDER: "ollama", ASSISTANT_MODEL: MODEL, ASSISTANT_VISION_MODEL: MODEL });
  const store = new InMemoryLibraryStore();
  const profile = store.seedProfile({ email: "photo-check@example.invalid" });
  const clientId = await store.accounts.ensureClient(profile);
  const owner = { clientId, studentId: null };
  const uploads = new MemoryLibraryStorage();
  const provider = new OllamaProvider({ baseUrl: BASE, model: config.model, visionModel: config.visionModel ?? undefined, contextSize: config.contextSize, keepAlive: config.keepAlive });
  const deps = {
    store,
    provider,
    queue: new GenerationQueue(1, 4),
    uploads,
    config,
    embeddings: new OllamaEmbeddingProvider({ ...config.retrieval.embedding }),
    decision: new SystemOneClient(config.decision),
    hosted: false,
    log: () => {},
  };

  const photo = await inspectChatUpload("arithmetic-sequence.png", fixture());
  if (!photo.ok) throw new Error(`the generated photo was refused: ${photo.problem.code}`);

  const run = async (label) => {
    const session = await store.chat.createSession(owner, { title: label }, new Date());
    const path = `${session.id}/question.png`;
    await uploads.put(path, photo.bytes);
    const file = await store.chat.addFile(owner, session.id, { storagePath: path, bytes: photo.bytes.length, contentType: guess(photo.contentType) }, new Date());
    const events = [];
    const started = now();
    let firstStatus = null;
    let firstDelta = null;
    let done = null;
    let error = null;
    for await (const event of sendMessage(deps, { owner, sessionId: session.id, text: "Please check my working on question 7 and tell me if part (b) is right.", fileIds: [file.id] })) {
      events.push(event);
      if (event.type === "status" && firstStatus === null) firstStatus = { state: event.state, ms: Math.round(now() - started) };
      if (event.type === "delta" && firstDelta === null) firstDelta = { ms: Math.round(now() - started), chars: event.text.length };
      if (event.type === "done") done = event;
      if (event.type === "error") error = event.code;
    }
    const wallMs = Math.round(now() - started);
    return { label, wallMs, firstStatus, firstDelta, done: done ? { firstTokenMs: done.firstTokenMs } : null, error, events: events.length };
  };

  await evict(MODEL);
  const cold = await run("cold photo");
  say(`cold: ${cold.error ?? "no error"}, first visible ${cold.firstDelta?.ms ?? "-"} ms, whole turn ${cold.wallMs} ms${cold.firstStatus ? `, preparing shown at ${cold.firstStatus.ms} ms` : ""}`);
  const warm = await run("warm photo");
  say(`warm: ${warm.error ?? "no error"}, first visible ${warm.firstDelta?.ms ?? "-"} ms, whole turn ${warm.wallMs} ms`);

  const result = {
    checkedAt: new Date().toISOString(),
    model: MODEL,
    baseUrl: BASE,
    context: config.contextSize,
    photo: { bytes: photo.bytes.length, kind: photo.kind },
    budgets: { firstAnswerMs: config.stages.image.firstAnswerMs, turnMs: config.stages.image.turnMs, loadMs: config.stages.loadMs },
    cold,
    warm,
    passed: !cold.error && !warm.error && Boolean(cold.done) && Boolean(warm.done),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  say(`wrote ${OUT}`);
  if (!result.passed) process.exitCode = 1;
}

function guess(contentType) {
  return contentType === "image/png" ? "image/png" : "image/jpeg";
}

await main();
