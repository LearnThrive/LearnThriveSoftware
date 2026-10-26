#!/usr/bin/env node
/**
 * What can this machine actually reach, right now? Run this before believing any plan.
 *
 * It asks four separate questions and never guesses an answer:
 *   1. Is an NVIDIA key present, and does NVIDIA's documented API base accept it?
 *   2. Does that key expose any VoiceChat model at all? (A valid key is not the same as access.)
 *   3. Does the configured real-time socket answer a WebSocket handshake, and what does it say first?
 *   4. Is local inference feasible on this machine at all? (VRAM, toolkit, download size.)
 *
 * It prints no key, no key fragment and no header value: only lengths, statuses and model ids.
 * Exit codes: 0 = a real-time endpoint answered, 2 = it did not. Nothing else is asserted.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../lib/ws.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

const readEnvFile = (file) => {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
};

const env = { ...readEnvFile(path.join(ROOT, ".env")), ...process.env };
const KEY = (env.NVIDIA_API_KEY ?? "").trim();
const REALTIME = env.NV_REALTIME_URL ?? "ws://127.0.0.1:8080/v1/realtime";

const line = (label, value) => console.log(`  ${label.padEnd(46)} ${value}`);
const head = (text) => console.log(`\n${text}`);

console.log("Nemotron VoiceChat experiment — access probe");
console.log("=".repeat(78));

/* 1 and 2: the key, and whether it reaches a VoiceChat model. */

head("1. NVIDIA API key and the documented API base (https://integrate.api.nvidia.com/v1)");
line("NVIDIA_API_KEY present", KEY ? `yes (${KEY.length} characters, value never printed)` : "no — the experiment will run only against a local endpoint");
let modelIds = [];
if (KEY) {
  try {
    const response = await fetch("https://integrate.api.nvidia.com/v1/models", { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(20000) });
    line("key accepted by NVIDIA's API base", response.ok ? `yes (HTTP ${response.status})` : `NO (HTTP ${response.status})`);
    if (response.ok) {
      const body = await response.json().catch(() => null);
      modelIds = (body?.data ?? []).map((model) => model.id);
      line("model ids visible to this key", String(modelIds.length));
      const voicechat = modelIds.filter((id) => /voicechat|voice-chat/i.test(id));
      const speech = modelIds.filter((id) => /voice|speech|audio|s2s|omni|riva|tts|asr/i.test(id));
      line("VoiceChat-specific model ids", voicechat.length ? voicechat.join(", ") : "NONE — a valid key is not VoiceChat access");
      line("other speech-ish ids (for context)", speech.length ? `${speech.length}: ${speech.slice(0, 6).join(", ")}${speech.length > 6 ? ", …" : ""}` : "none");
    }
  } catch (error) {
    line("key accepted by NVIDIA's API base", `could not check: ${String(error.message ?? error)}`);
  }
} else {
  line("key accepted by NVIDIA's API base", "not attempted");
}

/* 3: the real-time socket. */

head(`2. The real-time VoiceChat socket (${REALTIME.replace(/\?.*$/, "")})`);
let endpointAnswered = false;
let firstEvents = [];
try {
  const conn = await connect(REALTIME, { timeoutMs: 6000 });
  endpointAnswered = true;
  line("WebSocket handshake", "answered");
  conn.on("message", (data, isBinary) => {
    if (isBinary) return;
    try {
      firstEvents.push(JSON.parse(data).type);
    } catch {
      firstEvents.push("(unparsable)");
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  conn.close(1000);
  line("first events it sent", firstEvents.length ? firstEvents.slice(0, 6).join(", ") : "(nothing in 1.5 s)");
  if (firstEvents.some((type) => /session\.created/.test(type))) line("protocol", "speaks the documented session/response event shape");
} catch (error) {
  line("WebSocket handshake", `FAILED — ${String(error.message ?? error)}`);
  line("what this means", "no VoiceChat endpoint is answering here; nothing should be reported as tested");
}

/* 4: local inference feasibility, from numbers the operator does not have to look up. */

head("3. Local inference on this machine (NVIDIA's documented NeMo-Speech.cpp route)");
const DOCUMENTED_REQUIREMENT_GB = 16; // "at least 16 GB of GPU-accessible memory for the recommended Q4_K_M model" — docs/s2s/README.md
const CHECKPOINT_GB = 44.4; // model.safetensors, the Hugging Face checkpoint listing
line("documented GPU memory requirement", `${DOCUMENTED_REQUIREMENT_GB} GB (Q4_K_M profile)`);
line("official checkpoint size to download", `${CHECKPOINT_GB} GB before conversion`);
line("this machine's GPU", "see below — it is read from the driver, not assumed");
try {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("nvidia-smi", ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"], { encoding: "utf8" }).trim();
  line("nvidia-smi reports", out);
  const memory = Number((out.match(/(\d+)\s*MiB/) ?? [])[1]);
  if (memory) {
    const gb = memory / 1024;
    line("verdict", gb >= DOCUMENTED_REQUIREMENT_GB ? `${gb.toFixed(1)} GB — meets the documented requirement` : `${gb.toFixed(1)} GB — BELOW the documented ${DOCUMENTED_REQUIREMENT_GB} GB requirement (see RESULTS.md, route C)`);
  }
} catch {
  line("nvidia-smi", "not available");
}
try {
  const { execFileSync } = await import("node:child_process");
  execFileSync("nvcc", ["--version"], { stdio: "ignore" });
  line("CUDA toolkit (nvcc)", "present");
} catch {
  line("CUDA toolkit (nvcc)", "NOT on PATH — a source build of the local runtime would need the toolkit installed first");
}

head("Summary");
console.log(`  A real-time endpoint answered:        ${endpointAnswered ? "yes" : "no"}`);
console.log(`  NVIDIA key reaches a VoiceChat model: ${modelIds.some((id) => /voicechat|voice-chat/i.test(id)) ? "yes" : "no"}`);
console.log(`  Local inference feasible here:        see the verdict above`);
console.log("\n  Nothing here asserts that the model ran. See RESULTS.md for what was and was not tested.\n");

process.exit(endpointAnswered ? 0 : 2);
