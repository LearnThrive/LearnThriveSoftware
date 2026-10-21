#!/usr/bin/env node
/**
 * Starts the services Study Buddy needs (config/compose.yaml: Ollama and the speech sidecar) before the website, so `npm run dev`
 * runs everything together. Runs as apps/web's `predev`, and as `npm run services:up`.
 *
 * - Never blocks the website: without Docker, or if a service fails, it says so and the site starts anyway (Study Buddy then
 *   says it is unavailable, as before).
 * - A service already running on this machine outside Docker (the Ollama app, `npm run voice:dev`) is used, not duplicated.
 * - Fetches the language model the first time, if it is missing.
 * - Skipped with LEARNTHRIVE_DOCKER=0 (the Playwright servers set it), in CI, and when both providers are the mock.
 */
import { spawnSync } from "node:child_process";
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
if (wanted.length) say("Docker services keep running after the site stops; `npm run services:down` stops them.");
