import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment, quiet } from "./_routeHelpers.mjs";

// The developer model picker and the hosted NVIDIA models (docs/ASSISTANT.md, "Model picker"): which model a request really goes to, how a
// reasoning model's stream is read, who may choose, and what a turn reports. Every network call here is a fake: these tests prove the code's
// behaviour, NOT that NVIDIA's service is up (that is `npm run assistant:nim-smoke`, with a real key).

const own = (clientId, studentId = null) => ({ clientId, studentId });
const types = loadTsFrom(import.meta.url, "../src/lib/assistant/types.ts");
const models = loadTsFrom(import.meta.url, "../src/lib/assistant/models.ts");
const openaiLib = loadTsFrom(import.meta.url, "../src/lib/assistant/openai.ts");
const { OpenAiCompatibleProvider } = openaiLib;
const { buildProvider, buildHostedProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/providers.ts");
const selection = loadTsFrom(import.meta.url, "../src/lib/assistant/selection.ts");
const svc = loadTsFrom(import.meta.url, "../src/lib/assistant/service.ts");
const cfgLib = loadTsFrom(import.meta.url, "../src/lib/assistant/config.ts");
const rt = loadTsFrom(import.meta.url, "../src/lib/assistant/runtime.ts");
const h = loadTsFrom(import.meta.url, "../src/lib/assistant/handlers.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { MemoryAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/memoryAuth.ts");
const { SignInLockout } = loadTsFrom(import.meta.url, "../src/lib/account/lockout.ts");
const session = loadTsFrom(import.meta.url, "../src/lib/account/session.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

const MINIMAX = "minimaxai/minimax-m3.1-flash";
const STEP = "stepfun-ai/step-5-preview";
const OPTS = { maxTokens: 1000, temperature: 0.4, contextSize: 8192, firstTokenTimeoutMs: 2000, totalTimeoutMs: 5000 };
const MSGS = [{ role: "system", content: "S" }, { role: "user", content: "What is 6 x 7?" }];
const LAB_ENV = { NODE_ENV: "development", ASSISTANT_PROVIDER: "mock", NVIDIA_API_KEY: "nvapi-TEST-KEY", ASSISTANT_NIM_MODELS: `${MINIMAX},${STEP}` };

const sse = (parts, { done = true } = {}) =>
  new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(`data: ${typeof p === "string" ? p : JSON.stringify(p)}\n\n`)); if (done) c.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); c.close(); } }));
const content = (t) => ({ choices: [{ delta: { content: t } }] });
const thought = (t, field = "reasoning_content") => ({ choices: [{ delta: { [field]: t } }] });
const usage = (completion) => ({ choices: [], usage: { prompt_tokens: 10, completion_tokens: completion } });
/**
 * Like `sse`, but its parts arrive spread out in time, so a stream can keep talking for longer than a clock allows. It honours the
 * request's abort signal the way a real fetch does (its body is cancelled when the caller aborts): without that a fake stream would
 * answer through a clock that had already fired.
 */
const sseOver = (steps, signal) =>
  new Response(
    new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
        try {
          for (const [delayMs, part] of steps) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          // Aborted while this part was waiting: the reader has already been told.
        }
      },
    }),
  );

async function drain(iterable) {
  const out = { text: "", chunks: [], done: null, calls: [] };
  for await (const chunk of iterable) {
    out.chunks.push(chunk);
    if (chunk.type === "text") out.text += chunk.text;
    else if (chunk.type === "done") out.done = chunk;
    else if (chunk.type === "tool_call") out.calls.push(chunk.call);
  }
  return out;
}

/** A fake NVIDIA endpoint: records every request, answers /models with a listing and /chat/completions with `answer(body, n)`. */
function nvidia(answer, { listed = [MINIMAX, STEP] } = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/models")) return Response.json({ object: "list", data: listed.map((id) => ({ id })) });
    const body = JSON.parse(init.body);
    requests.push({ path, headers: init.headers, body });
    return answer(body, requests.length, init);
  };
  return { fetchImpl, requests };
}

const hosted = (choice, fetchImpl, env = LAB_ENV) => buildHostedProvider(models.hostedProfile(choice), env, { fetch: fetchImpl });

// ---- the model-selection defect ---------------------------------------------------------------------------------------------------------

