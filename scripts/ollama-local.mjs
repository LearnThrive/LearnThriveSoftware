#!/usr/bin/env node
/**
 * The local Ollama runtime LearnThrive AI uses on the owner's Windows laptop (docs/OLLAMA_THREE_MODEL.md).
 *
 * Two loopback-only servers, both from the same `ollama` binary and the same model directory:
 *
 *   main    127.0.0.1:11434   the tutor (vision + tools + thinking) on the RTX 3070
 *   helper  127.0.0.1:11435   the embedding and decision models, forced onto the CPU (`CUDA_VISIBLE_DEVICES=-1`)
 *
 * The helper is a separate PROCESS because `/v1/systemone` and `/api/embed` do not accept `num_gpu`: CPU placement can only be
 * scoped to a process. Two servers also mean the helper can never evict the resident tutor, which is the failure the Docker
 * arrangement had (one scheduler, one GPU).
 *
 *   node scripts/ollama-local.mjs start [--wait] [--warm] [--no-helper]
 *   node scripts/ollama-local.mjs stop
 *   node scripts/ollama-local.mjs restart [--wait]
 *   node scripts/ollama-local.mjs status [--json]
 *   node scripts/ollama-local.mjs warm [--no-helper]
 *   node scripts/ollama-local.mjs pull [models...]
 *
 * Nothing here changes a global setting: every variable is passed to one child process. The installed Ollama application (if the
 * tray app is running) owns 11434 already, and is used rather than duplicated. PID files live in `.ollama-local/` (git-ignored).
 */
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, ".ollama-local");
const env = process.env;
const argv = process.argv.slice(2);
const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "status";
const flag = (name) => argv.includes(`--${name}`);

const MAIN_PORT = Number(env.ASSISTANT_OLLAMA_PORT ?? 11434);
const HELPER_PORT = Number(env.ASSISTANT_HELPER_PORT ?? 11435);
const MAIN_HOST = `127.0.0.1:${MAIN_PORT}`;
const HELPER_HOST = `127.0.0.1:${HELPER_PORT}`;

const MODELS = {
  tutor: env.ASSISTANT_MODEL?.trim() || "bonsai-2:9b",
  vision: env.ASSISTANT_VISION_MODEL?.trim() || env.ASSISTANT_MODEL?.trim() || "bonsai-2:9b",
  embed: env.ASSISTANT_EMBED_MODEL?.trim() || "embeddinggemma-2:270m-q8_0-text",
  decision: env.ASSISTANT_DECISION_MODEL?.trim() || "laya:421m-typed-decisions-bf16",
};
const CONTEXT = Number(env.ASSISTANT_CONTEXT ?? 8192);
const KEEP_ALIVE = env.ASSISTANT_KEEP_ALIVE?.trim() || "30m";
const HELPER_KEEP_ALIVE = env.ASSISTANT_EMBED_KEEP_ALIVE?.trim() || "10m";

