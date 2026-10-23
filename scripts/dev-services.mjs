#!/usr/bin/env node
/**
 * Starts the services Study Buddy needs (config/compose.yaml: Ollama and the speech sidecar) before the website, so `npm run dev`
 * runs everything together. Runs as apps/web's `predev`, and as `npm run services:up`.
 *
 * - Never blocks the website: without Docker, or if a service fails, it says so and the site starts anyway (Study Buddy then
 *   says it is unavailable, as before).
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

if (docker(["info", "--format", "{{.ServerVersion}}"]).status !== 0) {
  say("Docker is not running, so Study Buddy's model and voice are not started. Start Docker Desktop, then run `npm run services:up`.");
  process.exit(0);
}

const running = new Set(docker([...compose, "ps", "--status", "running", "--services"]).stdout?.split(/\s+/).filter(Boolean) ?? []);
const services = [
  { name: "ollama", url: "http://127.0.0.1:11434/api/version", label: "Ollama" },
  { name: "voice", url: "http://127.0.0.1:8765/health", label: "the speech sidecar" },
];
const wanted = [];
for (const s of services) {
  if (!running.has(s.name) && (await answers(s.url))) say(`Using ${s.label} already running on this machine (outside Docker).`);
  else wanted.push(s.name);
}

if (wanted.length) {
  const starting = wanted.filter((name) => !running.has(name));
  if (starting.length) say(`Starting ${starting.join(" and ")} in Docker (the first time builds the voice image and loads the models: a few minutes)…`);
  const up = docker([...compose, "up", "-d", "--wait", "--wait-timeout", "600", ...wanted], { stdio: "inherit" });
  if (up.status !== 0) say("A service did not start (see above). The website starts anyway; `npm run services:logs` shows why.");
}

// The language model, fetched once if it is missing (about 6.6 GB for the default).
const model = env.ASSISTANT_MODEL || "qwen3.5:9b";
const tags = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
if (tags && !tags.models?.some((m) => m.name === model || m.name === `${model}:latest`)) {
  say(`Downloading the model ${model} (once)…`);
  const pull = wanted.includes("ollama") ? docker([...compose, "exec", "ollama", "ollama", "pull", model], { stdio: "inherit" }) : spawnSync("ollama", ["pull", model], { stdio: "inherit" });
  if (pull.status !== 0) say(`Could not download ${model}. Study Buddy needs it: run \`ollama pull ${model}\`.`);
}
for (const s of services) say(`${s.label}: ${(await answers(s.url)) ? `ready on ${new URL(s.url).origin}` : "NOT answering"}`);

// Load the model into the GPU now, in the background, so the first question (especially one with a photo) does not have to wait for it: loading
// takes minutes when the model files are on a Windows drive mounted into Docker. A detached process, so neither the site nor this script waits.
if ((await answers("http://127.0.0.1:11434/api/version")) && tags?.models?.some((m) => m.name === model || m.name === `${model}:latest`)) {
  const warm = `fetch("http://127.0.0.1:11434/api/generate",{method:"POST",body:JSON.stringify({model:${JSON.stringify(model)},prompt:"",stream:false,keep_alive:"30m"}),signal:AbortSignal.timeout(900000)}).catch(()=>{})`;
  spawn(process.execPath, ["-e", warm], { detached: true, stdio: "ignore" }).unref();
  say(`Loading ${model} in the background (the first answer is slow until it has loaded).`);
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
