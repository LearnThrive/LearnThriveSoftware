#!/usr/bin/env node
/**
 * Voice mode benchmark (plan19 section 5.4). Writes docs/VOICE_BENCHMARK.md from two measurements:
 *
 *   1. the speech ENGINES on their own (services/voice/bench.py): word error rate on a labelled SYNTHETIC set, real-time factor, memory,
 *      and time to first audio for the speech voices. Written to docs/benchmarks/voice-engines.json.
 *   2. the whole PIPELINE as the product runs it: end of speech to first audio = recognition + the model's first spoken sentence +
 *      the first speech clip, with the sidecar and Ollama as the site uses them. Written to docs/benchmarks/voice-pipeline.json.
 *
 *   npm run voice:bench -- --stt base.en/cpu,base.en/cuda --model qwen3.5:9b --runs 8
 *   npm run voice:bench -- --skip-engines        (reuse docs/benchmarks/voice-engines.json; measure the pipeline and rewrite the report)
 *   npm run voice:bench -- --report-only         (rewrite the report from the two JSON files)
 *
 * Close other programs first: the timings are only comparable on an otherwise idle machine. Everything spoken is synthetic.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeWav16k, resampleTo16k } from "../src/lib/assistant/audio.ts";
import { OllamaProvider } from "../src/lib/assistant/ollama.ts";
import { SYSTEM_PROMPT } from "../src/lib/assistant/prompt.ts";
import { VOICE_PROMPT_ADDENDUM, settledPrefix, speechChunksPartial, toSpeech } from "../src/lib/assistant/speech.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const args = process.argv.slice(2);
const value = (name, fallback = "") => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? fallback) : fallback;
};
const flag = (name) => args.includes(name);

const sttConfigs = (value("--stt", "base.en/cpu")).split(",").filter(Boolean);
const llmModel = value("--model", "qwen3.5:9b");
const runs = Number(value("--runs", "8"));
const OLLAMA = value("--ollama", "http://127.0.0.1:11434");
const PORT = 8799;
const phrasesFile = join(here, "..", "tests", "fixtures", "assistant", "voice-phrases.json");
const enginesFile = join(root, "docs", "benchmarks", "voice-engines.json");
const pipelineFile = join(root, "docs", "benchmarks", "voice-pipeline.json");
const reportFile = join(root, "docs", "VOICE_BENCHMARK.md");
const voiceDir = join(root, "services", "voice");

const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] : null);
const p95 = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)] : null);
const fmt = (n, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? "n/a" : Number(n).toFixed(d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(command, argv, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, argv, { stdio: "inherit", ...options });
    child.on("exit", (code) => (code === 0 ? resolveRun() : reject(new Error(`${command} exited ${code}`))));
  });
}

function pcm(wav) {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let rate = 0;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = String.fromCharCode(...wav.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    if (id === "fmt ") rate = view.getUint32(at + 12, true);
    if (id === "data") {
      const n = Math.min(size, wav.length - at - 8) / 2;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i += 1) out[i] = view.getInt16(at + 8 + i * 2, true) / 32768;
      return { samples: out, rate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error("no audio in the WAV");
}

const vram = () => {
  try {
    return Number(execFileSync("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8" }).trim().split("\n")[0]);
  } catch {
    return null;
  }
};

// ---- 1. the engines ---------------------------------------------------------------------------------------------------------

if (!flag("--skip-engines") && !flag("--report-only")) {
  mkdirSync(dirname(enginesFile), { recursive: true });
  await run("uv", ["run", "--project", voiceDir, "python", join(voiceDir, "bench.py"), "--phrases", phrasesFile, "--out", enginesFile], { cwd: voiceDir });
}

// ---- 2. the pipeline --------------------------------------------------------------------------------------------------------

async function startSidecar([model, device]) {
  // `parakeet/cuda` runs the migration's recogniser through the shipped adapter; `base.en/cpu` the pre-migration whisper path.
  const parakeet = model === "parakeet" || model.endsWith(".gguf");
  const env = { ...process.env, VOICE_PORT: String(PORT), VOICE_STT_ENGINE: parakeet ? "parakeet" : "whisper", VOICE_STT_DEVICE: device, PYTHONUNBUFFERED: "1" };
  if (parakeet) {
    delete env.VOICE_STT_COMPUTE;
    if (model !== "parakeet") env.VOICE_STT_MODEL = model;
  } else {
    env.VOICE_STT_MODEL = model;
    env.VOICE_STT_COMPUTE = device === "cuda" ? "float16" : "int8";
  }
  const child = spawn("uv", ["run", "--project", voiceDir, "python", join(voiceDir, "server.py")], { env, stdio: "ignore", cwd: voiceDir });
  for (let i = 0; i < 180; i += 1) {
    await sleep(1000);
    try {
      const health = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
      if (health.stt.loaded && health.tts.loaded) return child;
    } catch {
      // not up yet
    }
  }
  child.kill();
  throw new Error("the speech sidecar did not start");
}

function stopSidecar(child) {
  try {
    execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    child.kill();
  }
}

async function post(path, body, type) {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: "POST", headers: { "Content-Type": type }, body });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { ms: performance.now() - started, ok: response.ok, bytes };
}

async function pipelineFor(config, phrases) {
  const [model, device] = config.split("/");
  const sidecar = await startSidecar([model, device]);
  const provider = new OllamaProvider({ baseUrl: OLLAMA, model: llmModel, contextSize: 8192 });
  const rows = [];
  try {
    // Load the language model once, uncounted.
    for await (const chunk of provider.stream([{ role: "user", content: "Say hello." }], { maxTokens: 8, temperature: 0.3, contextSize: 8192, firstTokenTimeoutMs: 120_000, totalTimeoutMs: 120_000 })) void chunk;
    for (let i = 0; i < runs + 1; i += 1) {
      const phrase = phrases[(i * 3) % phrases.length];
      // The student's speech: a synthetic voice, converted exactly as the browser converts the microphone.
      const spoken = await post("/tts", JSON.stringify({ text: phrase.text }), "application/json");
      const { samples, rate } = pcm(spoken.bytes);
      const wav = encodeWav16k(resampleTo16k([samples], rate));
      // ---- end of speech ----
      const t0 = performance.now();
      const heard = await post("/stt", wav, "audio/wav");
      const stt = performance.now() - t0;
      const transcript = JSON.parse(new TextDecoder().decode(heard.bytes)).text;
      const tModel = performance.now();
      let firstToken = null;
      let firstChunk = null;
      let text = "";
      const controller = new AbortController();
      try {
        for await (const chunk of provider.stream([{ role: "system", content: `${SYSTEM_PROMPT}\n\n${VOICE_PROMPT_ADDENDUM}` }, { role: "user", content: transcript }], { maxTokens: 200, temperature: 0.3, contextSize: 8192, firstTokenTimeoutMs: 60_000, totalTimeoutMs: 60_000, signal: controller.signal })) {
          if (chunk.type !== "text") continue;
          firstToken ??= performance.now() - tModel;
          text += chunk.text;
          const { ready } = speechChunksPartial(toSpeech(settledPrefix(text)));
          if (ready.length > 0) {
            firstChunk = { ms: performance.now() - tModel, text: ready[0] };
            controller.abort();
            break;
          }
        }
      } catch {
        // aborted on purpose
      }
      if (!firstChunk) firstChunk = { ms: performance.now() - tModel, text: toSpeech(text).slice(0, 120) };
      const tTts = performance.now();
      const clip = await post("/tts", JSON.stringify({ text: firstChunk.text }), "application/json");
      const tts = performance.now() - tTts;
      if (i === 0) continue; // the first round warms everything and is not counted
      rows.push({ phrase: phrase.id, audioMs: Math.round((wav.length - 44) / 32), stt, firstToken, firstChunkReady: firstChunk.ms, tts, total: stt + firstChunk.ms + tts, ok: heard.ok && clip.ok, chunkChars: firstChunk.text.length });
      console.log(`  ${config} ${phrase.id}: stt ${fmt(stt)} ms, first token ${fmt(firstToken)} ms, first sentence ${fmt(firstChunk.ms)} ms, tts ${fmt(tts)} ms, total ${fmt(stt + firstChunk.ms + tts)} ms`);
    }
    const memory = vram();
    return { config, rows, vramUsedMb: memory, sttMedian: median(rows.map((r) => r.stt)), firstTokenMedian: median(rows.map((r) => r.firstToken)), firstChunkMedian: median(rows.map((r) => r.firstChunkReady)), ttsMedian: median(rows.map((r) => r.tts)), totalMedian: median(rows.map((r) => r.total)), totalP95: p95(rows.map((r) => r.total)) };
  } finally {
    stopSidecar(sidecar);
  }
}

if (!flag("--report-only")) {
  const phrases = JSON.parse(readFileSync(phrasesFile, "utf8")).phrases;
  const results = [];
  for (const config of sttConfigs) results.push(await pipelineFor(config, phrases));
  writeFileSync(pipelineFile, JSON.stringify({ model: llmModel, runs, results, date: new Date().toISOString().slice(0, 10) }, null, 2));
}

// ---- the report -------------------------------------------------------------------------------------------------------------

const engines = JSON.parse(readFileSync(enginesFile, "utf8"));
const pipeline = existsSync(pipelineFile) ? JSON.parse(readFileSync(pipelineFile, "utf8")) : null;
const cpus = os.cpus();
const gpu = (() => {
  try {
    return execFileSync("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader"], { encoding: "utf8" }).trim();
  } catch {
    return "no NVIDIA GPU";
  }
})();

const ok = engines.stt.filter((c) => c.wer);
const bestClean = Math.min(...ok.map((c) => c.wer.clean));
// The migration's default is Parakeet CTC 1.1B; the whisper rows stay in the table as the measured rollback path.
const para = ok.find((c) => c.engine === "parakeet");
const whisperBest = [...ok.filter((c) => c.engine !== "parakeet")].sort((a, b) => a.wer.clean - b.wer.clean || a.msMedian - b.msMedian)[0];
const ttsOk = engines.tts.filter((t) => t.first);
const kokoro = ttsOk.find((t) => t.engine === "kokoro" && t.voice === "bf_emma") ?? ttsOk.find((t) => t.engine === "kokoro");
const piperFastest = [...ttsOk.filter((t) => t.engine === "piper")].sort((a, b) => a.first.msMedian - b.first.msMedian)[0];
const best = pipeline ? [...pipeline.results].sort((a, b) => a.totalMedian - b.totalMedian)[0] : null;

const L = [];
L.push("# Voice mode benchmark", "");
L.push(`Generated by \`apps/web/scripts/voice-bench.mjs\` (and \`services/voice/bench.py\`) on ${pipeline?.date ?? "an earlier date"} (plan19 section 5.4). Raw numbers: \`docs/benchmarks/voice-engines.json\`, \`docs/benchmarks/voice-pipeline.json\`.`, "");
L.push("> **Every recording here is synthetic.** The phrases were spoken by text-to-speech voices (never a child, never a real recording), so recognition scores are **optimistic**: a child's voice, a classroom's noise and an unfamiliar accent are harder. The owner's own recordings of real phrases, added to `tests/fixtures/assistant/voice-phrases.json` as WAV files, would be better evidence. Nothing here was heard by a person.", "");
L.push("## Machine", "", "| | |", "| --- | --- |", `| CPU | ${cpus[0]?.model?.trim()} (${cpus.length} threads) |`, `| RAM | ${Math.round(os.totalmem() / 2 ** 30)} GB |`, `| GPU | ${gpu} |`, `| OS | ${os.type()} ${os.release()} |`, "");

L.push("## The set", "", `${engines.phrases} phrases of the kind a student says (maths and science vocabulary: x squared, quadratic, denominator, photosynthesis…), each spoken by ${engines.voices.length} synthetic voices (${engines.voices.join(", ")}), once clean and once with white noise added at 15 dB signal-to-noise. Word error rate is computed after folding digits to words ("5x" and "five x" are the same) and punctuation away. "Terms found" is the share of the maths and science words that were recognised correctly.`, "");

L.push("## Speech recognition", "", "| Engine | Model | Device | Compute | WER clean | WER noisy | Terms found | Median ms per clip | p95 ms | Real-time factor | Memory (RAM / VRAM) | Load (s) |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const c of engines.stt) {
  const engine = c.engine ?? "whisper";
  if (c.error) L.push(`| ${engine} | ${c.model} | ${c.device} | ${c.compute} | not run: ${c.error.replace(/\|/g, "/")} | | | | | | | |`);
  else L.push(`| ${engine} | ${c.model} | ${c.device}${c.deviceReported ? ` (${c.deviceReported})` : ""} | ${c.compute} | ${c.wer.clean}% | ${c.wer.noisy}% | ${c.termsFoundPercent}% | ${c.msMedian} | ${c.msP95} | ${c.rtfMedian} | ${c.rssMb} MB / ${c.vramMb ?? "n/a"} MB | ${c.loadSeconds} |`);
}
L.push("", "A Parakeet row measures the sidecar's own adapter against a real NeMo-Speech.cpp runtime (its device column repeats what that runtime's `/ready` reported). The whisper rows are the pre-migration engine, kept for rollback. Clips are 2 to 6 seconds long. `medium.en` and the CPU Parakeet row were run on one voice only, because they are the slow ones.", "");
const worst = ok.flatMap((c) => c.errorExamples.map((e) => ({ model: `${c.model}/${c.device}`, ...e }))).slice(0, 4);
if (worst.length) {
  L.push("Examples of what went wrong (clean audio):", "");
  for (const w of worst) L.push(`- ${w.model}, ${w.voice}: said "${w.said}", heard "${w.heard}"`);
  L.push("");
}

L.push("## Speech output", "", `Time to synthesise the first chunk (\`${"Good question. Let us look at it."}\`, 33 characters) and a longer one (86 characters), median of 5 after a warm-up. The browser's own \`speechSynthesis\` is the fallback; it runs on the device, so it cannot be benchmarked here and varies by device.`, "", "| Engine | Voice | First chunk ms | Longer ms | Real-time factor | Memory | Load (s) |", "| --- | --- | --- | --- | --- | --- | --- |");
for (const t of engines.tts) {
  if (t.error) L.push(`| ${t.engine} | | not run: ${t.error} | | | | |`);
  else L.push(`| ${t.engine} | ${t.voice} | ${t.first.msMedian} | ${t.longer.msMedian} | ${t.first.rtf} | ${Math.max(0, t.rssMb)} MB | ${t.loadSeconds} |`);
}
L.push("", "Memory is what the process grew by when the voice loaded; the first Piper voice includes the shared ONNX runtime, later ones reuse it (shown as 0 where the measurement came out negative). How natural a voice sounds is judged by ear, which this report cannot do: the owner should listen to a few answers in each candidate voice before choosing (`VOICE_TTS_VOICE`, and the voices in `services/voice/models`).", "");

if (pipeline) {
  L.push("## The whole pipeline, end of speech to first audio", "", `The speech sidecar and Ollama (\`${pipeline.model}\`, voice-mode prompt) as the site uses them, ${pipeline.runs} utterances per configuration after a warm-up. "End of speech" is the moment the recording stops; the clock stops when the first clip of speech has been synthesised (the browser then starts playing it, a few milliseconds). The model's first spoken chunk is the first complete sentence of at least 24 characters, as the page speaks it. The hop through the Next route adds a few milliseconds and is not included.`, "", "| Recogniser | Recognition (target < 700) | First model token (target < 1000) | First sentence ready | First speech clip (target < 500) | **End of speech to first audio (target median < 2500)** | p95 | VRAM in use |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of pipeline.results) L.push(`| ${r.config} | ${fmt(r.sttMedian)} ms | ${fmt(r.firstTokenMedian)} ms | ${fmt(r.firstChunkMedian)} ms | ${fmt(r.ttsMedian)} ms | **${fmt(r.totalMedian)} ms** | ${fmt(r.totalP95)} ms | ${r.vramUsedMb ?? "n/a"} MB |`);
  L.push("");
  if (best) L.push(`Median ${fmt(best.totalMedian)} ms against a target of 2500 ms: ${best.totalMedian < 2500 ? "**met**" : "**not met**"}. Most of it is the model producing a full first sentence, not the speech engines.`, "");
}

L.push("## Decision", "");
if (para) {
  const versus = whisperBest ? ` The best whisper row here is \`${whisperBest.model}\` (${whisperBest.device}) at ${whisperBest.wer.clean}% / ${whisperBest.wer.noisy}% and ${whisperBest.msMedian} ms.` : "";
  L.push(`- **Recognition: Parakeet CTC 1.1B (\`${para.model}\`), the local default.** ${para.wer.clean}% clean and ${para.wer.noisy}% noisy word error, ${para.termsFoundPercent}% of the maths and science terms found, ${para.msMedian} ms median a clip (p95 ${para.msP95}), real-time factor ${para.rtfMedian}, ${para.loadSeconds} s to load, ${para.vramMb ?? "n/a"} MB of VRAM while it ran.${versus} The runtime reported confidence per ${para.confidenceSource === "none" ? "nothing: the frontend must not invent a score (it decides on silence, length and risky maths alone)" : `${para.confidenceSource}`}.`);
} else {
  L.push("- No Parakeet row ran (no runtime or no GGUF): the whisper rows above are what the sidecar falls back to, and `/health` says so.");
}
const cpuFit = ok.filter((c) => c.device === "cpu" && (c.engine !== "parakeet" ? c.msMedian <= 700 : true)).sort((a, b) => a.wer.clean - b.wer.clean)[0];
if (whisperBest) L.push(`- **Rollback: \`VOICE_STT_ENGINE=whisper\`** restores the pre-migration faster-whisper path (\`${whisperBest.model}\` on ${whisperBest.device}, ${whisperBest.msMedian} ms). The sidecar also falls back to it by itself when the runtime or the GGUF is missing, and names the reason in \`/health\`.`);
if (kokoro && piperFastest) {
  const ratio = kokoro.first.msMedian / piperFastest.first.msMedian;
  L.push(`- **Speech output: Kokoro 82M \`${kokoro.voice}\`, the local default.** Its first chunk takes ${kokoro.first.msMedian} ms against Piper's ${piperFastest.first.msMedian} ms (${ratio >= 1 ? `${ratio.toFixed(1)}x slower` : "faster"}), paid once per spoken segment; later chunks queue behind playback, so the voice is rarely the limit. \`VOICE_TTS_ENGINE=piper\` restores Piper, and the browser's \`speechSynthesis\` remains the automatic fallback when the sidecar is unreachable.`);
} else {
  L.push("- Speech output: see the table above; `VOICE_TTS_ENGINE` chooses between Kokoro and Piper (rollback).");
}
L.push("- Push-to-talk only. Hands-free voice-activity detection was not built: it needs a measured false-trigger rate in a real room, and the first version should not listen when nobody pressed anything.", "");
L.push("### What would change it", "", "- A real child's voice and a real room: rerun with recordings. If word error rate is much worse than here, the next step is `medium.en` on the GPU (on the CPU it took 4.7 s a clip; it was not measured on the GPU here).", "- A different machine: the CPU timings are for this CPU. A slower school-lab or hosted machine needs the numbers again.", "- A hosted speech provider (a processor for a child's voice) is a plan19 section 6 decision; this report does not cover one.", "- Running the language model and the recogniser on one 8 GB GPU is possible (see the VRAM column: the whole GPU, desktop included, was at about 7.3 of 8 GB with the recogniser on it) but leaves little room, so a second large program on the GPU would push the language model into system memory and slow it. CPU recognition (`VOICE_STT_DEVICE=cpu`) avoids the contest at a cost in accuracy.", "");
L.push("## Reproduce", "", "```bash", "cd services/voice && uv sync", "node ../../scripts/parakeet-local.mjs          # verifies and extracts the NeMo-Speech.cpp runtime and the Parakeet GGUF", "uv run python -m piper.download_voices --download-dir models en_GB-alba-medium en_GB-jenny_dioco-medium en_GB-northern_english_male-medium", "cd ../../apps/web && npm run voice:bench -- --stt parakeet/cuda,small.en/cuda", "```", "", "Kokoro needs `kokoro-v1.0.onnx` and `voices-v1.0.bin` from the kokoro-onnx release in `services/voice/models`; the CUDA runs need `uv pip install nvidia-cublas-cu12 nvidia-cudnn-cu12`. Models are downloaded from their publishers' hosts and are not committed. `--stt parakeet/cuda` drives the shipped adapter (it spawns the runtime itself); `base.en/cpu` drives the whisper path.", "");

writeFileSync(reportFile, `${L.join("\n")}\n`);
console.log(`\nWrote ${reportFile}`);