const say = (text) => console.log(`[ollama-local] ${text}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The binary: the runtime the owner verified (D:\OllamaRuntime\<version>), else PATH. */
function binary() {
  const explicit = env.OLLAMA_RUNTIME?.trim();
  if (explicit) {
    const candidate = explicit.endsWith("ollama.exe") || explicit.endsWith("/ollama") ? explicit : join(explicit, process.platform === "win32" ? "ollama.exe" : "ollama");
    if (existsSync(candidate)) return candidate;
    throw new Error(`OLLAMA_RUNTIME is set but ${candidate} does not exist`);
  }
  const verified = process.platform === "win32" ? "D:\\OllamaRuntime\\0.40.9\\ollama.exe" : "/usr/local/bin/ollama";
  if (existsSync(verified)) return verified;
  const found = spawnSync(process.platform === "win32" ? "where" : "which", ["ollama"], { encoding: "utf8" });
  const path = found.status === 0 ? found.stdout.split(/\r?\n/)[0]?.trim() : "";
  return path || "ollama";
}

/** The model directory Ollama already uses on this machine (so nothing is downloaded twice). */
function modelsDir() {
  const asked = env.OLLAMA_MODELS?.trim();
  if (asked) return asked;
  const known = process.platform === "win32" ? "D:\\OllamaModels" : join(process.env.HOME ?? "", ".ollama", "models");
  return existsSync(known) ? known : undefined;
}

const serverEnv = () => {
  const models = modelsDir();
  return {
    ...env,
    ...(models ? { OLLAMA_MODELS: models } : {}),
    // One model resident, one answer at a time: this is one laptop GPU (brief section 5).
    OLLAMA_NUM_PARALLEL: env.OLLAMA_NUM_PARALLEL ?? "1",
    OLLAMA_MAX_LOADED_MODELS: env.OLLAMA_MAX_LOADED_MODELS ?? "1",
    OLLAMA_KEEP_ALIVE: env.OLLAMA_KEEP_ALIVE ?? KEEP_ALIVE,
    OLLAMA_HOST: MAIN_HOST,
    ...(env.OLLAMA_FLASH_ATTENTION ? { OLLAMA_FLASH_ATTENTION: env.OLLAMA_FLASH_ATTENTION } : {}),
    ...(env.OLLAMA_KV_CACHE_TYPE ? { OLLAMA_KV_CACHE_TYPE: env.OLLAMA_KV_CACHE_TYPE } : {}),
  };
};

const helperEnv = () => ({
  ...serverEnv(),
  // Scoped to the helper process only: the main server keeps the GPU (docs: hardware/CPU selection).
  // THREE switches, because this build loads its GPU backend through Vulkan, which CUDA_VISIBLE_DEVICES does not hide: measured
  // on 2026-10-23, the helper was still taking ~800 MiB of VRAM until OLLAMA_VULKAN=0 was added (docs/OLLAMA_THREE_MODEL.md).
  CUDA_VISIBLE_DEVICES: "-1",
  HIP_VISIBLE_DEVICES: "-1",
  GGML_VK_VISIBLE_DEVICES: "-1",
  OLLAMA_VULKAN: "0",
  OLLAMA_HOST: HELPER_HOST,
  // Two helper roles share this process: the embedding model and the decision model must not evict each other every turn.
  OLLAMA_MAX_LOADED_MODELS: "2",
});

async function get(url, ms = 2000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function post(url, body, ms = 5000) {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, json, text: text.slice(0, 400) };
  } catch (error) {
    return { ok: false, status: 0, json: null, text: String(error?.message ?? error).slice(0, 200) };
  }
}

const pidFile = (name) => join(STATE, `${name}.pid`);
const logFile = (name) => join(STATE, `${name}.log`);

function readPid(name) {
  try {
    const pid = Number(readFileSync(pidFile(name), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writePid(name, pid) {
  mkdirSync(STATE, { recursive: true });
  writeFileSync(pidFile(name), String(pid));
}

function clearPid(name) {
  rmSync(pidFile(name), { force: true });
}

async function startOne(name, host, childEnv, log) {
  const version = await get(`http://${host}/api/version`, 1500);
  if (version) {
    const pid = readPid(name);
    return { name, host, started: false, version: version.version, note: pid && alive(pid) ? "already running (ours)" : "already running (another Ollama owns this port; left alone)" };
  }
  const previous = readPid(name);
  if (previous && alive(previous)) {
    return { name, host, started: false, version: null, note: `pid ${previous} is alive but ${host} does not answer: run \`node scripts/ollama-local.mjs stop\`` };
  }
  mkdirSync(STATE, { recursive: true });
  const fd = openSync(logFile(name), "a");
  const child = spawn(binary(), ["serve"], { detached: true, stdio: ["ignore", fd, fd], env: childEnv, windowsHide: true });
  child.unref();
  closeSync(fd);
  writePid(name, child.pid);
  // Ready only when the server answers, not when the process exists.
  for (let waited = 0; waited < 60_000; waited += 500) {
    if (await get(`http://${host}/api/version`, 1000)) {
      const asked = await get(`http://${host}/api/version`, 1000);
      return { name, host, started: true, pid: child.pid, version: asked?.version ?? null };
    }
    if (!alive(child.pid)) break;
    await sleep(500);
  }
  return { name, host, started: false, pid: child.pid, version: null, note: `did not answer on ${host}; see ${logFile(name)}` };
}

