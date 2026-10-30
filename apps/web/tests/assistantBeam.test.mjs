import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment, quiet } from "./_routeHelpers.mjs";

// Reflection's Beam on Ollama Cloud is the only reasoning model (docs/ASSISTANT.md): how it is configured, how its stream is read, what a turn
// stores and what a route refuses. Every network call here is a fake: these tests prove the code's behaviour, NOT that Ollama's service is up
// (that is a live run with OLLAMA_API_KEY, which the report labels separately).

const own = (clientId, studentId = null) => ({ clientId, studentId });
const types = loadTsFrom(import.meta.url, "../src/lib/assistant/types.ts");
const openaiLib = loadTsFrom(import.meta.url, "../src/lib/assistant/openai.ts");
const { buildProvider, OLLAMA_CLOUD_URL } = loadTsFrom(import.meta.url, "../src/lib/assistant/providers.ts");
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

const KEY = "ollama-TEST-KEY-0123";
const ENV = { NODE_ENV: "development", ASSISTANT_PROVIDER: "ollama_cloud", OLLAMA_API_KEY: KEY };
const OPTS = { maxTokens: 1000, temperature: 0.4, contextSize: 8192, firstTokenTimeoutMs: 2000, totalTimeoutMs: 5000 };
const MSGS = [{ role: "system", content: "S" }, { role: "user", content: "What is 6 x 7?" }];

const sse = (parts, { done = true } = {}) =>
  new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(`data: ${typeof p === "string" ? p : JSON.stringify(p)}\n\n`)); if (done) c.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); c.close(); } }));
const content = (t) => ({ choices: [{ delta: { content: t } }] });
const thought = (t, field = "reasoning") => ({ choices: [{ delta: { [field]: t } }] });
const usage = (completion) => ({ choices: [], usage: { prompt_tokens: 10, completion_tokens: completion } });
/** Parts that arrive spread out in time; honours the request's abort signal the way a real fetch does. */
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

/** A fake Ollama Cloud endpoint: records every request, lists `beam` on /models and answers /chat/completions with `answer(body, n)`. */
function ollama(answer, { listed = ["beam", "gpt-oss:120b"] } = {}) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith("/models")) return Response.json({ object: "list", data: listed.map((id) => ({ id })) });
    const body = JSON.parse(init.body);
    requests.push({ url: String(url), headers: init.headers, body });
    return answer(body, requests.length, init);
  };
  return { fetchImpl, requests };
}

const beam = (fetchImpl, env = ENV) => buildProvider(cfgLib.assistantConfig(env), env, fetchImpl);

test("config: Beam on Ollama Cloud is the default, there is exactly one provider, and a retired or doubled provider closes the assistant", () => {
  const config = cfgLib.assistantConfig({ NODE_ENV: "development" });
  assert.deepEqual(config.providers, ["ollama_cloud"]);
  assert.equal(config.model, "beam");
  assert.equal(config.visionModel, null, "Beam reads text only");
  assert.equal(OLLAMA_CLOUD_URL, "https://ollama.com/v1");
  for (const retired of ["nim", "ollama", "ollama_cloud,mock", "mock,custom"]) {
    const closed = cfgLib.assistantConfig({ NODE_ENV: "development", ASSISTANT_PROVIDER: retired });
    assert.deepEqual(closed.providers, [], `${retired}: no provider (no chain, no fallback to another model)`);
    assert.deepEqual(cfgLib.assistantAvailability(closed, {}), { open: false, reason: "no_provider" });
  }
  assert.equal(cfgLib.assistantConfig({ NODE_ENV: "development", ASSISTANT_MODEL: "beam" }).model, "beam");
});

test("config: no local helper models remain, and retrieval (which needed one) is off", () => {
  const config = cfgLib.assistantConfig({ NODE_ENV: "development" });
  assert.equal(config.retrieval.enabled, false);
  for (const gone of ["decision", "recall", "keepAlive", "vramHeadroomMiB"]) assert.equal(gone in config, false, gone);
  assert.equal(config.openui.enabled, true);
  assert.equal(config.openui.maxRepairs, 1);
  assert.equal(cfgLib.assistantConfig({ OPENUI_ENABLED: "off" }).openui.enabled, false);
  assert.equal(cfgLib.assistantConfig({ OPENUI_MAX_REPAIRS: "9" }).openui.maxRepairs, 1, "out of range: the default");
});

