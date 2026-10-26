#!/usr/bin/env node
/**
 * Repeatable latency runs over the real-time socket.
 *
 * WHAT THIS MEASURES: the transport and the client's own timers — from the moment the last audio packet is sent to the
 * moment the first audio packet comes back, and how long the endpoint takes to yield when the user talks over it.
 *
 * WHAT THIS DOES NOT MEASURE: recognition accuracy, answer correctness, or how natural the voice sounds. The audio sent
 * is a SYNTHETIC TONE (lib/pcm.mjs), so no model can be said to have heard or understood anything. Those questions need
 * a person and are covered by docs/DEMO_TEST_PLAN.md.
 *
 *   node scripts/bench.mjs [--url ws://127.0.0.1:3999/api/realtime] [--runs 5] [--utterance-ms 2000]
 *                          [--interrupt] [--out results/bench.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { speechLike, toPcm16, median, percentile } from "../lib/pcm.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith("--") ? argv[at + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const URL_ = flag("url", process.env.NV_BENCH_URL ?? "ws://127.0.0.1:3999/api/realtime");
const RUNS = Number(flag("runs", "5"));
const UTTERANCE_MS = Number(flag("utterance-ms", "2000"));
const PACKET_MS = 80;
const INPUT_RATE = Number(process.env.NV_INPUT_RATE ?? 24000);
const INTERRUPT = has("interrupt");
const QUIET = has("quiet");
const OUT = flag("out", path.join(ROOT, "results", "bench.json"));

if (typeof WebSocket !== "function") {
  console.error("This needs Node's built-in WebSocket (Node 22 or newer). It is not available here.");
  process.exit(2);
}

const now = () => performance.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A socket with a small "wait for the next message that matches" helper, so the timings read like the protocol. */
function openSocket(url) {
  const ws = new WebSocket(url);
  const seen = [];
  const waiters = [];
  let closed = false;
  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    message.at = now();
    seen.push(message.type);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].match(message)) {
        const [waiter] = waiters.splice(i, 1);
        waiter.resolve(message);
      }
    }
  };
  ws.onclose = () => {
    closed = true;
    for (const waiter of waiters.splice(0)) waiter.reject(new Error("the socket closed before that event arrived"));
  };
  return {
    ws,
    seen,
    get closed() {
      return closed;
    },
    waitFor(match, timeoutMs, what) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const at = waiters.findIndex((waiter) => waiter.resolve === wrapped);
          if (at >= 0) waiters.splice(at, 1);
          reject(new Error(`timed out after ${timeoutMs} ms waiting for ${what}`));
        }, timeoutMs);
        const wrapped = (message) => {
          clearTimeout(timer);
          resolve(message);
        };
        waiters.push({ match, resolve: wrapped, reject });
      });
    },
  };
}