async function version(exe) {
  const out = spawnSync(exe, ["--version"], { encoding: "utf8" });
  return `${out.stdout ?? ""}${out.stderr ?? ""}`.trim().split(/\r?\n/).pop() ?? "unknown";
}

async function start() {
  const results = [];
  results.push(await startOne("main", MAIN_HOST, serverEnv(), "main"));
  if (!flag("no-helper")) results.push(await startOne("helper", HELPER_HOST, helperEnv(), "helper"));
  for (const r of results) say(`${r.name}: ${r.started ? `started (pid ${r.pid})` : r.note ?? "not started"} on ${r.host}${r.version ? `, server ${r.version}` : ""}`);
  const models = await get(`http://${MAIN_HOST}/api/tags`, 5000);
  const have = new Set((models?.models ?? []).map((m) => m.name));
  const missing = [MODELS.tutor, MODELS.vision, MODELS.embed, MODELS.decision].filter((m) => m && !have.has(m) && !have.has(`${m}:latest`));
  if (missing.length) say(`not downloaded yet: ${missing.join(", ")} (run: node scripts/ollama-local.mjs pull)`);
  if (flag("warm")) await warm();
  return results;
}

async function warm() {
  const started = Date.now();
  const tutor = await post(`http://${MAIN_HOST}/api/chat`, {
    model: MODELS.tutor,
    stream: false,
    keep_alive: KEEP_ALIVE,
    messages: [{ role: "user", content: "Reply with the word ready." }],
    // EXACTLY the options the app sends: a different num_ctx forces a full reload (the previous warm-up's bug).
    options: { num_ctx: CONTEXT, num_predict: 8, temperature: 0 },
  }, 300_000);
  say(`tutor ${MODELS.tutor} @ num_ctx ${CONTEXT}: ${tutor.ok ? `warm in ${((Date.now() - started) / 1000).toFixed(1)} s` : `failed (${tutor.status || "no answer"}) ${tutor.text}`}`);
  if (flag("no-helper")) return;
  const embed = await post(`http://${HELPER_HOST}/api/embed`, { model: MODELS.embed, input: "ready", keep_alive: HELPER_KEEP_ALIVE }, 120_000);
  say(`embeddings ${MODELS.embed}: ${embed.ok ? "warm" : `failed (${embed.status || "no answer"}) ${embed.text}`}`);
  const decision = await post(`http://${HELPER_HOST}/v1/systemone`, {
    model: MODELS.decision,
    state: "The student asks: what is 2 + 2?",
    questions: { intent: { type: "choice", instructions: "Choose the workflow.", criteria: { general_chat: "A greeting or short question.", explain_question: "Asks for a worked explanation of a question." } } },
    keep_alive: HELPER_KEEP_ALIVE,
  }, 120_000);
  say(`decisions ${MODELS.decision}: ${decision.ok ? "warm" : `failed (${decision.status || "no answer"}) ${decision.text}`}`);
}

async function stop() {
  for (const name of ["helper", "main"]) {
    const pid = readPid(name);
    if (!pid) {
      say(`${name}: no pid file (nothing started by this script)`);
      continue;
    }
    if (!alive(pid)) {
      clearPid(name);
      say(`${name}: was not running`);
      continue;
    }
    // Only the recorded process tree: never a name pattern (the agent's own command line can contain the same words).
    const killed = process.platform === "win32" ? spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { encoding: "utf8" }) : spawnSync("kill", ["-TERM", String(pid)], { encoding: "utf8" });
    if (killed.status === 0 || !alive(pid)) {
      clearPid(name);
      say(`${name}: stopped (pid ${pid})`);
    } else say(`${name}: could not stop pid ${pid}: ${(killed.stderr ?? "").trim()}`);
  }
}