test("selection defect: a model name that is not the provider's own (an Ollama tag from the service) never reaches NVIDIA", async () => {
  openaiLib.resetAcceptedFields();
  const fake = nvidia(() => sse([content("42")]));
  const provider = new OpenAiCompatibleProvider({ id: "nim", baseUrl: "https://integrate.api.nvidia.com/v1", apiKey: "k", model: "meta/llama-3.2-11b-vision-instruct", fetch: fake.fetchImpl });
  const out = await drain(provider.stream(MSGS, { ...OPTS, model: "bonsai-2:9b" }));
  assert.equal(fake.requests[0].body.model, "meta/llama-3.2-11b-vision-instruct", "the provider's own model, not the service's Ollama tag");
  assert.equal(out.done.model, "meta/llama-3.2-11b-vision-instruct", "and the answer is attributed to the model that was really sent");

  // The default NIM provider built from configuration: ASSISTANT_MODEL (Ollama's) is ignored, ASSISTANT_NIM_MODEL is used.
  const config = cfgLib.assistantConfig({ NODE_ENV: "development", ASSISTANT_PROVIDER: "nim", ASSISTANT_MODEL: "bonsai-2:9b" });
  const built = buildProvider(config, { NVIDIA_API_KEY: "k", ASSISTANT_NIM_MODEL: MINIMAX }, fake.fetchImpl);
  await drain(built.stream(MSGS, { ...OPTS, model: config.model }));
  assert.equal(fake.requests[1].body.model, MINIMAX);
});

test("selection defect: in an Ollama-then-NIM fallback chain, the NIM step sends its own model, never Ollama's", async () => {
  openaiLib.resetAcceptedFields();
  const fake = nvidia(() => sse([content("ok")]));
  const fetchImpl = async (url, init) => (String(url).startsWith("http://127.0.0.1:11434") ? Promise.reject(new Error("ECONNREFUSED")) : fake.fetchImpl(url, init));
  const config = cfgLib.assistantConfig({ NODE_ENV: "development", ASSISTANT_PROVIDER: "ollama,nim", ASSISTANT_MODEL: "bonsai-2:9b" });
  const chain = buildProvider(config, { NVIDIA_API_KEY: "k", ASSISTANT_NIM_MODEL: STEP }, fetchImpl);
  const out = await drain(chain.stream(MSGS, { ...OPTS, model: config.model }));
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].body.model, STEP);
  assert.equal(out.done.model, STEP);
});

// ---- the two hosted models ---------------------------------------------------------------------------------------------------------------

test("MiniMax M3.1 Flash: its id, its recommended sampling, and the effort the endpoint names, only when the turn asks for it", async () => {
  openaiLib.resetAcceptedFields();
  const fake = nvidia(() => sse([content("x")]));
  const p = hosted("minimax-m3.1-flash", fake.fetchImpl);
  await drain(p.stream(MSGS, { ...OPTS, reasoning: true, think: "high" }));
  await drain(p.stream(MSGS, { ...OPTS, reasoning: false, think: "off" }));
  // A level the developer picked in the picker travels through exactly as the endpoint names it (service.ts passes it as `think`).
  await drain(p.stream(MSGS, { ...OPTS, reasoning: true, think: "xhigh" }));
  const [hard, quick, chosen] = fake.requests.map((r) => r.body);
  assert.equal(chosen.reasoning_effort, "xhigh", "a chosen level is sent as it is named");
  assert.equal(hard.model, MINIMAX);
  assert.equal(hard.temperature, 1);
  assert.equal(hard.top_p, 0.95);
  assert.equal(hard.reasoning_effort, "high");
  assert.equal(quick.reasoning_effort, "none", "ordinary chat asks for the endpoint's own least-effort setting");
  assert.equal(quick.max_tokens, 1000, "no reasoning allowance added when it is not asked to reason");
  assert.equal(fake.requests[0].headers.Authorization, "Bearer nvapi-TEST-KEY");
  assert.ok(!JSON.stringify(fake.requests[0].body).includes("nvapi-TEST-KEY"), "the key is only in the header");
});

