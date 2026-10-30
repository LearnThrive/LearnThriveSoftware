import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { quiet, environment } from "./_routeHelpers.mjs";

// The three roles (tutor, embeddings, decisions), the tool round trip, retrieval and warm-up. These are PROTOCOL tests with a
// fake fetch: they prove what the app sends and accepts. The measured GPU/CPU behaviour is in docs/OLLAMA_BENCHMARK.md, which is
// run against the real servers separately.

const { OllamaProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/ollama.ts");
const { cosine } = loadTsFrom(import.meta.url, "../src/lib/assistant/embeddings.ts");
const { deterministicRoute } = loadTsFrom(import.meta.url, "../src/lib/assistant/decision.ts");
const retrieval = loadTsFrom(import.meta.url, "../src/lib/assistant/retrieval.ts");
const { TOOL_DEFINITIONS, runTool } = loadTsFrom(import.meta.url, "../src/lib/assistant/tools.ts");
const cfg = loadTsFrom(import.meta.url, "../src/lib/assistant/config.ts");
const svc = loadTsFrom(import.meta.url, "../src/lib/assistant/service.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

const ndjson = (parts) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(new TextEncoder().encode(`${JSON.stringify(p)}\n`));
        c.close();
      },
    }),
  );
const collect = async (iterable) => {
  const out = { text: "", activities: [], calls: [], done: null };
  for await (const chunk of iterable) {
    if (chunk.type === "text") out.text += chunk.text;
    else if (chunk.type === "activity") out.activities.push(chunk.kind);
    else if (chunk.type === "tool_call") out.calls.push(chunk.call);
    else out.done = chunk;
  }
  return out;
};
const OPTS = { maxTokens: 90, temperature: 0.2, contextSize: 4096, firstTokenTimeoutMs: 3000, firstAnswerTimeoutMs: 3000, totalTimeoutMs: 6000 };
const MSGS = [{ role: "system", content: "S" }, { role: "user", content: "hi" }];

function ollamaFetch({ show = { capabilities: ["completion", "vision", "tools", "thinking"], thinking: { values: [false, true], default: false } }, ps = { models: [] }, chat, calls = [] } = {}) {
  return async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : null });
    if (path === "/api/show") return Response.json(show);
    if (path === "/api/ps") return Response.json(ps);
    if (path === "/api/generate") return Response.json({ load_duration: 1_500_000_000 });
    if (path === "/api/tags") return Response.json({ models: [{ name: "m1:latest", digest: "d1" }] });
    if (path === "/api/chat") return chat(init);
    return new Response("no", { status: 404 });
  };
}

test("ollama: keep_alive and the exact context are sent, thinking metadata decides the control", async () => {
  const calls = [];
  const provider = new OllamaProvider({ baseUrl: "http://x", model: "m1", contextSize: 4096, keepAlive: "30m", fetch: ollamaFetch({ calls, chat: () => ndjson([{ message: { content: "ok" } }, { done: true }]) }) });
  const caps = await provider.capabilities("m1");
  assert.equal(caps.thinking, true);
  assert.deepEqual(caps.thinkingValues, [false, true]);
  assert.equal(caps.digest, "d1", "the digest is read from the tags and is part of what capabilities describe");
  await collect(provider.stream(MSGS, { ...OPTS, reasoning: true }));
  const body = calls.find((c) => c.path === "/api/chat").body;
  assert.equal(body.keep_alive, "30m");
  assert.equal(body.think, true);
  assert.deepEqual(body.options, { num_ctx: 4096, num_predict: 90, temperature: 0.2 });

  const off = [];
  await collect(new OllamaProvider({ baseUrl: "http://x", model: "m1", fetch: ollamaFetch({ calls: off, chat: () => ndjson([{ done: true }]) }) }).stream(MSGS, OPTS));
  assert.equal(off.find((c) => c.path === "/api/chat").body.think, false, "default: no thinking for ordinary chat");
});

