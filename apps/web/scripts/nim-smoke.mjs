#!/usr/bin/env node
/**
 * A minimal LIVE check of the developer picker's hosted models on NVIDIA's catalogue (docs/ASSISTANT.md, "Model picker"). It proves the wiring,
 * not the teaching: for each model it lists the catalogue (no generation), asks one tiny question, and runs one tool round, then prints what it
 * actually observed: the model id that was SENT, whether the stream finished, whether hidden reasoning stayed out of the answer, and the usage.
 * Three short requests per model at most, with a small reasoning allowance, so it costs very little of the trial.
 *
 *   npm run assistant:nim-smoke                         every model in ASSISTANT_NIM_MODELS (or both, if it is unset)
 *   npm run assistant:nim-smoke -- --model step-5-preview
 *
 * Needs NVIDIA_API_KEY (read from the environment, or apps/web/.env / .env.local). Synthetic prompts only. Exit code 0: every check that ran
 * passed. 1: one failed. A check that could not run is SKIPPED, never passed.
 */
import { existsSync } from "node:fs";
import { HOSTED_MODELS, hostedProfile } from "../src/lib/assistant/models.ts";
import { buildHostedProvider } from "../src/lib/assistant/providers.ts";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);

const args = process.argv.slice(2);
const only = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
const env = { ...process.env, NODE_ENV: "development" };
let failed = 0;
const line = (label, state, detail = "") => {
  if (state === "FAILED") failed += 1;
  console.log(`${label.padEnd(44)} ${state}${detail ? `  ${detail}` : ""}`);
};

if (!env.NVIDIA_API_KEY?.trim()) {
  line("NVIDIA_API_KEY", "SKIPPED", "not set: nothing was sent. Set it in apps/web/.env.local and run again.");
  process.exit(0);
}

const listed = (env.ASSISTANT_NIM_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const profiles = (only ? [hostedProfile(only)].filter(Boolean) : HOSTED_MODELS.filter((m) => !listed.length || listed.includes(m.model) || listed.includes(m.choice)));
if (!profiles.length) {
  line("models", "FAILED", `no model matches ${only ?? "ASSISTANT_NIM_MODELS"}`);
  process.exit(1);
}

const OPTS = { maxTokens: 200, temperature: 0.2, contextSize: 8192, firstTokenTimeoutMs: 90_000, firstAnswerTimeoutMs: 180_000, idleTimeoutMs: 90_000, totalTimeoutMs: 240_000 };
const TOOL = { name: "check_calculation", description: "Evaluates an arithmetic expression exactly and returns the value.", parameters: { type: "object", properties: { expression: { type: "string", description: "e.g. 17*23" } }, required: ["expression"] } };

async function run(provider, messages, options) {
  const sent = [];
  const out = { text: "", thinking: 0, calls: [], done: null, error: null, sent };
  try {
    for await (const chunk of provider.stream(messages, options)) {
      if (chunk.type === "text") out.text += chunk.text;
      else if (chunk.type === "activity" && chunk.kind === "thinking") out.thinking += 1;
      else if (chunk.type === "tool_call") out.calls.push(chunk.call);
      else if (chunk.type === "done") out.done = chunk;
    }
  } catch (error) {
    out.error = `${error.code ?? "error"}${error.detail ? ` (${error.detail})` : ""}`;
  }
  return out;
}

for (const profile of profiles) {
  const requests = [];
  const recording = async (url, init) => {
    if (init?.body) requests.push(JSON.parse(init.body).model);
    return fetch(url, init);
  };
  // A small reasoning allowance: enough to finish a one-line question, little of the trial.
  const provider = buildHostedProvider(profile, env, { reasoningTokens: 2048, fetch: recording });
  console.log(`\n${profile.label} (${profile.model})`);
  const health = await provider.health();
  line("  catalogue lists the model", health.ok ? "PASSED" : "FAILED", health.ok ? "" : health.detail);
  if (!health.ok && health.detail === "unauthorised") continue;

  const plain = await run(provider, [{ role: "system", content: "You are a concise maths tutor." }, { role: "user", content: "What is 6 times 7? Reply with the number only." }], { ...OPTS, reasoning: false, think: "off" });
  line("  request names this model", requests[0] === profile.model ? "PASSED" : "FAILED", `sent ${requests[0] ?? "nothing"}`);
  line("  answer streamed and finished", plain.done && !plain.error ? "PASSED" : "FAILED", plain.error ?? `${plain.done?.stats.totalMs ?? "?"} ms, first answer ${plain.done?.stats.firstAnswerMs ?? "?"} ms`);
  if (plain.done) {
    line("  attributed to the model sent", plain.done.model === profile.model ? "PASSED" : "FAILED", plain.done.model);
    line("  answer is correct and holds no reasoning", /\b42\b/.test(plain.text) && plain.text.length < 80 ? "PASSED" : "FAILED", JSON.stringify(plain.text.slice(0, 80)));
    line("  reasoning reported separately", plain.thinking > 0 ? "OBSERVED" : "NONE SEEN", `${plain.thinking} activity event(s)${profile.alwaysReasons ? " (this model always reasons)" : ""}`);
    line("  usage reported", plain.done.usage.completionTokens > 0 ? "PASSED" : "NOT REPORTED", JSON.stringify(plain.done.usage));
  }

  const ask = [{ role: "system", content: "Use the check_calculation tool for arithmetic, then state the result." }, { role: "user", content: "What is 17 times 23?" }];
  const first = await run(provider, ask, { ...OPTS, tools: [TOOL], reasoning: false, think: "off" });
  const call = first.calls[0];
  if (first.error) line("  tool round: call", "FAILED", first.error);
  else if (!call) line("  tool round: call", "SKIPPED", `the model answered without the tool: ${JSON.stringify(first.text.slice(0, 60))}`);
  else {
    line("  tool round: call", call.name === TOOL.name ? "PASSED" : "FAILED", `${call.name}(${JSON.stringify(call.arguments)})`);
    const second = await run(provider, [...ask, { role: "assistant", content: "", toolCalls: [call] }, { role: "tool", toolName: call.name, toolCallId: call.id, content: "391" }], { ...OPTS, reasoning: false, think: "off" });
    line("  tool round: result used", !second.error && /391/.test(second.text) ? "PASSED" : "FAILED", second.error ?? JSON.stringify(second.text.slice(0, 80)));
  }
  console.log(`  requests made: ${requests.length}`);
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nEvery check that ran passed. This proves the wiring, not the quality of the answers.");
process.exit(failed ? 1 : 0);