test("buildProvider: needs the key, never builds in production, and is refused there even when asked for", () => {
  assert.equal(beam(async () => sse([]), { ...ENV, OLLAMA_API_KEY: "" }), null, "no key, no provider");
  assert.equal(beam(async () => sse([]), { ...ENV, OLLAMA_API_KEY: undefined }), null);
  assert.ok(beam(async () => sse([])));
  const prod = { ...ENV, NODE_ENV: "production", ASSISTANT_ENABLED: "true", ASSISTANT_PRODUCTION_APPROVED: "true" };
  assert.equal(beam(async () => sse([]), prod), null, "ollama_cloud is development only");
  assert.deepEqual(cfgLib.assistantAvailability(cfgLib.assistantConfig(prod), prod), { open: false, reason: "production_provider" });
  assert.equal(rt.assistantClosed(prod), "production_provider");
});

test("a request: the right address, the key only in the header, Beam's id, usage asked for, no tool_choice and no picture", async () => {
  openaiLib.resetAcceptedFields();
  const fake = ollama(() => sse([content("42"), usage(2)]));
  const p = beam(fake.fetchImpl);
  const tools = [{ name: "check_calc", description: "d", parameters: { type: "object", properties: { expression: { type: "string" } } } }];
  const out = await drain(p.stream(MSGS, { ...OPTS, tools }));
  const sent = fake.requests[0];
  assert.equal(sent.url, "https://ollama.com/v1/chat/completions");
  assert.equal(sent.headers.Authorization, `Bearer ${KEY}`);
  assert.ok(!JSON.stringify(sent.body).includes(KEY), "the key is in the header and nowhere else");
  assert.equal(sent.body.model, "beam");
  assert.equal(sent.body.stream, true);
  assert.deepEqual(sent.body.stream_options, { include_usage: true });
  assert.equal("tool_choice" in sent.body, false, "Ollama's /v1 does not support tool_choice");
  assert.equal(sent.body.tools[0].function.name, "check_calc");
  assert.equal(sent.body.reasoning_effort, "none", "a turn that did not ask to think asks for no reasoning");
  assert.equal(out.done.model, "beam");
  assert.equal(out.done.provider, "ollama_cloud");
  assert.equal((await p.capabilities()).vision, false, "Beam is not offered pictures");
  assert.equal((await p.capabilities()).toolUse, true);
});

test("a caller cannot send Beam another provider's model name", async () => {
  openaiLib.resetAcceptedFields();
  const fake = ollama(() => sse([content("ok"), usage(1)]));
  await drain(beam(fake.fetchImpl).stream(MSGS, { ...OPTS, model: "minimaxai/minimax-m3.1-flash" }));
  assert.equal(fake.requests[0].body.model, "beam");
});

test("reasoning is activity, never answer text; an answer that is only reasoning is an error, not a success", async () => {
  openaiLib.resetAcceptedFields();
  const fake = ollama((_b, n) =>
    n === 1
      ? sse([thought("Let me think: 6 x 7..."), thought("so 42", "reasoning_content"), content("The answer is "), content("42."), usage(57)])
      : sse([thought("still thinking about it"), { choices: [{ delta: {}, finish_reason: "length" }] }, usage(16000)]),
  );
  const p = beam(fake.fetchImpl);
  const out = await drain(p.stream(MSGS, OPTS));
  assert.equal(out.text, "The answer is 42.");
  assert.ok(out.chunks.some((c) => c.type === "activity" && c.kind === "thinking"));
  assert.ok(!out.chunks.some((c) => c.type === "text" && /think|so 42/.test(c.text)), "no reasoning in the answer");
  assert.deepEqual(out.done.usage, { promptTokens: 10, completionTokens: 57 });
  await assert.rejects(() => drain(p.stream(MSGS, OPTS)), (e) => e instanceof types.ProviderError && e.code === "empty" && e.detail === "reasoning_exhausted");
});

