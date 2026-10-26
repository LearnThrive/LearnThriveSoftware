import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { quiet, environment } from "./_routeHelpers.mjs";

// How an answer is delivered, and how the activity of a turn ends: a verified or advanced answer arrives once, whole, after every check (the notes
// the checks add included); ordinary chat still streams; a failed preparation never turns an answer that must be verified into one that is streamed
// unchecked; late lookups and tool rounds reach the page while they run; a page that is refused is never named; a stopped or failed turn is stored as
// that. Scripted providers and a fake search/web: nothing here calls a network.

const act = loadTsFrom(import.meta.url, "../src/lib/assistant/activity.ts");
const verify = loadTsFrom(import.meta.url, "../src/lib/assistant/research/verify.ts");
const studyLib = loadTsFrom(import.meta.url, "../src/lib/assistant/study.ts");
const svc = loadTsFrom(import.meta.url, "../src/lib/assistant/service.ts");
const cfgLib = loadTsFrom(import.meta.url, "../src/lib/assistant/config.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");
const { ProviderError } = loadTsFrom(import.meta.url, "../src/lib/assistant/types.ts");
const selection = loadTsFrom(import.meta.url, "../src/lib/assistant/selection.ts");
const rt = loadTsFrom(import.meta.url, "../src/lib/assistant/runtime.ts");
const openaiLib = loadTsFrom(import.meta.url, "../src/lib/assistant/openai.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");

const PUBLIC = async () => ["93.184.216.34"];
const LIMITS = { maxSearches: 5, maxFetches: 5, fetchMaxBytes: 200000, fetchTimeoutMs: 1000, perMinute: 50 };
const raw = (url, snippet = "") => ({ title: url, url, snippet, engines: ["google"], category: "general", publishedDate: null });
const htmlPage = (body) => async () => ({ status: 200, headers: { get: (n) => (n.toLowerCase() === "content-type" ? "text/html" : null) }, read: async (max) => ({ bytes: new TextEncoder().encode(body).subarray(0, max), truncated: false }) });

const PHOTO = "<html><title>Photosynthesis</title><body><p>Photosynthesis happens in the chloroplasts of plant cells. Chlorophyll absorbs light, and glucose and oxygen are made from carbon dioxide and water.</p></body></html>";
const BIOLOGY = "Explain how photosynthesis works in a plant cell for my GCSE biology exam";
const BIOLOGY_REPLY = "Photosynthesis happens in the chloroplasts of plant cells. It was Hoffman who proved that glucose and oxygen are made from carbon dioxide and water.";

function research({ results = [], web = {}, gate = null } = {}) {
  const queries = [];
  const service = new verify.ResearchService({
    searx: {
      available: true,
      search: async (q) => {
        queries.push(q);
        if (gate) await gate.promise;
        return { status: "ok", query: q, results, detail: "ok" };
      },
    },
    limits: LIMITS,
    fetchOptions: { resolve: PUBLIC, fetcher: async (url) => htmlPage(web[url] ?? "<p>unrelated</p>")() },
  });
  return { service, queries };
}

/** Replies are lists of chunks, so a test can tell a stream from one block. A reply may be a function of the request. */
class Scripted {
  id = "mock";
  requests = [];
  constructor(reply, { toolUse = false } = {}) {
    this.reply = reply;
    this.toolUse = toolUse;
  }
  async capabilities() {
    return { vision: false, jsonMode: false, toolUse: this.toolUse, maxContext: 8192 };
  }
  async health() {
    return { ok: true, detail: "ok" };
  }
  async *stream(messages) {
    this.requests.push(messages.map((m) => ({ ...m })));
    const out = typeof this.reply === "function" ? this.reply(messages, this.requests.length) : this.reply;
    if (out?.toolCall) {
      yield { type: "tool_call", call: { id: "call-1", name: out.toolCall.name, arguments: out.toolCall.arguments } };
    } else {
      for (const chunk of Array.isArray(out) ? out : [out]) yield { type: "text", text: chunk };
    }
    yield { type: "done", provider: "mock", model: "mock", usage: { promptTokens: 1, completionTokens: 1 }, stats: { firstTokenMs: 1, totalMs: 1 } };
  }
}

