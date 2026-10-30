#!/usr/bin/env node
/**
 * Starts the services LearnThrive AI needs (config/compose.yaml: web search, the page reader and the speech sidecar) before the website, so `npm run dev`
 * runs everything together. The tutor model is NOT one of them: Beam runs on Ollama Cloud (OLLAMA_API_KEY), so nothing here loads a model or needs a GPU. Runs as apps/web's `predev`, and as `npm run services:up`.
 *
 * - Never blocks the website: without Docker, or if a service fails, it says so and the site starts anyway (LearnThrive AI then
 *   says it is unavailable, as before).
 * - A service already running on this machine outside Docker (`npm run voice:dev`, say) is used, not duplicated.
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
const docker = (args, options = {}) => spawnSync("docker", args, { encoding: "utf8", ...options });
const answers = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
};

// The Parakeet recogniser runtime (native, on the host): the speech sidecar in Docker cannot start a Windows binary, so it reaches
// this one at host.docker.internal:8791 (config/compose.yaml). It starts nothing when a runtime already answers, and says so plainly
// when there is none to start - voice then falls back to Whisper and /health says it did.
const parakeetScript = join(dirname(fileURLToPath(import.meta.url)), "parakeet-local.mjs");
const parakeet = spawnSync(process.execPath, [parakeetScript, "start"], { encoding: "utf8", timeout: 180_000 });
for (const line of (parakeet.stdout ?? "").trim().split(/\r?\n/).filter(Boolean)) say(line.replace(/^\[parakeet\] /, ""));
if (parakeet.status !== 0) say("The Parakeet recogniser did not start (see above). Voice falls back to Whisper and says so in /health.");

const dockerUp = docker(["info", "--format", "{{.ServerVersion}}"]).status === 0;
if (!dockerUp) {
  say("Docker is not running, so web search, the page reader and the speech sidecar are not started. LearnThrive AI still answers (Beam runs on Ollama Cloud) and, with OLLAMA_API_KEY set, searches and reads pages through Ollama. Start Docker Desktop and run `npm run services:up` to start them.");
}

const running = dockerUp ? new Set(docker([...compose, "ps", "--status", "running", "--services"]).stdout?.split(/\s+/).filter(Boolean) ?? []) : new Set();
const services = [
  { name: "voice", url: "http://127.0.0.1:8765/health", label: "the speech sidecar" },
  { name: "searxng", url: "http://127.0.0.1:8888/healthz", label: "web search (SearXNG)" },
  // Page extraction. Skipped when switched off; the website falls back to a plain fetch when it is not there.
  ...(["off", "false", "0"].includes((env.CRAWL4AI_ENABLED ?? "").toLowerCase()) ? [] : [{ name: "crawl4ai", url: "http://127.0.0.1:11235/health", label: "page extraction (Crawl4AI)" }]),
];
const wanted = [];
for (const s of services) {
  if (await answers(s.url)) say(`Using ${s.label} already running on this machine (outside Docker).`);
  else if (dockerUp) wanted.push(s.name);
}

if (wanted.length) {
  const starting = wanted.filter((name) => !running.has(name));
  if (starting.length) say(`Starting ${starting.join(" and ")} in Docker (the first time builds the voice image and loads the models: a few minutes)…`);
  const up = docker([...compose, "up", "-d", "--wait", "--wait-timeout", "600", ...wanted], { stdio: "inherit" });
  if (up.status !== 0) say("A service did not start (see above). The website starts anyway; `npm run services:logs` shows why.");
}

for (const s of services) say(`${s.label}: ${(await answers(s.url)) ? `ready on ${new URL(s.url).origin}` : "NOT answering"}`);

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