test("each hosted model declares the effort levels its picker offers, weakest first, and Step 5 leaves out the one it cannot honour", () => {
  assert.deepEqual(models.hostedProfile("minimax-m3.1-flash").efforts, ["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(models.hostedProfile("step-5-preview").efforts, ["minimal", "low", "medium", "high", "xhigh", "max"], "no none: it reasons whatever it is asked");
  assert.deepEqual(models.effortChoices(models.EFFORT_LEVELS).map((c) => c.id), ["auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"], "auto comes first: it is the default");
  assert.equal(models.effortChoices([]).length, 1, "a model that takes no levels still has the auto option, so its picker shows just that");
});

test("Step 5 Preview: its id, no reliance on enable_thinking, and a reasoning allowance even when the turn did not ask it to reason", async () => {
  openaiLib.resetAcceptedFields();
  const fake = nvidia(() => sse([content("x")]));
  const p = hosted("step-5-preview", fake.fetchImpl);
  await drain(p.stream(MSGS, { ...OPTS, reasoning: false, think: false }));
  const body = fake.requests[0].body;
  assert.equal(body.model, STEP);
  assert.equal(body.enable_thinking, undefined);
  assert.equal(body.chat_template_kwargs, undefined);
  assert.equal(body.reasoning_effort, "low");
  assert.equal(body.max_tokens, 1000 + models.hostedProfile("step-5-preview").reasoningTokens, "it always reasons, so it always gets room to");
});

test("reasoning is activity, never answer text: it is not yielded, and an answer that is only reasoning is an error, not a success", async () => {
  openaiLib.resetAcceptedFields();
  const fake = nvidia((_b, n) =>
    n === 1
      ? sse([thought("Let me think: 6 x 7..."), thought("so 42", "reasoning"), content("The answer is "), content("42."), usage(57)])
      : sse([thought("still thinking about it"), { choices: [{ delta: {}, finish_reason: "length" }] }, usage(16000)]),
  );
  const p = hosted("step-5-preview", fake.fetchImpl);
  const out = await drain(p.stream(MSGS, OPTS));
  assert.equal(out.text, "The answer is 42.");
  assert.ok(out.chunks.some((c) => c.type === "activity" && c.kind === "thinking"));
  assert.ok(!out.chunks.some((c) => c.type === "text" && /think|so 42/.test(c.text)), "no reasoning in the answer");
  assert.deepEqual(out.done.usage, { promptTokens: 10, completionTokens: 57 });
  await assert.rejects(() => drain(p.stream(MSGS, OPTS)), (e) => e instanceof types.ProviderError && e.code === "empty" && e.detail === "reasoning_exhausted");
});

test("a model that always reasons is judged by its work, not by time to its first word", async () => {
  openaiLib.resetAcceptedFields();
  // Short clocks keep the test quick; the shape is what the turn's own budgets do at 240 s (models.ts).
  const timed = { ...OPTS, firstTokenTimeoutMs: 5_000, firstAnswerTimeoutMs: 200, idleTimeoutMs: 5_000, totalTimeoutMs: 5_000 };
  // Step 5 Preview always reasons: its thinking outlasts the window by a wide margin before it writes anything. This is the turn that
  // failed on 26 October 2026 — 240 s of reasoning, no answer, `provider_error code=timeout` — so it is the case that must answer.
  const thinking = [
    [60, thought("weighing the essay")],
    [60, thought("comparing the two poems")],
    [140, thought("almost ready")],
  ];
  const step = hosted("step-5-preview", nvidia((_b, _n, init) => sseOver([...thinking, [60, content("The answer is 42.")], [10, usage(900)]], init.signal)).fetchImpl);
  const out = await drain(step.stream(MSGS, timed));
  assert.equal(out.text, "The answer is 42.", "the answer still comes after more than 260 ms of thinking, with a 200 ms first-answer window");
  assert.ok(out.chunks.some((c) => c.type === "activity" && c.kind === "thinking"), "and the reasoning was reported as activity, not as text");

  // A model that can be asked not to reason is unchanged: the same stream is still cut off, so nothing was loosened for it.
  const mini = hosted("minimax-m3.1-flash", nvidia((_b, _n, init) => sseOver([...thinking, [60, content("42")]], init.signal)).fetchImpl);
  await assert.rejects(() => drain(mini.stream(MSGS, timed)), (e) => e instanceof types.ProviderError && e.code === "timeout");

  // Thinking that STOPS is still a failure, so "always reasons" is not "waits forever": the idle clock ends it.
  const stalled = hosted("step-5-preview", nvidia((_b, _n, init) => sseOver([[10, thought("one thought")], [400, content("too late")]], init.signal)).fetchImpl);
  await assert.rejects(() => drain(stalled.stream(MSGS, { ...timed, idleTimeoutMs: 150 })), (e) => e instanceof types.ProviderError && e.code === "timeout");
});

test("tool calls: offered in OpenAI form, assembled from fragments, and their results sent back paired by call id", async () => {
  openaiLib.resetAcceptedFields();
  const fake = nvidia((_b, n) =>
    n === 1
      ? sse([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_abc", function: { name: "check_calc", arguments: '{"expre' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ssion":"6*7"}' } }] } }] },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ])
      : sse([content("42")]),
  );
  const p = hosted("minimax-m3.1-flash", fake.fetchImpl);
  const tools = [{ name: "check_calc", description: "d", parameters: { type: "object", properties: { expression: { type: "string" } } } }];
  const first = await drain(p.stream(MSGS, { ...OPTS, tools }));
  assert.deepEqual(first.calls, [{ id: "call_abc", name: "check_calc", arguments: { expression: "6*7" } }]);
  assert.equal(fake.requests[0].body.tools[0].type, "function");
  assert.equal(fake.requests[0].body.tools[0].function.name, "check_calc");
  await drain(p.stream([...MSGS, { role: "assistant", content: "", toolCalls: first.calls }, { role: "tool", toolName: "check_calc", toolCallId: "call_abc", content: "42" }], OPTS));
  const sent = fake.requests[1].body.messages;
  assert.equal(sent[2].tool_calls[0].id, "call_abc");
  assert.equal(sent[2].tool_calls[0].function.arguments, '{"expression":"6*7"}');
  assert.deepEqual(sent[3], { role: "tool", tool_call_id: "call_abc", content: "42" });
});