async function world(t, { reply, researchService = null, signal, toolUse = false, log } = {}) {
  environment(t, {});
  quiet(t);
  const store = new InMemoryLibraryStore();
  const profile = store.seedProfile({ email: "p@example.com" });
  const clientId = await store.accounts.ensureClient(profile);
  const provider = new Scripted(reply, { toolUse });
  const config = cfgLib.assistantConfig({ NODE_ENV: "development", ASSISTANT_PROVIDER: "mock" });
  const deps = { store, provider, queue: new GenerationQueue(config.concurrency, config.queueMax), uploads: new MemoryLibraryStorage(), config, research: researchService, now: () => new Date("2026-10-21T10:30:15Z"), ...(log ? { log } : {}) };
  const owner = { clientId, studentId: null };
  const run = async (text) => {
    const events = [];
    for await (const e of svc.sendMessage(deps, { owner, sessionId: null, text, signal })) events.push(e);
    return events;
  };
  return { store, owner, provider, deps, run };
}

const steps = (events) => events.filter((e) => e.type === "activity").map((e) => e.step);
const deltas = (events) => events.filter((e) => e.type === "delta");
const storedAnswer = async (w, events) => (await w.store.chat.listMessages(w.owner, events.find((e) => e.type === "session").sessionId)).filter((m) => m.role === "assistant").at(-1);
const sourcesFor = () => research({ results: [raw("https://www.bbc.co.uk/bitesize/photo")], web: { "https://www.bbc.co.uk/bitesize/photo": PHOTO } });

test("D1. a verified answer in a subject that is read up on arrives ONCE, whole, after every check, with the notes the checks add", async (t) => {
  const w = await world(t, { researchService: sourcesFor().service, reply: [BIOLOGY_REPLY.slice(0, 60), BIOLOGY_REPLY.slice(60)] });
  const events = await w.run(BIOLOGY);
  const sent = deltas(events);
  assert.equal(sent.length, 1, "one delta, not a stream and not a stream followed by a suffix");
  assert.equal(sent[0].whole, true, "marked as the complete answer");
  assert.match(sent[0].text, /^Photosynthesis happens/);
  assert.match(sent[0].text, /Check:[\s\S]*Hoffman/, "the note a check added is part of the one delivery");
  assert.equal((sent[0].text.match(/chloroplasts/g) ?? []).length, 1, "the answer appears once");
  // Nothing is released until every check has ended, and none starts after.
  const first = events.findIndex((e) => e.type === "delta");
  const lastActivity = events.reduce((n, e, i) => (e.type === "activity" && e.step.kind !== "write" ? i : n), -1);
  assert.ok(lastActivity >= 0 && lastActivity < first, "the last check finished before the answer was released");
  assert.equal(steps(events).filter((s) => s.kind === "verify").at(-1).state, "done");
  // What is stored is what was delivered, notes included.
  assert.equal((await storedAnswer(w, events)).content, sent[0].text);
  assert.equal(events.at(-1).type, "done");
});

test("D2. ordinary chat is not held: it streams as it is written, with no whole-answer marker", async (t) => {
  const w = await world(t, { researchService: sourcesFor().service, reply: ["Hello! ", "How can I help ", "with your work today?"] });
  const events = await w.run("hello there");
  const sent = deltas(events);
  assert.ok(sent.length >= 2, `streamed in pieces (${sent.length})`);
  assert.ok(sent.every((d) => d.whole === undefined));
  assert.equal(sent.map((d) => d.text).join(""), "Hello! How can I help with your work today?");
});

test("D3. a failure in the preparation does not turn an answer that must be verified into one streamed unchecked", async (t) => {
  const outcomes = [];
  const sources = sourcesFor();
  // The research layer breaks as the turn starts. The answer is still held, still arrives whole, and says no source could be read.
  sources.service.session = () => {
    throw new Error("research is down");
  };
  const w = await world(t, { researchService: sources.service, reply: BIOLOGY_REPLY, log: (o) => outcomes.push(o) });
  const events = await w.run(BIOLOGY);
  const sent = deltas(events);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].whole, true);
  assert.match(sent[0].text, /No web sources could be read[\s\S]*unverified/i, "it is not presented as checked");
  assert.ok(outcomes.includes("study_failed"), "the failure is counted");
  assert.ok(steps(events).every((s) => s.state !== "running" || steps(events).some((x) => x.id === s.id && x.state !== "running")), "no step is left running");
});

