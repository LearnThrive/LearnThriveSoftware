#!/usr/bin/env node
/**
 * The Parakeet recogniser runtime on this machine: NVIDIA's NeMo-Speech.cpp serving Parakeet CTC 1.1B on loopback.
 *
 * Why a separate host process: the runtime is a native program (on Windows, the verified release archive), and the speech sidecar runs
 * in a Linux Docker container under `npm run dev`. A container cannot start a Windows binary, so the runtime lives on the host and the
 * container reaches it at `http://host.docker.internal:8791` (config/compose.yaml). `npm run dev` starts it here; the sidecar also
 * adopts a runtime it finds already listening, so starting it twice is harmless.
 *
 *   node scripts/parakeet-local.mjs [start|stop|status] [--port 8791]
 *
 * Models and the runtime live in ignored folders (services/voice/{models,vendor}); docs/VOICE.md has the download steps and the
 * checksums. Nothing here downloads anything.
 */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const voiceDir = join(here, "..", "services", "voice");
const models = join(voiceDir, "models");
const vendor = join(voiceDir, "vendor");
const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("-")) ?? "start";
const at = args.indexOf("--port");
const port = Number(at >= 0 ? args[at + 1] : process.env.VOICE_PARAKEET_PORT || 8791);
const host = "127.0.0.1";
const base = `http://${host}:${port}`;
const model = join(models, process.env.VOICE_STT_MODEL || "parakeet-ctc-1.1b.q8_0.gguf");
const log = join(vendor, "parakeet.log");
const pidFile = join(vendor, "parakeet.pid");
const say = (text) => console.log(`[parakeet] ${text}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const answers = async (path = "/ready", timeout = 1500) => {
  try {
    const response = await fetch(base + path, { signal: AbortSignal.timeout(timeout) });
    return response.ok ? await response.json().catch(() => ({})) : null;
  } catch {
    return null;
  }
};

/** The best nemo-speech build under vendor/: a CUDA one before Vulkan before CPU. */
function executable() {
  if (!existsSync(vendor)) return null;
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^nemo-speech(\.exe)?$/i.test(entry.name)) found.push(full);
    }
  };
  walk(vendor);
  const rank = (p) => (p.toLowerCase().includes("cuda") ? 3 : p.toLowerCase().includes("vulkan") ? 2 : 1);
  return found.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

async function start() {
  const ready = await answers();
  if (ready) {
    say(`already serving on ${base} (${ready.device ?? "device unknown"}); nothing to start.`);
    return 0;
  }
  const exe = executable();
  if (!exe) {
    say(`no NeMo-Speech.cpp runtime under ${vendor}. docs/VOICE.md has the verified download (about 102 MB).`);
    return 0;
  }
  if (!existsSync(model)) {
    say(`no model at ${model}. docs/VOICE.md has the 1.1 GB Q8 GGUF download.`);
    return 0;
  }
  if (!existsSync(vendor)) {
    say("the vendor folder is missing");
    return 1;
  }
  const fd = openSync(log, "a");
  const child = spawn(exe, ["serve", "--asr-model", model, "--host", host, "--port", String(port), "--no-ui", "--json", "--device", "cuda:0"], {
    cwd: dirname(exe),
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
  });
  child.unref();
  closeSync(fd);
  writeFileSync(pidFile, String(child.pid));
  say(`starting Parakeet CTC 1.1B on ${base} (pid ${child.pid}); the model is 1.1 GB, so the first load takes a few seconds…`);
  for (let i = 0; i < 120; i += 1) {
    await sleep(1000);
    const state = await answers();
    if (state) {
      say(`ready on ${base} (${state.device ?? "device unknown"}).`);
      return 0;
    }
    if (child.exitCode !== null) {
      say(`it exited with ${child.exitCode}; see ${log}`);
      return 1;
    }
  }
  say(`not ready after 120 s; see ${log}`);
  return 1;
}

function stop() {
  if (!existsSync(pidFile)) {
    say("no pid file: nothing started from here (a runtime started elsewhere is left alone).");
    return 0;
  }
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  rmSync(pidFile, { force: true });
  if (!Number.isInteger(pid) || pid <= 0) {
    say("the pid file was not a process id; removed it.");
    return 0;
  }
  const alive = (() => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  })();
  if (!alive) {
    say(`pid ${pid} is already gone.`);
    return 0;
  }
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  else process.kill(pid, "SIGTERM");
  say(`stopped pid ${pid}.`);
  return 0;
}

async function status() {
  const ready = await answers();
  if (!ready) {
    say(`not answering on ${base}.`);
    return 1;
  }
  const health = (await answers("/health")) ?? {};
  say(`ready on ${base}: ${JSON.stringify({ device: ready.device ?? null, ready: ready.ready ?? true, health: health.status ?? health }) }`.replace(/\n/g, " "));
  if (existsSync(log)) say(`log: ${log} (${statSync(log).size} bytes)`);
  return 0;
}

const code = command === "stop" ? stop() : command === "status" ? await status() : await start();
process.exit(code);