test("an option the endpoint refuses is dropped once, then remembered; other errors are named, not retried", async () => {
  openaiLib.resetAcceptedFields();
  const fake = nvidia((body) => (body.reasoning_effort ? new Response("{}", { status: 400 }) : sse([content("ok")])));
  const p = hosted("minimax-m3.1-flash", fake.fetchImpl);
  await drain(p.stream(MSGS, { ...OPTS, think: "high" }));
  assert.equal(fake.requests.length, 2, "the named effort was refused, the plain request accepted");
  assert.equal(fake.requests[1].body.reasoning_effort, undefined);
  await drain(p.stream(MSGS, { ...OPTS, think: "high" }));
  assert.equal(fake.requests.length, 3, "the next turn goes straight to the accepted form");

  const failing = (status) => hosted("step-5-preview", nvidia(() => new Response("{}", { status })).fetchImpl);
  await assert.rejects(() => drain(failing(401).stream(MSGS, OPTS)), (e) => e.code === "unavailable" && e.detail === "unauthorised");
  await assert.rejects(() => drain(failing(404).stream(MSGS, OPTS)), (e) => e.code === "unavailable" && e.detail === "model_missing");
  await assert.rejects(() => drain(failing(500).stream(MSGS, OPTS)), (e) => e.code === "unavailable" && e.detail === "http_500");
  assert.deepEqual(await hosted("step-5-preview", nvidia(() => sse([]), { listed: ["some/other-model"] }).fetchImpl).health(), { ok: false, detail: "model_missing" });
  assert.deepEqual(await hosted("step-5-preview", nvidia(() => sse([])).fetchImpl).health(), { ok: true, detail: "ok" });
});

test("cancellation: stopping mid-answer aborts the request and is reported as aborted", async () => {
  openaiLib.resetAcceptedFields();
  const p = hosted("minimax-m3.1-flash", async (_url, init) =>
    new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(content("Partial"))}\n\n`)); init.signal.addEventListener("abort", () => c.error(new Error("aborted"))); } })),
  );
  const controller = new AbortController();
  const seen = [];
  await assert.rejects(async () => {
    for await (const chunk of p.stream(MSGS, { ...OPTS, signal: controller.signal })) {
      seen.push(chunk);
      if (chunk.type === "text") controller.abort();
    }
  }, (e) => e.code === "aborted");
  assert.equal(seen.filter((c) => c.type === "text").length, 1);
});

// ---- who may choose ----------------------------------------------------------------------------------------------------------------------

test("lab settings: only listed models from the table, never in production, never without a key, and switchable off", () => {
  const s = models.modelLabSettings({ ...LAB_ENV, ASSISTANT_NIM_MODELS: `${STEP}, evil/model, https://x.example` }, ["ollama"]);
  assert.equal(s.available, true);
  assert.deepEqual(s.models.map((m) => m.model), [STEP], "an unknown id is ignored, not passed through");
  assert.equal(s.local, true);
  assert.equal(s.uploads, false, "uploads are not sent to the trial models by default");
  assert.equal(models.modelLabSettings({ ...LAB_ENV, NODE_ENV: "production" }).available, false);
  assert.equal(models.modelLabSettings({ ...LAB_ENV, NVIDIA_API_KEY: "" }).available, false);
  assert.equal(models.modelLabSettings({ ...LAB_ENV, ASSISTANT_MODEL_PICKER: "off" }).available, false);
  assert.equal(models.modelLabSettings({ ...LAB_ENV, ASSISTANT_NIM_MODELS: "" }).available, false);
  assert.equal(buildHostedProvider(models.hostedProfile("step-5-preview"), { ...LAB_ENV, NODE_ENV: "production" }), null);
  assert.equal(rt.buildModelLab(cfgLib.assistantConfig({ ...LAB_ENV, NODE_ENV: "production" }), { ...LAB_ENV, NODE_ENV: "production" }), null);
});