test("ollama: thinking is activity, not the student's answer; tool calls are parsed; metrics are milliseconds", async () => {
  const calls = [];
  const parts = [
    { message: { thinking: "The student wants a sum. " } },
    { message: { tool_calls: [{ function: { name: "check_calculation", arguments: { expression: "2+2" } } }] } },
    { message: { content: "It is 4." } },
    { done: true, prompt_eval_count: 40, eval_count: 5, load_duration: 2_000_000_000, prompt_eval_duration: 300_000_000, eval_duration: 500_000_000, total_duration: 3_000_000_000 },
  ];
  const provider = new OllamaProvider({ baseUrl: "http://x", model: "m1", fetch: ollamaFetch({ calls, chat: () => ndjson(parts) }) });
  const out = await collect(provider.stream(MSGS, { ...OPTS, tools: TOOL_DEFINITIONS }));
  assert.equal(out.text, "It is 4.");
  assert.deepEqual(out.activities, ["thinking", "tool_call"]);
  assert.deepEqual(out.calls, [{ id: "call-1", name: "check_calculation", arguments: { expression: "2+2" } }]);
  assert.equal(out.done.stats.firstAnswerMs >= 0, true);
  assert.deepEqual(out.done.metrics, { loadMs: 2000, promptEvalMs: 300, promptEvalCount: 40, evalMs: 500, evalCount: 5, totalMs: 3000, tokensPerSecond: 10 });
  const sent = calls.find((c) => c.path === "/api/chat").body;
  assert.equal(sent.tools.length, TOOL_DEFINITIONS.length);
  assert.equal(sent.tools[0].type, "function");
  assert.equal(sent.tools[0].function.name, TOOL_DEFINITIONS[0].name);
});

test("ollama: a tool result goes back in the native shape, with the tool name", async () => {
  const calls = [];
  const provider = new OllamaProvider({ baseUrl: "http://x", model: "m1", fetch: ollamaFetch({ calls, chat: () => ndjson([{ done: true }]) }) });
  const messages = [
    { role: "user", content: "check 2+2" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "check_calculation", arguments: { expression: "2+2" } }] },
    { role: "tool", toolName: "check_calculation", content: "Yes: 2+2 = 4." },
  ];
  await collect(provider.stream(messages, OPTS));
  assert.deepEqual(calls.find((c) => c.path === "/api/chat").body.messages[1].tool_calls, [{ function: { name: "check_calculation", arguments: { expression: "2+2" } } }]);
  assert.equal(calls.find((c) => c.path === "/api/chat").body.messages[2].tool_name, "check_calculation");
});

test("ollama: a failed capability lookup is retried, not cached as a permanent no-vision", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  let showCalls = 0;
  const fetchImpl = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/show") {
      showCalls += 1;
      return showCalls === 1 ? new Response("boom", { status: 500 }) : Response.json({ capabilities: ["completion", "vision"] });
    }
    if (path === "/api/tags") return Response.json({ models: [{ name: "m1", digest: "x" }] });
    return new Response("no", { status: 404 });
  };
  const provider = new OllamaProvider({ baseUrl: "http://x", model: "m1", fetch: fetchImpl });
  assert.equal((await provider.capabilities("m1")).vision, false, "the first lookup failed");
  assert.equal((await provider.capabilities("m1")).vision, false, "the failure is cached only briefly");
  assert.equal(showCalls, 1);
  t.mock.timers.tick(11_000);
  assert.equal((await provider.capabilities("m1")).vision, true, "after the short interval it asks again and recovers");
  assert.equal(showCalls, 2);
});

test("routing: explicit metadata wins, and obvious messages are routed without any model", () => {
  assert.equal(deterministicRoute({ text: "hello", hasFreshFiles: true, hasHistory: false }).intent, "explain_question");
  assert.equal(deterministicRoute({ text: "", hasFreshFiles: true, hasHistory: false }).source, "explicit");
  assert.equal(deterministicRoute({ text: "solve the whole paper please", hasFreshFiles: false, hasHistory: true }).intent, "solve_paper");
  assert.equal(deterministicRoute({ text: "search my notes for fractions", hasFreshFiles: false, hasHistory: true }).intent, "search_material");
  assert.equal(deterministicRoute({ text: "tell me about the causes of the war", hasFreshFiles: false, hasHistory: true }), null, "an ordinary question has no special route and goes to the tutor");
});