test("Beam is judged by its work, not by time to its first word; a stream that goes quiet is still ended", async () => {
  openaiLib.resetAcceptedFields();
  const timed = { ...OPTS, firstTokenTimeoutMs: 5_000, firstAnswerTimeoutMs: 200, idleTimeoutMs: 5_000, totalTimeoutMs: 5_000 };
  const thinking = [[60, thought("weighing the essay")], [60, thought("comparing the two poems")], [140, thought("almost ready")]];
  const slow = beam(ollama((_b, _n, init) => sseOver([...thinking, [60, content("The answer is 42.")], [10, usage(900)]], init.signal)).fetchImpl);
  const out = await drain(slow.stream(MSGS, timed));
  assert.equal(out.text, "The answer is 42.", "the answer still comes after more than 260 ms of thinking with a 200 ms first-answer window");
  const stalled = beam(ollama((_b, _n, init) => sseOver([[10, thought("one thought")], [400, content("too late")]], init.signal)).fetchImpl);
  await assert.rejects(() => drain(stalled.stream(MSGS, { ...timed, idleTimeoutMs: 150 })), (e) => e instanceof types.ProviderError && e.code === "timeout");
});

test("tool calls: assembled from fragments, and their results sent back paired by call id", async () => {
  openaiLib.resetAcceptedFields();
  const fake = ollama((_b, n) =>
    n === 1
      ? sse([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_abc", function: { name: "check_calc", arguments: '{"expre' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ssion":"6*7"}' } }] } }] },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        ])
      : sse([content("42"), usage(1)]),
  );
  const p = beam(fake.fetchImpl);
  const tools = [{ name: "check_calc", description: "d", parameters: { type: "object", properties: { expression: { type: "string" } } } }];
  const first = await drain(p.stream(MSGS, { ...OPTS, tools }));
  assert.deepEqual(first.calls, [{ id: "call_abc", name: "check_calc", arguments: { expression: "6*7" } }]);
  await drain(p.stream([...MSGS, { role: "assistant", content: "", toolCalls: first.calls }, { role: "tool", toolName: "check_calc", toolCallId: "call_abc", content: "42" }], OPTS));
  const sent = fake.requests[1].body.messages;
  assert.equal(sent[2].tool_calls[0].id, "call_abc");
  assert.deepEqual(sent[3], { role: "tool", tool_call_id: "call_abc", content: "42" });
});

test("a reasoning option the endpoint refuses is dropped once, then remembered; other errors are named and not retried", async () => {
  openaiLib.resetAcceptedFields();
  const fake = ollama((body) => (body.reasoning_effort ? new Response("{}", { status: 400 }) : sse([content("ok"), usage(1)])));
  const p = beam(fake.fetchImpl);
  await drain(p.stream(MSGS, { ...OPTS, think: "high" }));
  assert.equal(fake.requests.length, 2, "the named effort was refused, the plain request accepted");
  assert.equal(fake.requests[1].body.reasoning_effort, undefined);
  await drain(p.stream(MSGS, { ...OPTS, think: "high" }));
  assert.equal(fake.requests.length, 3, "the next turn goes straight to the accepted form");

  const failing = (status) => beam(ollama(() => new Response("{}", { status })).fetchImpl);
  await assert.rejects(() => drain(failing(401).stream(MSGS, OPTS)), (e) => e.code === "unavailable" && e.detail === "unauthorised");
  await assert.rejects(() => drain(failing(404).stream(MSGS, OPTS)), (e) => e.code === "unavailable" && e.detail === "model_missing");
  await assert.rejects(() => drain(failing(500).stream(MSGS, OPTS)), (e) => e.code === "unavailable" && e.detail === "http_500");
});

test("health: reachable and listed is ok; a refused key, a missing model and an unreachable server are each named", async () => {
  assert.deepEqual(await beam(ollama(() => sse([])).fetchImpl).health(), { ok: true, detail: "ok" });
  assert.deepEqual(await beam(ollama(() => sse([]), { listed: ["gpt-oss:120b"] }).fetchImpl).health(), { ok: false, detail: "model_missing" });
  assert.deepEqual(await beam(async () => new Response("{}", { status: 401 })).health(), { ok: false, detail: "unauthorised" });
  assert.deepEqual(await beam(async () => { throw new Error("down"); }).health(), { ok: false, detail: "unreachable" });
});

test("usage: what the endpoint reports is used; with no report the visible answer's length stands in, so the budget still counts the turn", async () => {
  openaiLib.resetAcceptedFields();
  const reported = await drain(beam(ollama(() => sse([content("x".repeat(70)), usage(33)])).fetchImpl).stream(MSGS, OPTS));
  assert.equal(reported.done.usage.completionTokens, 33);
  const silent = await drain(beam(ollama(() => sse([content("x".repeat(70))])).fetchImpl).stream(MSGS, OPTS));
  assert.equal(silent.done.usage.completionTokens, 20, "70 characters at about 3.5 a token");
});