test("selection: only an administrator acting as themselves may choose; anything not offered is refused, never swapped for another model", () => {
  const config = cfgLib.assistantConfig(LAB_ENV);
  const lab = rt.buildModelLab(config, LAB_ENV, async () => sse([]));
  const fallback = new MockProvider({ delayMs: 0 });
  const admin = { role: "ADMIN", mode: "staff", studentId: null };
  const resolve = (requested, actor = admin, l = lab) => selection.resolveSelection({ requested, actor, lab: l, config, provider: fallback, hosted: false });

  const none = resolve(undefined, { role: "CLIENT", mode: "guardian", studentId: null });
  assert.equal(none.ok && none.target.choice, null, "no model named: the ordinary target, for anyone");
  assert.equal(none.target.provider, fallback);
  for (const actor of [{ role: "CLIENT", mode: "guardian", studentId: null }, { role: "TUTOR", mode: "staff", studentId: null }, { role: "STUDENT", mode: "learner", studentId: "s" }, { role: "CLIENT", mode: "supervised", studentId: "s" }]) {
    assert.deepEqual(resolve("step-5-preview", actor), { ok: false, reason: "model_not_allowed" }, actor.role);
  }
  assert.deepEqual(resolve("step-5-preview", admin, null), { ok: false, reason: "model_not_allowed" }, "no lab on this server (production, no key)");
  for (const bad of [STEP, "gpt-4", "local", "https://evil.example/v1", 42, { model: STEP }]) assert.equal(resolve(bad).ok ? "ok" : resolve(bad).reason, "bad_model", JSON.stringify(bad));
  const step = resolve("step-5-preview");
  assert.equal(step.target.label, "Step 5 Preview");
  assert.equal(step.target.model, STEP);
  assert.equal(step.target.provider, lab.providers.get("step-5-preview"));
  assert.equal(step.target.uploads, false);
  assert.ok(step.target.quota.requests > 0);
  const minimax = resolve("minimax-m3.1-flash");
  assert.notEqual(minimax.target.provider, step.target.provider, "two models, two providers");
  assert.equal(minimax.target.model, MINIMAX);
});

// ---- a whole turn ------------------------------------------------------------------------------------------------------------------------

async function turnWorld(t, providerFetch) {
  environment(t, {});
  quiet(t);
  openaiLib.resetAcceptedFields();
  const store = new InMemoryLibraryStore();
  const profile = store.seedProfile({ email: "dev@example.com", role: "ADMIN" });
  const clientId = await store.accounts.ensureClient(profile);
  const config = cfgLib.assistantConfig(LAB_ENV);
  const fallback = new MockProvider({ delayMs: 0 });
  const lab = rt.buildModelLab(config, LAB_ENV, providerFetch);
  const deps = (choice) => {
    const picked = selection.resolveSelection({ requested: choice, actor: { role: "ADMIN", mode: "staff", studentId: null }, lab, config, provider: fallback, hosted: false });
    assert.ok(picked.ok);
    return { store, provider: fallback, queue: new GenerationQueue(1, 4), uploads: new MemoryLibraryStorage(), config, target: picked.target, now: () => new Date("2026-10-21T10:30:00Z"), log: () => {} };
  };
  const send = async (choice, text, sessionId = null) => {
    const events = [];
    for await (const e of svc.sendMessage(deps(choice), { owner: own(clientId), sessionId, text })) events.push(e);
    return events;
  };
  return { store, clientId, fallback, send };
}

test("a turn: the chosen model answers, the answer is labelled and stored with the model the provider reported; switching changes the provider", async (t) => {
  const fake = nvidia((body) => sse([content(`Answer from ${body.model}.`), usage(12)]));
  const w = await turnWorld(t, fake.fetchImpl);
  const first = await w.send("minimax-m3.1-flash", "hello there");
  const sessionId = first[0].sessionId;
  assert.equal(first.at(-1).type, "done");
  assert.equal(first.at(-1).model, "MiniMax M3.1 Flash");
  const second = await w.send("step-5-preview", "hello there", sessionId);
  assert.equal(second.at(-1).model, "Step 5 Preview");
  assert.deepEqual(fake.requests.map((r) => r.body.model), [MINIMAX, STEP], "one request per question, to the chosen model only");
  assert.equal(w.fallback.requests.length, 0, "the default provider was never asked");
  const stored = await w.store.chat.listMessages(own(w.clientId), sessionId);
  assert.deepEqual(stored.map((m) => m.generatedBy ?? null), [null, `nim:${MINIMAX}`, null, `nim:${STEP}`], "earlier answers keep their own label");
  assert.match(stored[3].content, /stepfun-ai\/step-5-preview/);
  assert.ok(stored[2].content === "hello there", "the conversation carries on across the switch");
  assert.equal(fake.requests[1].body.messages.filter((m) => m.role === "assistant").length, 1, "the second model sees the first model's answer in the history");
});