test("retrieval: chunks follow question starts, labels are found exactly, and only the owner's vectors are compared", async () => {
  const pages = [
    { number: 1, text: "Page one introduction\nQuestion 1. What is 3/4 of 24?\nWork it out." },
    { number: 2, text: "2. Solve 2x + 7 = 19.\n(a) show your working\n(b) check your answer" },
  ];
  const chunks = retrieval.chunksForPages(pages);
  assert.deepEqual(chunks.map((c) => [c.page, c.label]), [
    [1, "page 1"],
    [1, "question 1"],
    [2, "question 2"],
  ]);
  assert.match(chunks[1].text, /Question 1/);
  assert.deepEqual(retrieval.labelsAsked("what about question 4(b) and page 2?"), [
    { kind: "question", value: "4(b)" },
    { kind: "page", value: "2" },
  ]);
  assert.ok(codesLike(chunks.map((c) => c.text), "3/4 of 24"), "the fraction stays with its question");

  const owner = { clientId: "c1", studentId: null };
  const rows = [
    { id: "1", fileId: "f1", sessionId: "s1", page: 2, label: "question 4(b)", ordinal: 3, text: "4(b) solve for x", model: "m", digest: null, dimension: 2, chunkConfigVersion: "v", embedding: [1, 0], createdAt: new Date() },
    { id: "2", fileId: "f1", sessionId: "s1", page: 1, label: "page 1", ordinal: 0, text: "introduction", model: "m", digest: null, dimension: 2, chunkConfigVersion: "v", embedding: [0, 1], createdAt: new Date() },
  ];
  const store = { chat: { listFileChunks: async (who) => (who.clientId === owner.clientId ? rows : []) } };
  const embeddings = { id: "e", model: "m", dimension: 2, embed: async () => [[1, 0]], health: async () => ({ ok: true, detail: "ok" }) };
  const exact = await retrieval.searchUploads({ store, embeddings }, { owner, sessionId: "s1", query: "question 4b please", topK: 4, minScore: 0.1 });
  assert.deepEqual(exact.map((h) => [h.label, h.match]), [["question 4(b)", "exact"]]);
  const other = { id: "e", model: "m", dimension: 2, embed: async () => [[0, 1]], health: async () => ({ ok: true, detail: "ok" }) };
  const fuzzy = await retrieval.searchUploads({ store, embeddings: other }, { owner, sessionId: "s1", query: "where do I start?", topK: 4, minScore: 0.1 });
  assert.deepEqual(fuzzy.map((h) => [h.label, h.match]), [["page 1", "semantic"]], "cosine picks the matching vector");
});
function codesLike(texts, needle) {
  return texts.some((t) => t.includes(needle));
}

test("tools: read-only allowlist, validated arguments, and the existing maths checker", async () => {
  const ctx = { store: {}, owner: { clientId: "c", studentId: null }, sessionId: "s", fileNames: new Map(), search: async () => [] };
  assert.equal((await runTool("run_shell", { command: "rm -rf /" }, ctx)).code, "unknown_tool");
  assert.equal((await runTool("check_calculation", { expression: "2 + 2", answer: "4" }, ctx)).content, "Yes: 2 + 2 = 4.");
  assert.equal((await runTool("check_calculation", { expression: "2 + 2", answer: "5" }, ctx)).content, "No: 2 + 2 = 4, not 5.");
  assert.equal((await runTool("check_calculation", { equation: "2x + 7 = 19", answer: "x = 6" }, ctx)).content, "Yes: x = 6 satisfies 2x + 7 = 19.");
  assert.equal((await runTool("check_calculation", { expression: 12 }, ctx)).code, "bad_arguments");
  assert.equal((await runTool("search_authorised_material", { query: "x".repeat(400) }, ctx)).code, "too_large");
  assert.match((await runTool("get_question_region", { reference: "question 9" }, ctx)).content, /No page or question matching/);
});

test("queue: a waiter that exhausts its queue budget is told busy, and a stopped or timed-out waiter never keeps a slot", async () => {
  const queue = new GenerationQueue(1, 4);
  let release;
  const running = queue.run(() => new Promise((resolve) => (release = resolve)));
  await assert.rejects(
    () => queue.run(async () => "never", { maxWaitMs: 25 }),
    (e) => e.message === "queue_timeout",
  );
  assert.deepEqual(queue.depth, { running: 1, waiting: 0 });
  release();
  await running;
  assert.deepEqual(queue.depth, { running: 0, waiting: 0 });
  assert.equal(await queue.run(async () => 7), 7, "the timeout did not leak a permit");

  const second = new GenerationQueue(1, 2);
  let release2;
  const holding = second.run(() => new Promise((resolve) => (release2 = resolve)));
  const controller = new AbortController();
  const waiting = second.run(async () => 1, { signal: controller.signal });
  controller.abort();
  await assert.rejects(() => waiting);
  assert.deepEqual(second.depth, { running: 1, waiting: 0 });
  release2();
  await holding;
  assert.equal(await second.run(async () => 2), 2);
});