test("D3b. a step the preparation had started when it failed ends as failed, never as done", async (t) => {
  const sources = sourcesFor();
  const original = sources.service.session.bind(sources.service);
  sources.service.session = (...args) => {
    const session = original(...args);
    session.verifyQuotation = async () => {
      throw new Error("lookup crashed");
    };
    return session;
  };
  const w = await world(t, { researchService: sources.service, reply: "That quotation is in the play." });
  const events = await w.run('Is this quote correct from Macbeth: "Out, out, brief candle"?');
  const checking = steps(events).filter((s) => s.label === "Checking the quotations in your message");
  assert.ok(checking.length >= 2, "the step started and then ended");
  assert.equal(checking.at(-1).state, "failed", "ended as failed, not done");
  const sent = deltas(events);
  assert.equal(sent.length, 1, "a quotation check is still held and delivered whole");
  assert.equal(sent[0].whole, true);
});

test("D4. Stop while a held answer is being checked: nothing is delivered, nothing is stored, no step is left running", async (t) => {
  const controller = new AbortController();
  const w = await world(t, { researchService: sourcesFor().service, reply: BIOLOGY_REPLY, signal: controller.signal });
  const events = [];
  for await (const e of svc.sendMessage(w.deps, { owner: w.owner, sessionId: null, text: BIOLOGY, signal: controller.signal })) {
    events.push(e);
    if (e.type === "activity" && e.step.kind === "verify" && e.step.state === "running") controller.abort();
  }
  assert.equal(deltas(events).length, 0, "the held answer was not released");
  assert.equal(await storedAnswer(w, events), undefined);
  const last = new Map();
  for (const s of steps(events)) last.set(s.id, s.state);
  assert.ok([...last.values()].every((state) => state !== "running"));
});

test("D5. a tool round shows its search while the search is still running, not after", async (t) => {
  let release;
  const gate = { promise: new Promise((r) => (release = r)) };
  const sources = research({ results: [raw("https://www.bbc.co.uk/bitesize/photo")], web: { "https://www.bbc.co.uk/bitesize/photo": PHOTO }, gate });
  const w = await world(t, {
    researchService: sources.service,
    toolUse: true,
    reply: (messages) => (messages.some((m) => m.role === "tool") ? "Here is what I found." : { toolCall: { name: "search_web", arguments: { query: "photosynthesis chloroplast" } } }),
  });
  const seen = [];
  let sawRunningBeforeDone = false;
  const timer = setTimeout(() => release(), 3000);
  for await (const e of svc.sendMessage(w.deps, { owner: w.owner, sessionId: null, text: "hello there" })) {
    seen.push(e);
    if (e.type === "activity" && e.step.kind === "search" && e.step.state === "running") {
      sawRunningBeforeDone = sources.queries.length > 0 && !seen.some((x) => x.type === "activity" && x.step.kind === "search" && x.step.state === "done");
      release();
    }
  }
  clearTimeout(timer);
  assert.equal(sawRunningBeforeDone, true, "the search step arrived while the search was pending");
  assert.ok(steps(seen).some((s) => s.kind === "search" && s.state === "done"));
  assert.equal(seen.at(-1).type, "done");
});

test("D6. a quotation the reply adds is looked up and shown as a step, with no quotation text in it", async () => {
  const sources = research({ results: [raw("https://www.folger.edu/macbeth")], web: { "https://www.folger.edu/macbeth": "<p>Out, out, brief candle. Life is but a walking shadow.</p>" } });
  const session = sources.service.session("owner", undefined, new act.ActivityLog());
  void session;
  const log = new act.ActivityLog();
  const prep = await studyLib.prepareStudy({ text: "Tell me about Macbeth and the idea of time passing in the play", material: "Tell me about Macbeth and the idea of time passing in the play", history: [], research: sources.service, extracts: [], owner: "owner", activity: log });
  const before = log.steps.length;
  const extra = await studyLib.finishStudy(prep, 'He says "a tale told by an idiot full of sound and fury" near the end.', { activity: log });
  void extra;
  const added = log.steps.slice(before);
  const step = added.find((s) => s.kind === "verify");
  assert.ok(step, "the lookup is a step");
  assert.equal(step.label, "Checking the quotations in the answer");
  assert.notEqual(step.state, "running");
  assert.doesNotMatch(JSON.stringify(added), /idiot|fury/, "what was looked up is not in the step");
});

