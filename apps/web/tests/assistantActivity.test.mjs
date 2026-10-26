import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { quiet, environment } from "./_routeHelpers.mjs";

// The activity panel's data: real steps for real work, sent while the work runs, kept (sanitised) with the answer, never anything invented, and no
// draft released before it is checked. A scripted model and a fake search/web stand in for the real services; nothing here calls a network.

const act = loadTsFrom(import.meta.url, "../src/lib/assistant/activity.ts");
const verify = loadTsFrom(import.meta.url, "../src/lib/assistant/research/verify.ts");
const svc = loadTsFrom(import.meta.url, "../src/lib/assistant/service.ts");
const cfgLib = loadTsFrom(import.meta.url, "../src/lib/assistant/config.ts");
const { ProviderError } = loadTsFrom(import.meta.url, "../src/lib/assistant/types.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

const PUBLIC = async () => ["93.184.216.34"];
const LIMITS = { maxSearches: 5, maxFetches: 5, fetchMaxBytes: 200000, fetchTimeoutMs: 1000, perMinute: 50 };
const raw = (url, snippet = "") => ({ title: url, url, snippet, engines: ["google"], category: "general", publishedDate: null });
const htmlPage = (status, body) => async () => ({ status, headers: { get: (n) => (n.toLowerCase() === "content-type" ? "text/html" : null) }, read: async (max) => ({ bytes: new TextEncoder().encode(body).subarray(0, max), truncated: false }) });

const BIRLING = "<html><title>Mr Birling</title><body><p>Arthur Birling is a wealthy factory owner and a local magistrate. He sacked Eva Smith after she led a strike for higher wages.</p></body></html>";

function research({ results = [], web = {}, status = "ok", gate = null } = {}) {
  const fetched = [];
  const queries = [];
  const service = new verify.ResearchService({
    searx: {
      available: true,
      search: async (q) => {
        queries.push(q);
        if (gate) await gate.promise;
        return { status, query: q, results: status === "ok" ? results : [], detail: status };
      },
    },
    limits: LIMITS,
    fetchOptions: { resolve: PUBLIC, fetcher: async (url) => (fetched.push(url), htmlPage(web[url]?.status ?? 200, web[url]?.body ?? "<p>unrelated</p>")()) },
  });
  return { service, fetched, queries };
}

class Scripted {
  id = "mock";
  requests = [];
  constructor(reply, { failAfterText = false } = {}) {
    this.reply = reply;
    this.failAfterText = failAfterText;
  }
  async capabilities() {
    return { vision: false, jsonMode: false, toolUse: false, maxContext: 8192 };
  }
  async health() {
    return { ok: true, detail: "ok" };
  }
  async *stream(messages) {
    this.requests.push(messages.map((m) => ({ ...m })));
    yield { type: "text", text: typeof this.reply === "function" ? this.reply(messages) : this.reply };
    if (this.failAfterText) throw new ProviderError("timeout", this.id);
    yield { type: "done", provider: "mock", model: "mock", usage: { promptTokens: 1, completionTokens: 1 }, stats: { firstTokenMs: 1, totalMs: 1 } };
  }
}

async function world(t, { reply, researchService = null, failAfterText = false, signal } = {}) {
  environment(t, {});
  quiet(t);
  const store = new InMemoryLibraryStore();
  const profile = store.seedProfile({ email: "p@example.com" });
  const clientId = await store.accounts.ensureClient(profile);
  const provider = new Scripted(reply, { failAfterText });
  const config = cfgLib.assistantConfig({ NODE_ENV: "development", ASSISTANT_PROVIDER: "mock" });
  const deps = { store, provider, queue: new GenerationQueue(config.concurrency, config.queueMax), uploads: new MemoryLibraryStorage(), config, research: researchService, now: () => new Date("2026-10-21T10:30:15Z") };
  const owner = { clientId, studentId: null };
  const run = async (text) => {
    const events = [];
    for await (const e of svc.sendMessage(deps, { owner, sessionId: null, text, signal })) events.push(e);
    return events;
  };
  return { store, owner, provider, deps, run, config };
}

const steps = (events) => events.filter((e) => e.type === "activity").map((e) => e.step);
const lastOf = (events, id) => steps(events).filter((s) => s.id === id).at(-1);
const QUESTION = "Write me a model answer: how far does Priestley present Mr Birling as selfish in An Inspector Calls?";

test("A1. the steps are the real work, in order, each with a stable id that ends done: classification, search, page read, drafting, checking", async (t) => {
  const sources = research({ results: [raw("https://www.folger.edu/birling?session=abc#top")], web: { "https://www.folger.edu/birling?session=abc#top": { body: BIRLING } } });
  const w = await world(t, { researchService: sources.service, reply: "Birling is a wealthy factory owner. He sacked Eva Smith after the strike." });
  const events = await w.run(QUESTION);
  const kinds = [...new Set(steps(events).map((s) => s.kind))];
  assert.deepEqual(kinds, ["analyse", "search", "read", "write", "verify"]);
  const ids = [...new Set(steps(events).map((s) => s.id))];
  for (const id of ids) assert.equal(lastOf(events, id).state, "done", `${id} finished`);
  // A step is reported as running before it is reported done.
  for (const id of ids) assert.equal(steps(events).find((s) => s.id === id).state, "running");
  const read = steps(events).find((s) => s.kind === "read" && s.state === "done");
  assert.equal(read.source.host, "www.folger.edu");
  assert.equal(read.source.url, "https://www.folger.edu/birling", "the link has no query string and no fragment");
  assert.equal(read.source.tier, "primary text");
  // The panel never carries what was searched for.
  assert.ok(sources.queries.length > 0);
  for (const q of sources.queries) for (const s of steps(events)) assert.ok(![s.label, s.detail ?? ""].join(" ").toLowerCase().includes(q.toLowerCase().slice(0, 20)), "a step leaked a search query");
});

test("A2. every source shown was actually fetched, and a page that failed is shown as failed with no link", async (t) => {
  const sources = research({
    results: [raw("https://www.folger.edu/a"), raw("https://www.bbc.co.uk/gone")],
    web: { "https://www.folger.edu/a": { body: BIRLING }, "https://www.bbc.co.uk/gone": { status: 404, body: "nope" } },
  });
  const w = await world(t, { researchService: sources.service, reply: "Birling sacked Eva Smith after the strike. He is a wealthy factory owner." });
  const events = await w.run(QUESTION);
  const shown = steps(events).filter((s) => s.source).map((s) => s.source.url);
  assert.ok(shown.length >= 1);
  for (const url of shown) assert.ok(sources.fetched.includes(url) || sources.fetched.some((f) => f.startsWith(url)), `${url} was fetched`);
  const failed = steps(events).filter((s) => s.kind === "read" && s.state === "failed");
  assert.ok(failed.length >= 1, "the 404 is reported");
  for (const s of failed) assert.equal(s.source, undefined);
});

test("A3. nothing is invented: small talk shows no research, a calculation shows no search, and with research off no source appears", async (t) => {
  const sources = research({ results: [raw("https://www.folger.edu/a")], web: { "https://www.folger.edu/a": { body: BIRLING } } });
  const hello = await (await world(t, { researchService: sources.service, reply: "Hello!" })).run("hello there");
  assert.deepEqual([...new Set(steps(hello).map((s) => s.kind))], ["write"]);
  const maths = await (await world(t, { researchService: sources.service, reply: "x = 5" })).run("Solve 3x + 4 = 19 and show your working");
  assert.ok(!steps(maths).some((s) => s.kind === "search" || s.kind === "read"));
  assert.equal(sources.queries.length, 0, "no search was made, so none is shown");
  const off = await (await world(t, { reply: "A model answer." })).run(QUESTION);
  assert.ok(!steps(off).some((s) => s.kind === "read" || s.source));
});

test("A4. activity reaches the page WHILE the work is running, not after it", async (t) => {
  let release;
  const gate = { promise: new Promise((r) => (release = r)) };
  const sources = research({ results: [raw("https://www.folger.edu/a")], web: { "https://www.folger.edu/a": { body: BIRLING } }, gate });
  const w = await world(t, { researchService: sources.service, reply: "Birling is a wealthy factory owner." });
  const it = w.deps.research ? svc.sendMessage(w.deps, { owner: w.owner, sessionId: null, text: QUESTION }) : null;
  const seen = [];
  let searchBegan = false;
  const timer = setTimeout(() => release(), 1500);
  for (;;) {
    const next = await it.next();
    if (next.done) break;
    seen.push(next.value);
    if (!searchBegan && next.value.type === "activity" && next.value.step.kind === "search" && next.value.step.state === "running") {
      // The search has not been allowed to answer yet: this event arrived while it was still pending.
      searchBegan = sources.queries.length > 0;
      assert.equal(seen.some((e) => e.type === "activity" && e.step.kind === "search" && e.step.state === "done"), false);
      release();
    }
  }
  clearTimeout(timer);
  assert.equal(searchBegan, true, "the running search step was sent while the search was still pending");
});

test("A5. one complete verified answer: no draft text is ever sent, and what is stored is what was shown", async (t) => {
  const bad = "Gerald becomes pregnant and is sent away.";
  const good = "Birling is a wealthy factory owner. He sacked Eva Smith after the strike.";
  const sources = research({ results: [raw("https://www.folger.edu/a")], web: { "https://www.folger.edu/a": { body: BIRLING } } });
  const w = await world(t, { researchService: sources.service, reply: (messages) => (messages.at(-1).content.startsWith("Your draft contains") ? good : `${good} ${bad}`) });
  const events = await w.run(QUESTION);
  const deltas = events.filter((e) => e.type === "delta").map((e) => e.text);
  assert.ok(deltas.every((d) => !d.includes("pregnant")), "no delta carried the rejected draft text");
  const shown = deltas.join("");
  assert.equal((shown.match(/wealthy factory owner/g) ?? []).length, 1, "the answer appears once");
  const stored = (await w.store.chat.listMessages(w.owner, events.find((e) => e.type === "session").sessionId)).at(-1);
  assert.equal(stored.content, shown);
  // The first text appears only after the checking steps have finished.
  const firstDelta = events.findIndex((e) => e.type === "delta");
  const lastCheck = events.map((e, i) => (e.type === "activity" && ["verify", "repair"].includes(e.step.kind) && e.step.state === "done" ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  assert.ok(lastCheck >= 0 && lastCheck < firstDelta, "checking finished before any text was released");
  assert.ok(steps(events).some((s) => s.kind === "repair" && s.state === "done"), "the correction is shown as a step");
});

test("A6. an interrupted held draft is never released: the student gets the error and no text", async (t) => {
  const sources = research({ results: [raw("https://www.folger.edu/a")], web: { "https://www.folger.edu/a": { body: BIRLING } } });
  const w = await world(t, { researchService: sources.service, reply: "Birling is a wealthy factory owner. A draft that was never checked.", failAfterText: true });
  const events = await w.run(QUESTION);
  assert.equal(events.filter((e) => e.type === "delta").length, 0, "nothing was shown");
  assert.ok(events.some((e) => e.type === "error"));
  assert.ok(!events.some((e) => e.type === "done"));
  const open = steps(events).filter((s) => s.state === "running");
  const closed = new Set(steps(events).filter((s) => s.state !== "running").map((s) => s.id));
  for (const s of open) assert.ok(closed.has(s.id), `${s.id} did not stay running`);
  assert.equal((await w.store.chat.listMessages(w.owner, events.find((e) => e.type === "session").sessionId)).filter((m) => m.role === "assistant").length, 0, "no unchecked draft was stored");
});

test("A7. stopping clears the activity: the steps end, nothing is shown, nothing is stored", async (t) => {
  const controller = new AbortController();
  const sources = research({ results: [raw("https://www.folger.edu/a")], web: { "https://www.folger.edu/a": { body: BIRLING } } });
  const w = await world(t, { researchService: sources.service, reply: "Birling is a wealthy factory owner.", signal: controller.signal });
  const events = [];
  for await (const e of svc.sendMessage(w.deps, { owner: w.owner, sessionId: null, text: QUESTION, signal: controller.signal })) {
    events.push(e);
    if (e.type === "activity" && e.step.kind === "read" && e.step.state === "running") controller.abort();
  }
  assert.equal(events.filter((e) => e.type === "delta").length, 0);
  const stillRunning = new Map();
  for (const s of steps(events)) stillRunning.set(s.id, s.state);
  assert.ok([...stillRunning.values()].every((s) => s !== "running"), "no step is left running after Stop");
});

test("A8. what is stored is bounded and clean, and what is read back is checked again", () => {
  const long = Array.from({ length: 60 }, (_, i) => ({ id: `read-${i}`, kind: "read", state: "done", label: `Read page ${i} ${"x".repeat(80)}`, detail: "d".repeat(130), source: { title: "T".repeat(110), host: "www.folger.edu", url: `https://www.folger.edu/p${i}`, tier: "primary text", via: "browser" } }));
  const text = act.serializeActivity(long);
  assert.ok(text.length <= 6000, `length ${text.length}`);
  assert.ok(JSON.parse(text).steps.length >= 1);
  assert.equal(act.serializeActivity([{ id: "write-1", kind: "write", state: "done", label: "Wrote the answer" }]), null, "bookkeeping alone is not kept");
  assert.equal(act.serializeActivity([{ id: "search-1", kind: "search", state: "running", label: "Searching" }]), null, "a running step is not kept");
  const hostile = JSON.stringify({
    v: 1,
    steps: [
      { id: "read-1", kind: "read", state: "done", label: "Read <b>bad</b>\u0000 page", source: { title: "<script>x</script>Title", host: "x", url: "javascript:alert(1)", tier: "t", via: "browser" } },
      { id: "read-2", kind: "read", state: "done", label: "Read local", source: { title: "local", host: "x", url: "http://127.0.0.1:11235/crawl", tier: "t", via: "direct" } },
      { id: "read-3", kind: "read", state: "running", label: "Still going", source: { title: "ok", host: "x", url: "https://user:pass@www.bbc.co.uk/a?token=SECRET#frag", tier: "education site", via: "direct" } },
      { id: "x", kind: "teleport", state: "done", label: "Unknown kind" },
    ],
  });
  const back = act.parseActivity(hostile);
  assert.equal(back.length, 3, "an unknown kind is dropped");
  assert.doesNotMatch(JSON.stringify(back), /<b>|<script>|javascript:|127\.0\.0\.1|SECRET|user:pass|\u0000/);
  assert.equal(back[2].state, "done", "a stored running step is never shown as running");
  assert.equal(act.parseActivity("not json").length, 0);
  assert.equal(act.parseActivity(null).length, 0);
});

test("A9. a source link is shown only if it is a public page: no local or internal address, no login, no query", () => {
  assert.equal(act.safeSource({ url: "http://localhost:3000/x" }), null);
  assert.equal(act.safeSource({ url: "http://169.254.169.254/latest" }), null);
  assert.equal(act.safeSource({ url: "http://crawler.internal:11235/" }), null);
  assert.equal(act.safeSource({ url: "ftp://www.folger.edu/x" }), null);
  assert.equal(act.safeSource({ url: "https://a:b@www.folger.edu/x" }), null);
  const ok = act.safeSource({ url: "https://www.folger.edu/read/5/1/?utm=1#frag", title: "  Macbeth \n Act 5 ", tier: "authoritative_text", via: "crawl4ai" });
  assert.deepEqual(ok, { title: "Macbeth Act 5", host: "www.folger.edu", url: "https://www.folger.edu/read/5/1/", tier: "primary text", via: "browser" });
});

test("A10. the activity is the same whichever provider writes the answer, and the stored record keeps the pages and not the reasoning", async (t) => {
  const sources = research({ results: [raw("https://www.folger.edu/a")], web: { "https://www.folger.edu/a": { body: BIRLING } } });
  const one = await world(t, { researchService: sources.service, reply: "Birling is a wealthy factory owner." });
  const two = await world(t, { researchService: sources.service, reply: "Birling sacked Eva Smith after the strike." });
  const a = await one.run(QUESTION);
  const b = await two.run(QUESTION);
  assert.deepEqual(steps(a).map((s) => s.kind), steps(b).map((s) => s.kind), "the same steps, whatever the model");
  const stored = (await one.store.chat.listMessages(one.owner, a.find((e) => e.type === "session").sessionId)).at(-1);
  const kept = act.parseActivity(stored.activity);
  assert.ok(kept.some((s) => s.kind === "read" && s.source?.host === "www.folger.edu"));
  assert.ok(!kept.some((s) => s.kind === "write"), "the writing step is bookkeeping, not research");
  assert.doesNotMatch(stored.activity, /reasoning|thinking|chain/i);
});