test("config: Beam's defaults, one set of staged budgets, and bounded numbers", () => {
  const c = cfg.assistantConfig({});
  assert.equal(c.model, "beam");
  assert.equal(c.contextSize, 32768);
  assert.equal(c.maxOutputTokens, 4096);
  assert.equal(c.thinking, "auto");
  assert.equal(c.stages.turnMs, 360000);
  assert.ok(c.stages.firstAnswerMs >= c.stages.firstActivityMs, "a reasoning model may take longer to a visible word than to its first sign of work");
  assert.equal(cfg.assistantConfig({ ASSISTANT_STAGE_TURN_MS: "90000" }).stages.turnMs, 90000);
  const bounded = cfg.assistantConfig({ ASSISTANT_CONCURRENCY: "99", ASSISTANT_IMAGES_PER_MESSAGE: "0", ASSISTANT_STAGE_IDLE_MS: "5" });
  assert.equal(bounded.concurrency, cfg.ASSISTANT_DEFAULTS.concurrency);
  assert.equal(bounded.images.perMessage, 3);
  assert.equal(bounded.stages.idleMs, cfg.ASSISTANT_DEFAULTS.idleMs);
});

test("thinking policy: off for pictures and greetings, on for multi-step work, and an owner's level is honoured", () => {
  assert.deepEqual(svc.thinkingFor("auto", "hello", false), { reasoning: false });
  assert.deepEqual(svc.thinkingFor("auto", "Prove that the sum of two odd numbers is even", false), { reasoning: true });
  assert.deepEqual(svc.thinkingFor("auto", "Prove that the sum is even", true), { reasoning: false }, "an image transcription does not think");
  assert.deepEqual(svc.thinkingFor("off", "Prove it", false), { reasoning: false });
  assert.deepEqual(svc.thinkingFor("high", "hi", false), { reasoning: true, think: "high" });
});

// ---- the service with a warmable, tool-calling provider ---------------------------------------------------------

class RoleProvider {
  id = "ollama";
  requests = [];
  warmCalls = 0;
  residentFlag = false;
  constructor() {
    this.requests = [];
  }
  async capabilities() {
    return { vision: true, jsonMode: true, toolUse: true, maxContext: 4096, thinking: true, thinkingValues: [false, true] };
  }
  async health() {
    return { ok: true, detail: "ok" };
  }
  async resident() {
    return this.residentFlag;
  }
  async warm(options) {
    this.warmCalls += 1;
    assert.equal(options.contextSize, 8192, "the warm-up uses the turn's context");
    this.residentFlag = true;
    return { ok: true, loadMs: 10, detail: "ok" };
  }
  async *stream(messages, options) {
    this.requests.push({ messages: messages.map((m) => ({ ...m })), options });
    const tool = messages.some((m) => m.role === "tool");
    if (!tool) {
      yield { type: "activity", kind: "thinking" };
      yield { type: "tool_call", call: { id: "c1", name: "check_calculation", arguments: { expression: "2+2", answer: "4" } } };
      yield { type: "done", provider: "ollama", model: "m", usage: { promptTokens: 10, completionTokens: 1 }, stats: { firstTokenMs: 2, firstAnswerMs: null, totalMs: 3 } };
      return;
    }
    yield { type: "text", text: "Two plus two is four." };
    yield { type: "done", provider: "ollama", model: "m", usage: { promptTokens: 20, completionTokens: 5 }, stats: { firstTokenMs: 2, firstAnswerMs: 2, totalMs: 4 }, metrics: { loadMs: null, promptEvalMs: 3, promptEvalCount: 20, evalMs: 4, evalCount: 5, totalMs: 9, tokensPerSecond: 1250 } };
  }
}

test("service: runs one tool round, offers the tools a model supports, and keeps the deadline absolute", async (t) => {
  environment(t, {});
  quiet(t);
  const store = new InMemoryLibraryStore();
  const profile = store.seedProfile({ email: "tool@example.com" });
  const clientId = await store.accounts.ensureClient(profile);
  const provider = new RoleProvider();
  const config = cfg.assistantConfig({ ASSISTANT_PROVIDER: "mock", ASSISTANT_MAX_TOOL_ROUNDS: "2" });
  const logs = [];
  const deps = {
    store,
    provider,
    queue: new GenerationQueue(1, 4),
    uploads: new MemoryLibraryStorage(),
    config,
    now: () => new Date("2026-10-23T09:00:00Z"),
    log: (o, d) => logs.push([o, d]),
    hosted: false,
  };
  const events = [];
  for await (const e of svc.sendMessage(deps, { owner: { clientId, studentId: null }, sessionId: null, text: "What is 2 + 2?" })) events.push(e);
  assert.equal(events.some((e) => e.type === "status" && e.state === "preparing"), false, "there is no model to load: nothing is announced as preparing");
  assert.equal(events.at(-1).type, "done");
  assert.match(events.filter((e) => e.type === "delta").map((e) => e.text).join(""), /four/);
  assert.equal(provider.warmCalls, 0, "nothing is warmed: the model is hosted");
  assert.equal(provider.requests.length, 2, "the tool result goes back to the model once");
  const second = provider.requests[1].messages.at(-1);
  assert.equal(second.role, "tool");
  assert.equal(second.toolName, "check_calculation");
  assert.match(second.content, /^Yes: 2\+2 = 4\./);
  assert.ok(provider.requests[0].options.tools?.length, "tools are offered to a model that supports them");
  assert.ok(provider.requests[0].options.totalTimeoutMs <= config.stages.turnMs, "the provider is given what is left of the absolute turn");
  assert.equal(provider.requests[0].options.keepAlive, undefined, "keep-alive belongs to a local server");
  assert.equal(logs.filter(([o]) => o === "turn").length, 1);
  const stored = await store.chat.listMessages({ clientId, studentId: null }, events[0].sessionId);
  assert.equal(stored.at(-1).content, "Two plus two is four.");
});