test("D7. a page that is refused is never named, and a page that was read is linked only if it is public", async () => {
  const log = new act.ActivityLog();
  const service = new verify.ResearchService({
    searx: { available: true, search: async (q) => ({ status: "ok", query: q, results: [], detail: "ok" }) },
    limits: LIMITS,
    fetchOptions: { resolve: PUBLIC, fetcher: async () => htmlPage("<p>x</p>")() },
  });
  const session = service.session("owner", undefined, log);
  for (const url of ["http://127.0.0.1:11235/crawl", "http://localhost:8888/search?q=secret", "http://crawler.internal:11235/", "https://user:pass@www.bbc.co.uk/a", "http://169.254.169.254/latest/meta-data"]) await session.fetchPage(url);
  const text = JSON.stringify(log.steps);
  assert.doesNotMatch(text, /127\.0\.0\.1|localhost|crawler\.internal|169\.254|user:pass|secret/, "no refused address appears in any step");
  assert.ok(log.steps.every((s) => s.label === "Reading a page" && s.state === "failed"), "each was a failed 'Reading a page', with no address");
  const ok = new act.ActivityLog();
  const fine = service.session("owner", undefined, ok);
  await fine.fetchPage("https://www.bbc.co.uk/bitesize/photo");
  assert.equal(ok.steps[0].label, "Read www.bbc.co.uk".replace("www.", ""));
  assert.equal(ok.steps[0].source.url, "https://www.bbc.co.uk/bitesize/photo");
});

test("D8. a source link keeps the query a page needs and drops tracking, searches and anything that looks like a secret; it is never cut part-way", () => {
  const keep = act.safeSource({ url: "https://www.example.org/read?id=12&act=3&scene=1&utm_source=mail&fbclid=abc#top" });
  assert.equal(keep.url, "https://www.example.org/read?id=12&act=3&scene=1", "address parameters kept, tracking dropped");
  assert.equal(act.safeSource({ url: "https://www.example.org/results?q=my+private+question&page=2" }).url, "https://www.example.org/results?page=2", "a search phrase is never kept");
  assert.equal(act.safeSource({ url: "https://www.example.org/p?token=abc&email=a%40b.com&page=4" }).url, "https://www.example.org/p?page=4");
  assert.equal(act.safeSource({ url: `https://www.example.org/p?ticket=${"a".repeat(40)}&page=4` }).url, "https://www.example.org/p?page=4", "a long opaque value is dropped");
  assert.equal(act.safeSource({ url: "https://www.example.org/p?v=a@b.com" }).url, "https://www.example.org/p", "an address-like value is dropped");
  const long = act.safeSource({ url: `https://www.example.org/${"a".repeat(400)}?id=1` }).url;
  assert.ok(long.length <= 300);
  assert.equal(long, "https://www.example.org/", "a link too long to keep points at the site, it is not truncated into a broken one");
  assert.equal(act.safeSource({ url: `https://www.example.org/read?id=${"1".repeat(60)}&page=${"2".repeat(250)}` }).url.length <= 300, true);
});

test("D9. how a turn ended is stored with its steps, and a record without one reads as completed", () => {
  const finished = [{ id: "read-1", kind: "read", state: "done", label: "Read bbc.co.uk" }, { id: "verify-2", kind: "verify", state: "failed", label: "Checking", detail: "x" }];
  for (const outcome of ["stopped", "failed"]) {
    const record = act.serializeActivity(finished, outcome);
    assert.equal(act.parseActivityRecord(record).outcome, outcome);
    assert.equal(act.parseActivity(record).length, 2);
  }
  assert.equal(JSON.parse(act.serializeActivity(finished)).outcome, undefined, "a completed turn adds nothing");
  assert.equal(act.parseActivityRecord(act.serializeActivity(finished)).outcome, "done");
  assert.equal(act.parseActivityRecord(JSON.stringify({ v: 1, outcome: "exploded", steps: finished })).outcome, "done", "an unknown outcome is not trusted");
  assert.equal(act.parseActivityRecord("nonsense").outcome, "done");
  assert.deepEqual(act.parseActivityRecord(null).steps, []);
});