async function status() {
  const json = flag("json");
  const exe = binary();
  const main = await get(`http://${MAIN_HOST}/api/version`, 2000);
  const helper = await get(`http://${HELPER_HOST}/api/version`, 2000);
  const ps = main ? await get(`http://${MAIN_HOST}/api/ps`, 5000) : null;
  const helperPs = helper ? await get(`http://${HELPER_HOST}/api/ps`, 5000) : null;
  const tags = main ? await get(`http://${MAIN_HOST}/api/tags`, 5000) : null;
  const gpu = spawnSync("nvidia-smi", ["--query-gpu=memory.total,memory.used,memory.free,temperature.gpu,power.draw,utilization.gpu", "--format=csv,noheader,nounits"], { encoding: "utf8" });
  const report = {
    client: await version(exe),
    binary: exe,
    modelsDirectory: modelsDir() ?? "(server default)",
    main: { host: MAIN_HOST, listening: Boolean(main), server: main?.version ?? null, pid: readPid("main"), loaded: (ps?.models ?? []).map((m) => ({ name: m.name, sizeVram: m.size_vram ?? null, context: m.context_length ?? null, keepAlive: m.expires_at ?? null })) },
    helper: { host: HELPER_HOST, listening: Boolean(helper), server: helper?.version ?? null, pid: readPid("helper"), loaded: (helperPs?.models ?? []).map((m) => ({ name: m.name, sizeVram: m.size_vram ?? null, context: m.context_length ?? null })) },
    installed: (tags?.models ?? []).map((m) => ({ name: m.name, bytes: m.size, digest: m.digest })),
    gpu: gpu.status === 0 ? gpu.stdout.trim().split(/\r?\n/).map((line) => line.split(",").map((v) => v.trim())) : null,
  };
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  say(`client ${report.client} (${report.binary})`);
  say(`models: ${report.modelsDirectory}`);
  for (const role of ["main", "helper"]) {
    const s = report[role];
    say(`${role}: ${s.listening ? `up (server ${s.server}) on ${s.host}` : `DOWN on ${s.host}`}${s.pid ? `, pid ${s.pid}` : ""}`);
    for (const m of s.loaded) say(`   loaded ${m.name}${m.context ? ` ctx ${m.context}` : ""}${m.sizeVram !== null ? ` vram ${(m.sizeVram / 1048576).toFixed(0)} MiB` : ""}`);
  }
  if (report.gpu) say(`gpu (total, used, free MiB; temp; power W; util %): ${report.gpu.map((r) => r.join(" / ")).join(" | ")}`);
  const installed = new Set(report.installed.map((m) => m.name));
  for (const [role, model] of Object.entries(MODELS)) say(`role ${role}: ${model} ${installed.has(model) || installed.has(`${model}:latest`) ? "installed" : "MISSING (pull)"}`);
  return report;
}

async function pull() {
  const exe = binary();
  const asked = argv.slice(1).filter((a) => !a.startsWith("--"));
  const models = asked.length ? asked : [...new Set([MODELS.tutor, MODELS.vision, MODELS.embed, MODELS.decision])];
  const main = await get(`http://${MAIN_HOST}/api/version`, 1500);
  // Pull through whichever server is listening (they share the model directory); a client-only pull needs no server.
  const host = main ? MAIN_HOST : null;
  for (const model of models) {
    say(`pulling ${model}${host ? ` via ${host}` : " (no server: client pull)"}…`);
    const child = spawn(exe, ["pull", model], { stdio: "inherit", env: { ...serverEnv(), ...(host ? { OLLAMA_HOST: host } : {}) } });
    const code = await new Promise((r) => child.on("exit", r));
    if (code !== 0) say(`${model}: pull failed (exit ${code})`);
  }
}

const commands = { start, stop, restart: async () => (await stop(), await start()), status, warm, pull };
const run = commands[command] ?? status;
try {
  await run();
} catch (error) {
  console.error(`[ollama-local] ${error?.message ?? error}`);
  process.exitCode = 1;
}