test("service: a follow-up reuses what the document said instead of re-reading and re-picturing it", async (t) => {
  environment(t, {});
  quiet(t);
  const store = new InMemoryLibraryStore();
  const profile = store.seedProfile({ email: "reuse@example.com" });
  const clientId = await store.accounts.ensureClient(profile);
  const owner = { clientId, studentId: null };
  const provider = new MockProvider({ delayMs: 0 });
  const config = cfg.assistantConfig({ ASSISTANT_PROVIDER: "mock" });
  const deps = { store, provider, queue: new GenerationQueue(1, 4), uploads: new MemoryLibraryStorage(), config, log: () => {}, hosted: false };
  const session = await store.chat.createSession(owner, { title: "Paper" }, new Date("2026-10-23T09:00:00Z"));
  const file = await store.chat.addFile(owner, session.id, { storagePath: `${session.id}/page.pdf`, bytes: 10, contentType: "application/pdf" }, new Date("2026-10-23T09:00:00Z"));
  await store.chat.setFileReading(owner, file.id, { extractedText: "Question 4(b): solve 2x + 7 = 19.", pages: 2 });
  const message = await store.chat.appendMessage(owner, session.id, "user", "(attached a file)", new Date("2026-10-23T09:00:00Z"));
  await store.chat.attachFiles(owner, session.id, [file.id], message.id);

  const events = [];
  for await (const e of svc.sendMessage(deps, { owner, sessionId: session.id, text: "and what about question 4b?" })) events.push(e);
  assert.equal(events.at(-1).type, "done");
  const sent = provider.requests.at(-1);
  const user = sent.at(-1).content;
  assert.match(user, /Question 4\(b\): solve 2x \+ 7 = 19\./, "the stored reading is used");
  assert.equal(sent.at(-1).images, undefined, "no page is re-sent when the text already says it");
});

test("service: a fresh picture is announced as being read, once, and before any answer", async (t) => {
  environment(t, {});
  quiet(t);
  const store = new InMemoryLibraryStore();
  const profile = store.seedProfile({ email: "picture@example.com" });
  const clientId = await store.accounts.ensureClient(profile);
  const owner = { clientId, studentId: null };
  const provider = new MockProvider({ delayMs: 0 });
  const config = cfg.assistantConfig({ ASSISTANT_PROVIDER: "mock" });
  const uploads = new MemoryLibraryStorage();
  const deps = { store, provider, queue: new GenerationQueue(1, 4), uploads, config, log: () => {}, hosted: false };
  const session = await store.chat.createSession(owner, { title: "Photo" }, new Date("2026-10-23T09:00:00Z"));
  const file = await store.chat.addFile(owner, session.id, { storagePath: `${session.id}/photo.png`, bytes: 4, contentType: "image/png" }, new Date("2026-10-23T09:00:00Z"));
  await uploads.put(file.storagePath, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

  const events = [];
  for await (const e of svc.sendMessage(deps, { owner, sessionId: session.id, text: "What is this photo?", fileIds: [file.id] })) events.push(e);
  assert.equal(events.at(-1).type, "done");
  const states = events.filter((e) => e.type === "status").map((e) => e.state);
  assert.equal(states.filter((s) => s === "reading").length, 1, "the server says it is reading the picture, once");
  assert.ok(events.findIndex((e) => e.type === "status" && e.state === "reading") < events.findIndex((e) => e.type === "delta"), "and before the first word");
});
