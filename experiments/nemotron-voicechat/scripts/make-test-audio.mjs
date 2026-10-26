#!/usr/bin/env node
/**
 * Turns the phrases in testcases/conversations.json into WAV files, so a run can be repeated with the same audio.
 *
 * It uses LearnThrive AI's EXISTING development speech sidecar (services/voice, Piper) as a synthesiser and starts
 * nothing itself. If that sidecar is not running, this exits with instructions instead of starting it: the experiment
 * must not bring the app's services up or down behind the operator's back.
 *
 * The audio is SYNTHETIC (a text-to-speech voice, never a child, never a real recording). Say so in any results.
 *
 *   cd services/voice && uv run python server.py          # in another terminal, if you want this
 *   node scripts/make-test-audio.mjs --tts http://127.0.0.1:8765
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};

const TTS = flag("tts", process.env.VOICE_URL ?? "http://127.0.0.1:8765");
const TOKEN = process.env.VOICE_TOKEN ?? "";
const OUT = path.join(ROOT, "results", "audio");

const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "testcases", "conversations.json"), "utf8"))
  .groups.flatMap((group) => group.cases.map((testCase) => ({ group: group.id, ...testCase })));

const health = await fetch(`${TTS}/health`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
if (!health?.ok) {
  console.error(`No speech sidecar is answering at ${TTS}.`);
  console.error(`LearnThrive AI already has one; start it in its own terminal if you want synthetic audio:`);
  console.error(`  cd services/voice && uv run python server.py`);
  console.error(`Nothing was started or stopped by this script. Speak the phrases yourself instead — see docs/DEMO_TEST_PLAN.md.`);
  process.exit(2);
}
const loaded = await health.json().catch(() => ({}));
console.log(`Using the existing sidecar: tts voice ${loaded.tts?.voice ?? "unknown"} at ${TTS}`);

fs.mkdirSync(OUT, { recursive: true });
let written = 0;
for (const testCase of cases) {
  // A "..." in a phrase marks a pause for the evaluator, not something to synthesise as words.
  const text = testCase.say.replace(/\.\.\./g, ",").replace(/\(.*?\)/g, "").trim();
  const response = await fetch(`${TTS}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(TOKEN ? { "x-voice-token": TOKEN } : {}) },
    body: JSON.stringify({ text }),
  }).catch((error) => ({ ok: false, status: 0, statusText: String(error.message ?? error) }));
  if (!response.ok) {
    console.error(`  ${testCase.id}: failed (${response.status} ${response.statusText ?? ""})`);
    continue;
  }
  const wav = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(OUT, `${testCase.group}-${testCase.id}.wav`), wav);
  written += 1;
  console.log(`  ${testCase.group}-${testCase.id}: ${wav.length} bytes — "${text.slice(0, 60)}"`);
}

console.log(`\n${written} of ${cases.length} phrases written to ${path.relative(ROOT, OUT)}.`);
console.log(`Synthetic speech: a text-to-speech voice, never a child, never a real recording.`);