test("cancellation: stopping mid-answer aborts the request and is reported as aborted", async () => {
  openaiLib.resetAcceptedFields();
  const p = beam(async (_url, init) =>
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

test("rate limits are retried with the server's wait, then reported as rate limited", async () => {
  openaiLib.resetAcceptedFields();
  let calls = 0;
  const p = new openaiLib.OpenAiCompatibleProvider({ id: "ollama_cloud", baseUrl: OLLAMA_CLOUD_URL, apiKey: KEY, model: "beam", sleep: async () => {}, fetch: async () => (calls += 1, new Response("{}", { status: 429, headers: { "retry-after": "1" } })) });
  await assert.rejects(() => drain(p.stream(MSGS, OPTS)), (e) => e.code === "rate_limited" && e.retryAfterMs === 1000);
  assert.equal(calls, 3, "the first request and two retries");
});

// ---- a whole turn ------------------------------------------------------------------------------------------------------------------------

async function turnWorld(t, answer) {
  environment(t, {});
  quiet(t);
  openaiLib.resetAcceptedFields();
  const store = new InMemoryLibraryStore();
  const profile = store.seedProfile({ email: "dev@example.com", role: "ADMIN" });
  const clientId = await store.accounts.ensureClient(profile);
  const config = cfgLib.assistantConfig(ENV);
  const fake = ollama(answer);
  const provider = buildProvider(config, ENV, fake.fetchImpl);
  const deps = { store, provider, queue: new GenerationQueue(1, 4), uploads: new MemoryLibraryStorage(), config, hosted: true, now: () => new Date("2026-10-21T10:30:00Z"), log: () => {} };
  const send = async (text, sessionId = null) => {
    const events = [];
    for await (const e of svc.sendMessage(deps, { owner: own(clientId), sessionId, text })) events.push(e);
    return events;
  };
  return { store, clientId, fake, send };
}

test("a turn: Beam answers, the answer is stored with the model that reported it, and its tokens count against the day's budget", async (t) => {
  const w = await turnWorld(t, (body) => sse([content(`Answer from ${body.model}.`), usage(12)]));
  const events = await w.send("hello there");
  const sessionId = events[0].sessionId;
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.at(-1).provider, "ollama_cloud");
  assert.equal("model" in events.at(-1), false, "nothing is labelled for a developer: there is no picker");
  const stored = await w.store.chat.listMessages(own(w.clientId), sessionId);
  assert.equal(stored[1].content, "Answer from beam.");
  assert.equal(stored[1].generatedBy, "ollama_cloud:beam");
  const day = new Date(Math.floor(new Date("2026-10-21T10:30:00Z").getTime() / 86_400_000) * 86_400_000);
  assert.equal(await w.store.chat.usageCount(own(w.clientId).clientId, svc.USAGE_TOKENS_DAY, day), 12);
});

test("a turn: when Beam fails, the student is told it failed; nothing else answers in its place and nothing is invented", async (t) => {
  const w = await turnWorld(t, () => new Response("{}", { status: 500 }));
  const events = await w.send("hello there");
  assert.deepEqual(events.at(-1), { type: "error", code: "unavailable" });
  assert.equal(events.filter((e) => e.type === "delta").length, 0);
  assert.equal(w.fake.requests.length, 1, "one request, to Beam, with no second model behind it");
  const stored = await w.store.chat.listMessages(own(w.clientId), events[0].sessionId);
  assert.deepEqual(stored.map((m) => m.role), ["user"]);
});

test("a turn: a hard maths answer is held and its working checked; a wrong step is repaired by Beam before anything is shown", async (t) => {
  const w = await turnWorld(t, (body, n) =>
    sse([
      content(
        n === 1
          ? "Solve the simultaneous equations.\n\n$$x + y = 10$$\n$$x - y = 2$$\n\nAdding:\n\n$$2x = 12$$\n$$x = 7$$\n\nSo $x = 7$."
          : "Solve the simultaneous equations.\n\n$$x + y = 10$$\n$$x - y = 2$$\n\nAdding:\n\n$$2x = 12$$\n$$x = 6$$\n\nSo $x = 6$, $y = 4$.",
      ),
      usage(30),
    ]),
  );
  const events = await w.send("Solve the simultaneous equations x + y = 10 and x - y = 2");
  const order = events.map((e) => (e.type === "status" ? e.state : e.type));
  assert.ok(order.indexOf("verifying") >= 0 && order.indexOf("verifying") < order.indexOf("delta"), "checked before any text is released");
  const shown = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
  assert.doesNotMatch(shown, /x = 7/, "the wrong step never reached the student");
  assert.match(shown, /x = 6/);
  assert.equal(w.fake.requests.length, 2, "one draft and one repair, by the same model");
  assert.deepEqual(w.fake.requests.map((r) => r.body.model), ["beam", "beam"]);
  assert.match(w.fake.requests[1].body.messages.at(-1).content, /working that a calculation shows is wrong/);
  assert.equal(w.fake.requests[0].body.reasoning_effort, "high", "a hard problem: full reasoning");
});

// ---- the routes --------------------------------------------------------------------------------------------------------------------------

async function routeWorld(t, env = ENV) {
  environment(t, {});
  quiet(t);
  session.resetSessionCache();
  openaiLib.resetAcceptedFields();
  const store = new InMemoryLibraryStore();
  const auth = new MemoryAccountAuth({ onUserCreated: (u) => store.seedProfile({ id: u.id, displayName: u.displayName, email: u.email }) });
  const account = { backend: "memory", auth, store, lockout: new SignInLockout(), outbox: auth.outbox, memory: store };
  const config = cfgLib.assistantConfig(env);
  const fake = ollama((body) => sse([content(`From ${body.model}`), usage(3)]));
  const assistant = { config, provider: buildProvider(config, env, fake.fetchImpl), queue: new GenerationQueue(1, 4), uploads: new MemoryLibraryStorage(), hosted: true, embeddings: null, research: null, flag: async () => {} };
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

test("routes: a request that names a model or an effort is refused for everyone, administrators included, before anything reaches Beam", async (t) => {
  const w = await routeWorld(t);
  for (const role of ["CLIENT", "ADMIN"]) {
    const who = await w.person(role);
    for (const extra of [{ model: "step-5-preview" }, { model: "beam" }, { effort: "high" }, { model: "", effort: "auto" }]) {
      const refused = await w.chat(who, { text: "hello", adultAck: true, ...extra });
      assert.equal(refused.response.status, 400, `${role} ${JSON.stringify(extra)}`);
      assert.equal(refused.body.code, "bad_model");
    }
  }
  assert.equal(w.fake.requests.length, 0, "nothing was sent to the provider");
  const parent = await w.person("CLIENT");
  const ok = await w.chat(parent, { text: "hello", adultAck: true });
  assert.equal(ok.response.status, 200);
  assert.equal(w.fake.requests[0].body.model, "beam");
});

test("routes: the status page is told whether the assistant is open and that interfaces are on, and never a key, a model list or a picker", async (t) => {
  const w = await routeWorld(t);
  const dev = await w.person("ADMIN");
  const s = await w.status(dev);
  assert.equal(s.open, true);
  assert.equal(s.interactive, true);
  for (const gone of ["models", "retrieval", "decision"]) assert.equal(gone in s, false, gone);
  assert.ok(!JSON.stringify(s).includes(KEY), "no key in what the page is sent");
  assert.ok(!JSON.stringify(s).includes("ollama.com"), "no provider address either");
});

test("routes: no key means closed, with the provider's own reason, and production stays closed whatever is set", async (t) => {
  const w = await routeWorld(t, { ...ENV, OLLAMA_API_KEY: "" });
  assert.equal(w.deps(null).assistant.provider, null, "no provider without a key");
  const prod = { ...ENV, NODE_ENV: "production", ASSISTANT_ENABLED: "true", ASSISTANT_PRODUCTION_APPROVED: "true", ASSISTANT_MINORS_APPROVED: "true" };
  const response = await h.handleStatus(new Request("http://localhost:3100/api/assistant/status"), { rt: null, jar: { get() {}, set() {}, delete() {} }, assistant: null, env: prod });
  assert.deepEqual(await response.json(), { open: false, reason: "no_backend" });
  assert.equal(rt.assistantClosed(prod, true), "production_provider");
});

void MockProvider;