// ---- both hosted models, through the one pipeline -------------------------------------------------------------------------------------------

const MINIMAX = "minimaxai/minimax-m3.1-flash";
const STEP = "stepfun-ai/step-5-preview";
const LAB_ENV = { NODE_ENV: "development", ASSISTANT_PROVIDER: "mock", NVIDIA_API_KEY: "nvapi-TEST-KEY", ASSISTANT_NIM_MODELS: `${MINIMAX},${STEP}` };
const sse = (parts) => new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(`data: ${typeof p === "string" ? p : JSON.stringify(p)}\n\n`)); c.enqueue(new TextEncoder().encode("data: [DONE]\n\n")); c.close(); } }));
const piece = (t) => ({ choices: [{ delta: { content: t } }] });
const thought = (t) => ({ choices: [{ delta: { reasoning_content: t } }] });

test("D10. MiniMax M3.1 Flash and Step 5 go through the same pipeline: the same steps, the same single delivery, and their hidden reasoning is never shown or stored", async (t) => {
  environment(t, {});
  quiet(t);
  openaiLib.resetAcceptedFields();
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/models")) return Response.json({ object: "list", data: [{ id: MINIMAX }, { id: STEP }] });
    const body = JSON.parse(init.body);
    requests.push(body.model);
    // A reasoning model thinks first (never shown), then writes the answer.
    return sse([thought("SECRET-CHAIN-OF-THOUGHT let me work this out"), piece(BIOLOGY_REPLY.slice(0, 50)), piece(BIOLOGY_REPLY.slice(50)), { choices: [], usage: { prompt_tokens: 10, completion_tokens: 12 } }]);
  };
  const config = cfgLib.assistantConfig(LAB_ENV);
  const lab = rt.buildModelLab(config, LAB_ENV, fetchImpl);
  const fallback = new MockProvider({ delayMs: 0 });
  const store = new InMemoryLibraryStore();
  const profile = store.seedProfile({ email: "dev@example.com", role: "ADMIN" });
  const clientId = await store.accounts.ensureClient(profile);
  const owner = { clientId, studentId: null };
  const sources = sourcesFor();
  const runWith = async (choice) => {
    const picked = selection.resolveSelection({ requested: choice, actor: { role: "ADMIN", mode: "staff", studentId: null }, lab, config, provider: fallback, hosted: false });
    assert.ok(picked.ok);
    const deps = { store, provider: fallback, queue: new GenerationQueue(1, 4), uploads: new MemoryLibraryStorage(), config, target: picked.target, research: sources.service, now: () => new Date("2026-10-21T10:30:00Z"), log: () => {} };
    const events = [];
    for await (const e of svc.sendMessage(deps, { owner, sessionId: null, text: BIOLOGY })) events.push(e);
    return events;
  };
  const a = await runWith("minimax-m3.1-flash");
  const b = await runWith("step-5-preview");
  assert.deepEqual(requests, [MINIMAX, STEP], "each model answered its own question");
  assert.deepEqual(steps(a).map((s) => `${s.kind}:${s.state}`), steps(b).map((s) => `${s.kind}:${s.state}`), "the same activity, whichever model wrote it");
  for (const events of [a, b]) {
    const sent = deltas(events);
    assert.equal(sent.length, 1, "one delivery");
    assert.equal(sent[0].whole, true);
    assert.doesNotMatch(JSON.stringify(events), /SECRET-CHAIN-OF-THOUGHT/, "no reasoning reached the page");
    assert.equal(events.at(-1).type, "done");
  }
  assert.equal(a.at(-1).model, "MiniMax M3.1 Flash");
  assert.equal(b.at(-1).model, "Step 5 Preview");
  const kept = (await store.chat.listMessages(owner, a.find((e) => e.type === "session").sessionId)).map((m) => `${m.content}${m.activity ?? ""}`).join("");
  assert.doesNotMatch(kept, /SECRET-CHAIN-OF-THOUGHT/, "no reasoning was stored");
});

test("D11. the model is told to write only the answer when research is on: the page, not the answer, shows what was searched and read", async (t) => {
  const withResearch = await world(t, { researchService: sourcesFor().service, reply: BIOLOGY_REPLY });
  await withResearch.run(BIOLOGY);
  const prompt = withResearch.provider.requests[0].find((m) => m.role === "system").content;
  assert.match(prompt, /Write only the answer[\s\S]*do not describe your searching, reading or checking in the answer/);
  const without = await world(t, { reply: BIOLOGY_REPLY });
  await without.run(BIOLOGY);
  assert.doesNotMatch(without.provider.requests[0].find((m) => m.role === "system").content, /Write only the answer/, "nothing about a panel that does not exist");
});

