#!/usr/bin/env node
/**
 * Starts the services Study Buddy needs (config/compose.yaml: Ollama and the speech sidecar) before the website, so `npm run dev`
 * runs everything together. Runs as apps/web's `predev`, and as `npm run services:up`.
 *
 * - Never blocks the website: without Docker, or if a service fails, it says so and the site starts anyway (Study Buddy then
 *   says it is unavailable, as before).
 * - The model server is the NATIVE Ollama runtime when it is installed (`scripts/ollama-local.mjs`: the GPU tutor on 11434, a
 *   CPU-only helper on 11435). Docker's Ollama is only the fallback: its bind mount of D:\OllamaModels through WSL made a cold
 *   load take 215-251 s (docs/OLLAMA_THREE_MODEL.md), which is the timeout the owner actually saw.
 * - A service already running on this machine outside Docker (the Ollama app, `npm run voice:dev`) is used, not duplicated.
 * - Fetches the language model the first time, if it is missing.
 * - Also starts the LOCAL SUPABASE stack (supabase/config.toml), unless LEARNTHRIVE_SUPABASE=0. Whether the site USES it is separate: the
 *   site keeps its in-memory accounts unless started with `npm run dev:supabase` (LEARNTHRIVE_SUPABASE_USE=1), because the in-memory
 *   test helpers (the "tester" account) exist only on the in-memory backend.
 * - Skipped with LEARNTHRIVE_DOCKER=0 (the Playwright servers set it), in CI, and when both providers are the mock.
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;
if (env.LEARNTHRIVE_DOCKER === "0" || env.CI || (env.ASSISTANT_PROVIDER === "mock" && env.VOICE_PROVIDER === "mock")) process.exit(0);

const compose = ["compose", "-f", join(dirname(fileURLToPath(import.meta.url)), "..", "config", "compose.yaml")];
const say = (text) => console.log(`[services] ${text}`);
const docker = (args, options = {}) => spawnSync("docker", args, { encoding: "utf8", env: { ...env, OLLAMA_MODELS_DIR: env.OLLAMA_MODELS_DIR ?? env.OLLAMA_MODELS }, ...options });
const answers = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};

// The native runtime first: one process for the GPU tutor, one CPU-only process for the helpers. It reuses the model directory
// Ollama already uses, so nothing is downloaded twice, and it refuses to start a second listener on a port that answers.
const nativeScript = join(dirname(fileURLToPath(import.meta.url)), "ollama-local.mjs");
const native = spawnSync(process.execPath, [nativeScript, "start"], { encoding: "utf8", timeout: 120_000 });
const nativeOk = native.status === 0 && (await answers("http://127.0.0.1:11434/api/version"));
if (native.status === 0) for (const line of (native.stdout ?? "").trim().split(/\r?\n/).filter(Boolean)) say(line.replace(/^\[ollama-local\] /, ""));
else say(`The native Ollama runtime did not start (${(native.stderr ?? "").trim().split(/\r?\n/).at(-1) ?? "see above"}).`);

const dockerUp = docker(["info", "--format", "{{.ServerVersion}}"]).status === 0;
if (!nativeOk && !dockerUp) {
  say("No native Ollama runtime answered and Docker is not running, so Study Buddy's model is not started. Install the runtime (docs/OLLAMA_THREE_MODEL.md) or start Docker Desktop, then run `npm run services:up`.");
}

const running = dockerUp ? new Set(docker([...compose, "ps", "--status", "running", "--services"]).stdout?.split(/\s+/).filter(Boolean) ?? []) : new Set();
const services = [
  { name: "ollama", url: "http://127.0.0.1:11434/api/version", label: "Ollama" },
  { name: "voice", url: "http://127.0.0.1:8765/health", label: "the speech sidecar" },
  { name: "searxng", url: "http://127.0.0.1:8888/healthz", label: "web search (SearXNG)" },
  // Page extraction. Skipped when switched off; the website falls back to a plain fetch when it is not there.
  ...(["off", "false", "0"].includes((env.CRAWL4AI_ENABLED ?? "").toLowerCase()) ? [] : [{ name: "crawl4ai", url: "http://127.0.0.1:11235/health", label: "page extraction (Crawl4AI)" }]),
];
const wanted = [];
for (const s of services) {
  if (await answers(s.url)) say(`Using ${s.label} already running on this machine (${s.name === "ollama" ? "native runtime or another app" : "outside Docker"}).`);
  else if (dockerUp) wanted.push(s.name);
}

if (wanted.length) {
  const starting = wanted.filter((name) => !running.has(name));
  if (starting.length) say(`Starting ${starting.join(" and ")} in Docker (the first time builds the voice image and loads the models: a few minutes)…`);
  const up = docker([...compose, "up", "-d", "--wait", "--wait-timeout", "600", ...wanted], { stdio: "inherit" });
  if (up.status !== 0) say("A service did not start (see above). The website starts anyway; `npm run services:logs` shows why.");
}

// The models: three roles. Each is fetched once if missing. The tutor is the only GPU model; the helpers live on 11435.
const models = [env.ASSISTANT_MODEL || "bonsai-2:9b", env.ASSISTANT_EMBED_MODEL || "embeddinggemma-2:270m-q8_0-text", env.ASSISTANT_DECISION_MODEL || "laya:421m-typed-decisions-bf16"];
const tags = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
const have = new Set((tags?.models ?? []).map((m) => m.name));
for (const model of [...new Set(models)]) {
  if (!tags || have.has(model) || have.has(`${model}:latest`)) continue;
  say(`Downloading ${model} (once)…`);
  const pull = wanted.includes("ollama") ? docker([...compose, "exec", "ollama", "ollama", "pull", model], { stdio: "inherit" }) : spawnSync(process.execPath, [nativeScript, "pull", model], { stdio: "inherit" });
  if (pull.status !== 0) say(`Could not download ${model}. Study Buddy needs it: run \`node scripts/ollama-local.mjs pull ${model}\`.`);
}
for (const s of services) say(`${s.label}: ${(await answers(s.url)) ? `ready on ${new URL(s.url).origin}` : "NOT answering"}`);

// Prepare the models in the background, with EXACTLY the options a turn uses. The previous warm-up sent keep_alive but not
// num_ctx, so the model was "loaded" at the default context and the first real request reloaded it (251 s, measured). This runs
// detached: neither the site nor this script waits, and next dev reloads cannot start a second load (warmup.ts deduplicates too).
if (await answers("http://127.0.0.1:11434/api/version")) {
  spawn(process.execPath, [nativeScript, "warm"], { detached: true, stdio: "ignore" }).unref();
  say(`Preparing ${env.ASSISTANT_MODEL || "bonsai-2:9b"} at the app's context in the background (it answers "preparing" until it is resident).`);
}

// The local Supabase stack. `supabase start` returns once every service is healthy; the images are cached after the first run.
if (env.LEARNTHRIVE_SUPABASE !== "0") {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const supabase = (args, options = {}) => spawnSync(`npx supabase ${args}`, { shell: true, encoding: "utf8", cwd: root, ...options });
  const isUp = () => {
    const status = supabase("status --output json");
    return status.status === 0 && /"API_URL"/.test(status.stdout ?? "");
  };
  if (isUp()) say("Supabase: the local stack is already running.");
  else {
    say("Starting the local Supabase stack (the first time pulls the images: a few minutes)…");
    const start = supabase("start", { stdio: "inherit" });
    if (start.status !== 0) say("Supabase did not start (see above). The website starts anyway; try `npm run supabase:start` to see why.");
  }
  if (isUp()) {
    say("Supabase: ready (API http://127.0.0.1:54321, Studio :54323, mail catcher :54324).");
    say(env.LEARNTHRIVE_SUPABASE_USE === "1" ? "Supabase: the site will use it (accounts, Library and storage are real)." : "Supabase: the site keeps its in-memory accounts; use `npm run dev:supabase` to point the site at it.");
    say("Supabase: WARNING, the stack listens on every network interface and serves a keyless SQL endpoint (docs/SUPABASE_REAL_STACK.md). Do not use it on a public network; `npm run services:down` stops it.");
  } else say("Supabase: NOT running.");
}
say("These keep running after the site stops; `npm run services:down` stops them all.");
