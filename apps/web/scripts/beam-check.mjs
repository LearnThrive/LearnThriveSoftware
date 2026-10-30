#!/usr/bin/env node
/**
 * Checks the REAL Beam stack the way LearnThrive AI uses it (docs/ASSISTANT.md, docs/OPENUI.md): Ollama Cloud's listing, a streamed answer, a tool call,
 * Ollama's web search and page reader, and one interactive interface. It makes real requests with OLLAMA_API_KEY from the environment (never printed, never
 * written anywhere), a few hundred tokens in all. Nothing in the test suite calls it.
 *
 *   OLLAMA_API_KEY=... npm run assistant:beam-check
 *
 * Exit 0: every check that ran passed. 1: one failed. 2: there is no key (nothing was run). A check that could not run is SKIPPED, never printed as passed.
 */
import { assistantConfig } from "../src/lib/assistant/config.ts";
import { buildProvider } from "../src/lib/assistant/providers.ts";
import { OllamaWebClient } from "../src/lib/assistant/research/ollamaWeb.ts";
import { toolsFor } from "../src/lib/assistant/tools.ts";
import { runInterface } from "../src/lib/assistant/interface.ts";
import { ActivityLog } from "../src/lib/assistant/activity.ts";
import { SYSTEM_PROMPT } from "../src/lib/assistant/prompt.ts";
import { interfacePrompt } from "../src/lib/openui/library.ts";
import { planInterface } from "../src/lib/openui/intent.ts";
import { parseStoredMessage } from "../src/lib/openui/format.ts";

if (!process.env.OLLAMA_API_KEY?.trim()) {
  console.error("OLLAMA_API_KEY is not set, so nothing was run. Put the key in your own environment (not in a committed file) and run this again.");
  process.exit(2);
}
const env = { ...process.env, NODE_ENV: "development", ASSISTANT_PROVIDER: "ollama_cloud" };
const config = assistantConfig(env);
const provider = buildProvider(config, env);
let failed = 0;
const line = (label, state, detail = "") => {
  if (state === "FAILED") failed += 1;
  console.log(`${label.padEnd(30)} ${state}${detail ? `  ${detail}` : ""}`);
};
const OPTIONS = (extra = {}) => ({ maxTokens: 700, temperature: 0.3, contextSize: config.contextSize, firstTokenTimeoutMs: 60_000, firstAnswerTimeoutMs: 120_000, idleTimeoutMs: 60_000, totalTimeoutMs: 180_000, reasoning: false, think: "off", ...extra });

async function collect(messages, options) {
  const out = { text: "", calls: [], thinking: false, done: null };
  const started = Date.now();
  let first = null;
  for await (const chunk of provider.stream(messages, options)) {
    if (chunk.type === "text") {
      first ??= Date.now() - started;
      out.text += chunk.text;
    } else if (chunk.type === "tool_call") out.calls.push(chunk.call);
    else if (chunk.type === "activity") out.thinking = true;
    else if (chunk.type === "done") out.done = chunk;
  }
  return { ...out, firstMs: first, totalMs: Date.now() - started };
}

/* ---- health -------------------------------------------------------------------------------------------------------------------------------- */
const health = await provider.health(AbortSignal.timeout(15_000));
line("Ollama Cloud, model listing", health.ok ? "HEALTHY" : "FAILED", `${config.model}: ${health.detail}`);

/* ---- a streamed answer ------------------------------------------------------------------------------------------------------------------- */
try {
  const r = await collect([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "What is 6 times 7? Answer in one short sentence." }], OPTIONS());
  const ok = /42/.test(r.text) && r.done;
  line("Streamed answer", ok ? "PASSED" : "FAILED", `first word ${r.firstMs} ms, total ${r.totalMs} ms, ${r.done?.usage.completionTokens ?? "?"} tokens${r.done?.usage.promptTokens ? "" : " (no usage reported)"}`);
} catch (error) {
  line("Streamed answer", "FAILED", `${error.code ?? "error"}: ${error.detail ?? error.message}`);
}