test("a turn: a chosen model that fails is reported as that model's failure, with nothing invented and no other model answering", async (t) => {
  const w = await turnWorld(t, nvidia(() => new Response("{}", { status: 401 })).fetchImpl);
  const events = await w.send("step-5-preview", "hello there");
  const error = events.at(-1);
  assert.equal(error.type, "error");
  assert.equal(error.code, "model_unavailable");
  assert.equal(error.model, "Step 5 Preview");
  assert.equal(error.detail, "unauthorised");
  assert.ok(!events.some((e) => e.type === "delta"), "no answer was made up");
  assert.equal(w.fallback.requests.length, 0);
  const limited = await turnWorld(t, nvidia(() => new Response("{}", { status: 429, headers: { "retry-after": "1" } })).fetchImpl);
  const r = await limited.send("minimax-m3.1-flash", "hello there");
  assert.equal(r.at(-1).code, "model_rate_limited");
  const empty = await turnWorld(t, nvidia(() => sse([thought("hmm"), { choices: [{ delta: {}, finish_reason: "length" }] }])).fetchImpl);
  const e = await empty.send("step-5-preview", "hello there");
  assert.equal(e.at(-1).code, "no_answer");
  assert.equal(e.at(-1).detail, "reasoning_exhausted");
});

test("a turn: the hosted allowance counts every request and stops further ones, with the model named", async (t) => {
  const fake = nvidia(() => sse([content("ok"), usage(5)]));
  const w = await turnWorld(t, fake.fetchImpl);
  const day = new Date("2026-10-21T00:00:00Z");
  await w.send("minimax-m3.1-flash", "hello there");
  assert.equal(await w.store.chat.usageCount(w.clientId, svc.USAGE_HOSTED_REQUESTS_DAY, day), 1);
  assert.equal(await w.store.chat.usageCount(w.clientId, svc.USAGE_HOSTED_TOKENS_DAY, day), 5);
  assert.equal(await w.store.chat.usageCount(w.clientId, svc.USAGE_TOKENS_DAY, day), 0, "kept apart from the ordinary budget");
  await w.store.chat.incrementUsage(w.clientId, svc.USAGE_HOSTED_REQUESTS_DAY, day, 10_000);
  const blocked = await w.send("minimax-m3.1-flash", "hello again");
  assert.equal(blocked.at(-1).code, "model_budget");
  assert.equal(fake.requests.length, 1, "no request once the allowance is used");
});

test("a turn: a hard maths answer is held and its working checked; a wrong step is repaired by the same model before anything is shown", async (t) => {
  const fake = nvidia((body, n) =>
    sse([
      content(
        n === 1
          ? "Solve the simultaneous equations.\n\n$$x + y = 10$$\n$$x - y = 2$$\n\nAdding:\n\n$$2x = 12$$\n$$x = 7$$\n\nSo $x = 7$."
          : "Solve the simultaneous equations.\n\n$$x + y = 10$$\n$$x - y = 2$$\n\nAdding:\n\n$$2x = 12$$\n$$x = 6$$\n\nSo $x = 6$, $y = 4$.",
      ),
      usage(30),
    ]),
  );
  const w = await turnWorld(t, fake.fetchImpl);
  const events = await w.send("minimax-m3.1-flash", "Solve the simultaneous equations x + y = 10 and x - y = 2");
  const order = events.map((e) => (e.type === "status" ? e.state : e.type));
  assert.ok(order.indexOf("verifying") >= 0 && order.indexOf("verifying") < order.indexOf("delta"), "checked before any text is released");
  const shown = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
  assert.doesNotMatch(shown, /x = 7/, "the wrong step never reached the student");
  assert.match(shown, /x = 6/);
  assert.equal(fake.requests.length, 2, "one draft and one repair, by the same model");
  assert.deepEqual(fake.requests.map((r) => r.body.model), [MINIMAX, MINIMAX]);
  assert.match(fake.requests[1].body.messages.at(-1).content, /working that a calculation shows is wrong/);
  assert.equal(fake.requests[0].body.reasoning_effort, "high", "a hard problem: full reasoning");
  assert.match(shown, /did not check out by calculation/);
});

// ---- the routes --------------------------------------------------------------------------------------------------------------------------