// ---- Stop keeps what was shown, however the stop and the stream interleave ----------------------------------------------------------------

/** A model that writes one short sentence every 25 ms and stops when it is told to. */
class Slow {
  id = "mock";
  async capabilities() {
    return { vision: false, jsonMode: false, toolUse: false, maxContext: 8192 };
  }
  async health() {
    return { ok: true, detail: "ok" };
  }
  async *stream(_messages, options) {
    for (let i = 0; i < 60; i += 1) {
      await new Promise((r) => setTimeout(r, 25));
      if (options.signal?.aborted) throw new ProviderError("aborted", this.id);
      yield { type: "text", text: `Sentence ${i}. ` };
    }
    yield { type: "done", provider: "mock", model: "mock", usage: { promptTokens: 1, completionTokens: 1 }, stats: { firstTokenMs: 1, totalMs: 1 } };
  }
}

async function slowWorld(t) {
  const w = await world(t, { reply: "unused" });
  w.deps.provider = new Slow();
  return w;
}

test("D12. Stop keeps what was shown: the partial answer is stored, with its activity closed, whether the reader stops reading or keeps reading to the end", async (t) => {
  // (a) the page closes the connection: the reader is ended at its next yield (what a browser's Stop does to the stream).
  const a = await slowWorld(t);
  const it = svc.sendMessage(a.deps, { owner: a.owner, sessionId: null, text: "hello there" });
  const seen = [];
  let sessionId = null;
  for (;;) {
    const next = await it.next();
    assert.equal(next.done, false);
    seen.push(next.value);
    if (next.value.type === "session") sessionId = next.value.sessionId;
    if (seen.filter((e) => e.type === "delta").length >= 3) break;
  }
  await it.return(undefined);
  const kept = (await a.store.chat.listMessages(a.owner, sessionId)).filter((m) => m.role === "assistant");
  assert.equal(kept.length, 1, "the partial answer was stored");
  assert.match(kept[0].content, /^Sentence 0\./);
  assert.doesNotMatch(kept[0].content, /Sentence 59/, "and it is only what was written before Stop");
  assert.ok(kept[0].content.length > 20);

  // (b) the request is aborted and the reader keeps reading to the end: the same result, and the last activity events arrive, all closed.
  const controller = new AbortController();
  const b = await slowWorld(t);
  const events = [];
  for await (const e of svc.sendMessage(b.deps, { owner: b.owner, sessionId: null, text: "hello there", signal: controller.signal })) {
    events.push(e);
    if (events.filter((x) => x.type === "delta").length === 3) controller.abort();
  }
  const stored = (await b.store.chat.listMessages(b.owner, events.find((e) => e.type === "session").sessionId)).filter((m) => m.role === "assistant");
  assert.equal(stored.length, 1);
  assert.match(stored[0].content, /^Sentence 0\./);
  assert.doesNotMatch(stored[0].content, /Sentence 59/);
  const last = new Map();
  for (const step of steps(events)) last.set(step.id, step.state);
  assert.ok([...last.values()].every((state) => state !== "running"), "no step left running");
  assert.equal(events.at(-1).type, "done");
});

test("D13. a reader that goes away mid-turn ends the work: nothing keeps generating for nobody", async (t) => {
  let produced = 0;
  const w = await slowWorld(t);
  const original = w.deps.provider.stream.bind(w.deps.provider);
  w.deps.provider.stream = async function* (messages, options) {
    for await (const chunk of original(messages, options)) {
      produced += 1;
      yield chunk;
    }
  };
  const it = w.deps.provider ? svc.sendMessage(w.deps, { owner: w.owner, sessionId: null, text: "hello there" }) : null;
  let deltas = 0;
  while (deltas < 2) if ((await it.next()).value.type === "delta") deltas += 1;
  await it.return(undefined);
  const atReturn = produced;
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(produced <= atReturn + 1, `the model kept writing after the reader left (${atReturn} -> ${produced})`);
});