/* ---- reasoning is activity, never the answer ------------------------------------------------------------------------------------------ */
try {
  const r = await collect([{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "Is 391 equal to 17 times 23? Work it out, then answer yes or no in one sentence." }], OPTIONS({ reasoning: true, think: "medium", maxTokens: 700 + config.thinkingTokens }));
  line("Reasoning kept out of answer", r.text.trim() && !/\bLet me\b.{0,40}\bthink/i.test(r.text.slice(0, 60)) ? "PASSED" : "FAILED", `${r.thinking ? "the model reported thinking" : "no thinking reported"}; answer ${r.text.length} characters`);
} catch (error) {
  line("Reasoning kept out of answer", "FAILED", `${error.code ?? "error"}: ${error.detail ?? error.message}`);
}

/* ---- a tool call ----------------------------------------------------------------------------------------------------------------------- */
try {
  const tools = toolsFor(null);
  const r = await collect([{ role: "system", content: `${SYSTEM_PROMPT}\nWhen a calculation needs checking, use the tool.` }, { role: "user", content: "Please check by calculation whether 17 x 23 = 391." }], OPTIONS({ tools, maxTokens: 400 }));
  if (r.calls.length) line("Tool call", "PASSED", `asked for ${r.calls.map((c) => c.name).join(", ")} with ${JSON.stringify(r.calls[0].arguments).slice(0, 80)}`);
  else line("Tool call", "FAILED", "the model answered without calling a tool (not an error in the code, but tool use was not shown)");
} catch (error) {
  line("Tool call", "FAILED", `${error.code ?? "error"}: ${error.detail ?? error.message}`);
}

/* ---- Ollama web search and page reader ------------------------------------------------------------------------------------------------ */
const web = new OllamaWebClient({ baseUrl: config.research.ollamaBaseUrl, apiKey: process.env.OLLAMA_API_KEY, timeoutMs: 30_000, maxResults: 5, cacheTtlSeconds: 0 });
const found = await web.search("Macbeth Act 5 Scene 1 Out damned spot Lady Macbeth");
if (found.status === "ok") line("Ollama web search", "PASSED", `${found.results.length} results, first from ${new URL(found.results[0].url).hostname}`);
else line("Ollama web search", "FAILED", `${found.status}: ${found.detail}`);
if (found.status === "ok") {
  const page = await web.crawl(found.results[0].url);
  if (page.status === "ok") line("Ollama web fetch", "PASSED", `${page.text.length} characters from ${new URL(page.url).hostname}`);
  else line("Ollama web fetch", "FAILED", `${page.status}: ${page.detail}`);
} else line("Ollama web fetch", "SKIPPED", "no search result to read");

/* ---- one interactive interface ----------------------------------------------------------------------------------------------------------- */
try {
  const ask = "Quiz me on photosynthesis";
  const plan = planInterface(ask);
  const activity = new ActivityLog();
  const messages = [{ role: "system", content: `${SYSTEM_PROMPT}\n\n${interfacePrompt()}` }, { role: "user", content: `${ask}\n\n<interface-request>\n${plan.guidance}\n</interface-request>` }];
  const started = Date.now();
  const gen = runInterface({
    messages,
    generate: (prompt, options) => provider.stream(prompt, options),
    charge: async () => {},
    activity,
    research: null,
    extracts: [],
    maxRepairs: config.openui.maxRepairs,
    signal: AbortSignal.timeout(300_000),
    options: () => OPTIONS({ maxTokens: config.maxOutputTokens + config.thinkingTokens, reasoning: true, think: "low" }),
  });
  let first = null;
  for (;;) {
    const next = await gen.next();
    if (next.done) {
      const outcome = next.value;
      if (outcome.ok) {
        const stored = parseStoredMessage(outcome.content);
        line("Interactive interface", "PASSED", `${outcome.components} components, ${outcome.repairs} repair${outcome.repairs === 1 ? "" : "s"}, first draft ${outcome.firstDraft.length ? `had ${outcome.firstDraft.length} problem(s)` : "was valid"}, first content ${first ?? "?"} ms, total ${Date.now() - started} ms, ${stored.program.length} characters`);
      } else line("Interactive interface", "FAILED", `${outcome.reason}: ${outcome.issues.slice(0, 3).map((i) => i.message).join(" | ").slice(0, 300)}`);
      break;
    }
    if (next.value.type === "ui" && next.value.phase === "chunk") first ??= Date.now() - started;
  }
} catch (error) {
  line("Interactive interface", "FAILED", `${error.code ?? "error"}: ${error.detail ?? error.message}`);
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nEvery check that ran passed.");
process.exit(failed ? 1 : 0);