async function routeWorld(t, env = LAB_ENV) {
  environment(t, {});
  quiet(t);
  session.resetSessionCache();
  openaiLib.resetAcceptedFields();
  const store = new InMemoryLibraryStore();
  const auth = new MemoryAccountAuth({ onUserCreated: (u) => store.seedProfile({ id: u.id, displayName: u.displayName, email: u.email }) });
  const account = { backend: "memory", auth, store, lockout: new SignInLockout(), outbox: auth.outbox, memory: store };
  const config = cfgLib.assistantConfig(env);
  const fake = nvidia((body) => sse([content(`From ${body.model}`), usage(3)]));
  const assistant = { config, provider: new MockProvider({ delayMs: 0 }), queue: new GenerationQueue(1, 4), uploads: new MemoryLibraryStorage(), hosted: false, flag: async () => {}, lab: rt.buildModelLab(config, env, fake.fetchImpl) };
  async function person(role = "CLIENT") {
    const email = `p${Math.random().toString(36).slice(2)}@example.com`;
    await auth.signUp({ email, password: "correct horse battery staple", displayName: "Pat", adultConfirmed: true });
    const map = new Map();
    const jar = { get: (n) => map.get(n), set: (n, v) => map.set(n, v), delete: (n) => map.delete(n) };
    const opened = await auth.verifyEmailLink(auth.outbox.findLast((m) => m.to === email).tokenHash, "signup");
    session.setSessionCookies(jar, opened.tokens, {});
    await store.accounts.ensureClient(opened.user.id);
    if (role === "ADMIN") store.seedProfile({ id: opened.user.id, role: "ADMIN", displayName: "Dev", email });
    else store.seedAssignment(store.seedStudent(opened.user.id), "ACTIVE");
    return { jar };
  }
  const deps = (jar) => ({ rt: account, jar, assistant, env, now: () => new Date("2026-10-21T10:30:00Z") });
  const post = (body) => new Request("http://localhost:3100/api/assistant/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const chat = async (p, body) => {
    const response = await h.handleChat(post(body), deps(p.jar));
    const text = await response.text();
    return { response, events: response.status === 200 ? text.trim().split("\n").map((l) => JSON.parse(l)) : [], body: response.status === 200 ? null : JSON.parse(text) };
  };
  const status = async (p) => (await h.handleStatus(new Request("http://localhost:3100/api/assistant/status"), deps(p.jar))).json();
  return { chat, status, person, fake, store, deps };
}

test("routes: a student or parent who sends a model is refused on the server; the status lists no models for them", async (t) => {
  const w = await routeWorld(t);
  const parent = await w.person("CLIENT");
  const refused = await w.chat(parent, { text: "hello", adultAck: true, model: "step-5-preview" });
  assert.equal(refused.response.status, 403);
  assert.equal(refused.body.code, "model_not_allowed");
  assert.equal(w.fake.requests.length, 0, "nothing reached NVIDIA");
  assert.equal((await w.chat(parent, { text: "hello", adultAck: true })).response.status, 200, "without a model, the ordinary assistant");
  const s = await w.status(parent);
  assert.equal(s.models, undefined);
});

test("routes: an administrator sees the choices with readiness, may choose, is refused an unknown model, and reopened chats keep their labels", async (t) => {
  const w = await routeWorld(t);
  const dev = await w.person("ADMIN");
  const s = await w.status(dev);
  assert.deepEqual(s.models.choices.map((c) => [c.id, c.ready]), [["minimax-m3.1-flash", true], ["step-5-preview", true]]);
  assert.equal(s.models.default, "minimax-m3.1-flash");
  assert.match(s.models.scope, /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(s).includes("nvapi"), "no key in what the page is sent");
  assert.equal((await w.chat(dev, { text: "hello", adultAck: true, model: "gpt-4" })).body.code, "bad_model");
  const first = await w.chat(dev, { text: "hello", adultAck: true, model: "step-5-preview" });
  assert.equal(first.events.at(-1).model, "Step 5 Preview");
  assert.equal(w.fake.requests.at(-1).body.model, STEP);
  const uploads = await w.chat(dev, { text: "look", sessionId: first.events[0].sessionId, fileIds: ["11111111-1111-4111-8111-111111111111"], model: "step-5-preview" });
  assert.equal(uploads.body.code, "uploads_not_sent");
  const reopened = await (await h.handleSession(new Request(`http://localhost:3100/api/assistant/sessions/${first.events[0].sessionId}`), w.deps(dev.jar), first.events[0].sessionId)).json();
  assert.equal(reopened.messages.at(-1).model, "Step 5 Preview");
});