async function connect(url, timeoutMs = 6000) {
  const socket = openSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no WebSocket handshake within ${timeoutMs} ms`)), timeoutMs);
    socket.ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("the WebSocket refused the connection"));
    };
  });
  return socket;
}

const base64Of = (samples) => toPcm16(samples).toString("base64");

async function runOnce(index) {
  const startedAt = now();
  const socket = await connect(URL_);
  const connect0 = now() - startedAt;
  try {
    await socket.waitFor((m) => m.type === "session.created", 4000, "session.created");
    socket.ws.send(
      JSON.stringify({
        type: "session.update",
        session: { audio: { input: { format: { type: "audio/pcm", rate: INPUT_RATE } }, output: { format: "pcm16" } }, instructions: "benchmark run", tools: [] },
      }),
    );

    // Speak: the same cadence the page sends, packet by packet, without stopping in between (full duplex).
    const packets = Math.max(1, Math.round(UTTERANCE_MS / PACKET_MS));
    let lastAppendAt = now();
    for (let packet = 0; packet < packets; packet += 1) {
      const chunk = speechLike({ seconds: PACKET_MS / 1000, rate: INPUT_RATE, seed: index * 31 + packet });
      socket.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64Of(chunk) }));
      lastAppendAt = now(); // the client-side "the student stopped" boundary: the instant the last packet went on the wire
      // No trailing sleep after the final packet: it would be counted as silence the student took.
      if (packet < packets - 1) await sleep(PACKET_MS);
    }

    // The server's own view of the turn ending, then the answer: three boundaries, kept apart on purpose.
    const speechStopped = await socket.waitFor((m) => m.type === "input_audio_buffer.speech_stopped", 10000, "speech_stopped").catch(() => null);
    const created = await socket.waitFor((m) => m.type === "response.created", 10000, "response.created");
    const firstAudio = await socket.waitFor((m) => m.type === "response.output_audio.delta", 15000, "the first audio packet");
    const firstAudioAt = now();

    // Validate the documented contract rather than trusting it: PCM16 base64, and how long the packet is.
    const samples = Math.round((firstAudio.delta.length * 3) / 4 / 2);
    const observed = { sampleRate: firstAudio.sample_rate ?? null, samples, packetMs: Math.round((samples / (firstAudio.sample_rate ?? 24000)) * 1000) };

    let interruptionMs = null;
    let interrupted = false;
    if (INTERRUPT) {
      // Talk over it, exactly as the page does on barge-in, and see how quickly the endpoint yields. The waiter is armed
      // BEFORE the first interrupting packet is sent, or the yield can arrive before anything is listening for it.
      const startedTalkingAt = now();
      const yielded = socket.waitFor((m) => m.type === "response.output_audio.done" && m.interrupted, 5000, "the endpoint to yield").catch(() => null);
      // Long enough to clear a minimum-speech gate (~300 ms), which is what a real "wait, explain that again" would do.
      for (let packet = 0; packet < 6; packet += 1) {
        const chunk = speechLike({ seconds: PACKET_MS / 1000, rate: INPUT_RATE, seed: 9000 + packet });
        socket.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64Of(chunk) }));
        await sleep(PACKET_MS);
      }
      const done = await yielded;
      if (done) {
        interruptionMs = done.at - startedTalkingAt;
        interrupted = true;
      }
    } else {
      try {
        await socket.waitFor((m) => m.type === "response.done", 12000, "response.done");
      } catch {
        /* a slow endpoint is not a failed run */
      }
    }

    return {
      run: index + 1,
      connectMs: Math.round(connect0),
      clientBoundaryMs: firstAudioAt - lastAppendAt,
      serverBoundaryMs: speechStopped ? firstAudioAt - speechStopped.at : null,
      packetDelayMs: firstAudioAt - created.at,
      speechStoppedSeen: Boolean(speechStopped),
      firstAudioPacket: observed,
      interruptionMs,
      interrupted,
      eventsSeen: socket.seen.length,
      ok: true,
    };
  } finally {
    try {
      socket.ws.send(JSON.stringify({ type: "session.end" }));
    } catch {
      /* gone */
    }
    socket.ws.close(1000);
  }
}

console.log(`Nemotron VoiceChat experiment — benchmark`);
console.log(`  endpoint        ${URL_}`);
console.log(`  runs            ${RUNS}${INTERRUPT ? " (with a talking-over test in each run)" : ""}`);
console.log(`  speech sent     ${UTTERANCE_MS} ms of SYNTHETIC TONE in ${PACKET_MS} ms packets at ${INPUT_RATE} Hz — not speech, not a model's input in any meaningful sense`);
console.log("");

const runs = [];
for (let index = 0; index < RUNS; index += 1) {
  try {
    const result = await runOnce(index);
    runs.push(result);
    if (!QUIET) {
      console.log(
        `  run ${String(result.run).padStart(2)}  connect ${String(result.connectMs).padStart(4)} ms   last packet → first audio ${String(Math.round(result.clientBoundaryMs)).padStart(5)} ms` +
          (INTERRUPT ? `   endpoint yielded after ${result.interruptionMs === null ? "never" : `${Math.round(result.interruptionMs)} ms`}` : ""),
      );
    }
  } catch (error) {
    console.log(`  run ${String(index + 1).padStart(2)}  FAILED — ${String(error.message ?? error)}`);
    runs.push({ run: index + 1, ok: false, error: String(error.message ?? error) });
  }
}

const good = runs.filter((run) => run.ok);
const summary = {
  endpoint: URL_,
  startedAt: new Date().toISOString(),
  audio: "synthetic tone, not speech",
  runs: runs.length,
  succeeded: good.length,
  failed: runs.length - good.length,
  clientBoundaryMs: { median: median(good.map((run) => run.clientBoundaryMs)), p95: percentile(good.map((run) => run.clientBoundaryMs), 95) },
  serverBoundaryMs: { median: median(good.map((run) => run.serverBoundaryMs).filter((v) => v !== null)), p95: percentile(good.map((run) => run.serverBoundaryMs).filter((v) => v !== null), 95) },
  packetDelayMs: { median: median(good.map((run) => run.packetDelayMs)), p95: percentile(good.map((run) => run.packetDelayMs), 95) },
  connectMs: { median: median(good.map((run) => run.connectMs)), p95: percentile(good.map((run) => run.connectMs), 95) },
  interruptionMs: INTERRUPT ? { median: median(good.filter((run) => run.interrupted).map((run) => run.interruptionMs)), p95: percentile(good.filter((run) => run.interrupted).map((run) => run.interruptionMs), 95) } : null,
  details: runs,
};

console.log("");
if (!good.length) {
  console.log(`NO ENDPOINT: every run failed. Nothing was measured, and nothing should be reported as tested.`);
  console.log(`  first error: ${runs[0]?.error ?? "unknown"}`);
  console.log(`  start the stand-in (\`npm run mock\`) to verify this harness, or point NV_REALTIME_URL at a real endpoint.`);
} else {
  const round = (value) => (value === null || value === undefined ? "—" : `${Math.round(value)} ms`);
  console.log(`  last packet → first audio   median ${round(summary.clientBoundaryMs.median)}   p95 ${round(summary.clientBoundaryMs.p95)}   (n=${good.length})`);
  console.log(`  speech_stopped → first audio median ${round(summary.serverBoundaryMs.median)}   p95 ${round(summary.serverBoundaryMs.p95)}   (the endpoint's own turn boundary)`);
  console.log(`  response.created → first audio median ${round(summary.packetDelayMs.median)}   p95 ${round(summary.packetDelayMs.p95)}   (packet delay only)`);
  console.log(`  connect                     median ${round(summary.connectMs.median)}   p95 ${round(summary.connectMs.p95)}`);
  if (INTERRUPT) console.log(`  endpoint yielded after      median ${round(summary.interruptionMs?.median)}   p95 ${round(summary.interruptionMs?.p95)}`);
  console.log(`\n  These describe the transport on this machine. The audio was a tone: no model heard anything.`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(`  written to ${path.relative(ROOT, OUT)}\n`);
process.exit(good.length ? 0 : 2);