test("routes: in production there is no picker at all, whatever the settings say", () => {
  const env = { ...LAB_ENV, NODE_ENV: "production", ASSISTANT_ENABLED: "true" };
  assert.equal(rt.buildModelLab(cfgLib.assistantConfig(env), env), null);
  assert.equal(models.modelLabSettings(env).available, false);
});

test("the picker needs only the key on a development server: unset ASSISTANT_NIM_MODELS offers both models, an empty value offers none, no key offers none", () => {
  const base = { NODE_ENV: "development", NVIDIA_API_KEY: "nvapi-TEST-KEY" };
  const open = models.modelLabSettings(base, ["ollama"]);
  assert.equal(open.available, true);
  assert.deepEqual(open.models.map((m) => m.choice), ["minimax-m3.1-flash", "step-5-preview"]);
  assert.equal(models.modelLabSettings({ ...base, ASSISTANT_NIM_MODELS: "" }).available, false);
  assert.equal(models.modelLabSettings({ NODE_ENV: "development" }).available, false, "no key, no picker");
  assert.equal(models.modelLabSettings({ ...base, NODE_ENV: "production" }).available, false, "never in production");
  assert.equal(models.modelLabSettings({ ...base, ASSISTANT_MODEL_PICKER: "off" }).available, false);
});

// ---- the reasoning-effort picker ------------------------------------------------------------------------------------------------------

test("routes: the effort list is the chosen model's own, and the level a developer picked reaches that model's request", async (t) => {
  const w = await routeWorld(t);
  const dev = await w.person("ADMIN");
  const s = await w.status(dev);
  const choice = (id) => s.models.choices.find((c) => c.id === id);
  assert.deepEqual(choice("minimax-m3.1-flash").efforts.map((e) => e.id), ["auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(choice("step-5-preview").efforts.map((e) => e.id), ["auto", "minimal", "low", "medium", "high", "xhigh", "max"]);
  assert.equal(choice("minimax-m3.1-flash").efforts[0].label, "Auto", "the page shows the level names the server sends");

  const picked = await w.chat(dev, { text: "hello", adultAck: true, model: "minimax-m3.1-flash", effort: "xhigh" });
  assert.equal(picked.response.status, 200, JSON.stringify(picked.body));
  const sent = w.fake.requests.at(-1).body;
  assert.equal(sent.reasoning_effort, "xhigh");
  assert.ok(sent.max_tokens > models.hostedProfile("minimax-m3.1-flash").maxOutputTokens, "a reasoning turn gets its allowance on top of the answer's budget");

  await w.chat(dev, { text: "hello", adultAck: true, model: "minimax-m3.1-flash", effort: "none" });
  const none = w.fake.requests.at(-1).body;
  assert.equal(none.reasoning_effort, "none");
  assert.equal(none.max_tokens, models.hostedProfile("minimax-m3.1-flash").maxOutputTokens, "asked not to reason, it gets no extra room to");

  // Auto is the default and may be sent explicitly: the question decides, as it did before the picker existed.
  const auto = await w.chat(dev, { text: "hello", adultAck: true, model: "step-5-preview", effort: "auto" });
  assert.equal(auto.response.status, 200);
  assert.equal(w.fake.requests.at(-1).body.reasoning_effort, "low", "Step 5's fast chat asks for the least it allows (its profile's own mapping)");
});

test("routes: an effort another model offers, an unknown one, a bare effort and one for the local tutor are all refused", async (t) => {
  const w = await routeWorld(t, { ...LAB_ENV, ASSISTANT_PROVIDER: "ollama" });
  const dev = await w.person("ADMIN");
  const choices = (await w.status(dev)).models.choices;
  assert.deepEqual(choices.map((c) => c.id), ["minimax-m3.1-flash", "step-5-preview", "local"]);
  assert.deepEqual(choices.at(-1).efforts, [], "the local tutor takes no effort setting, so its picker shows none");

  const asked = async (body) => (await w.chat(dev, { text: "hello", adultAck: true, ...body })).body.code;
  assert.equal(await asked({ model: "step-5-preview", effort: "none" }), "bad_effort", "Step 5 does not offer none");
  assert.equal(await asked({ model: "minimax-m3.1-flash", effort: "enormous" }), "bad_effort");
  assert.equal(await asked({ model: "minimax-m3.1-flash", effort: "off" }), "bad_effort", "the service's own \"off\" is not a level the picker offers");
  assert.equal(await asked({ effort: "high" }), "bad_effort", "an effort belongs to a picked model");
  assert.equal(await asked({ model: "local", effort: "high" }), "bad_effort");
  assert.equal(w.fake.requests.length, 0, "nothing reached NVIDIA, and the local tutor was not asked either");
});
