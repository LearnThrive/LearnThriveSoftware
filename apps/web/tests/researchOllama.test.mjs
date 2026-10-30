import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// Ollama's hosted web search and page reader (docs/RESEARCH.md): the request it makes, what it keeps, how every failure is named, and how it sits in front
// of SearXNG and Crawl4AI. Every network call is a fake; these prove the code, not that Ollama's service is up (`npm run assistant:beam-check`).

const web = loadTsFrom(import.meta.url, "../src/lib/assistant/research/ollamaWeb.ts");
const fetchSource = loadTsFrom(import.meta.url, "../src/lib/assistant/research/fetchSource.ts");
const rt = loadTsFrom(import.meta.url, "../src/lib/assistant/runtime.ts");
const cfgLib = loadTsFrom(import.meta.url, "../src/lib/assistant/config.ts");

const KEY = "ollama-TEST-KEY-0123456789";
const CONFIG = { baseUrl: "https://ollama.com", apiKey: KEY, timeoutMs: 2000, maxResults: 5, cacheTtlSeconds: 60 };
const json = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) });

function client(handler, config = {}) {
  const calls = [];
  const c = new web.OllamaWebClient({ ...CONFIG, ...config }, async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return handler(url, init, calls.length);
  });
  return { c, calls };
}

test("search: the documented request, the key only in the header, and results kept as leads", async () => {
  const { c, calls } = client(() => json({ results: [{ title: "Macbeth Act 5 Scene 1", url: "https://shakespeare.mit.edu/macbeth/macbeth.5.1.html", content: "Out, damned spot! out, I say!" }] }));
  const out = await c.search("  Macbeth   Act 5 ");
  assert.equal(out.status, "ok");
  assert.equal(calls[0].url, "https://ollama.com/api/web_search");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(calls[0].body, { query: "Macbeth Act 5", max_results: 5 });
  assert.ok(!JSON.stringify(calls[0].body).includes(KEY), "the key is not in the body");
  assert.deepEqual(out.results[0], { title: "Macbeth Act 5 Scene 1", url: "https://shakespeare.mit.edu/macbeth/macbeth.5.1.html", snippet: "Out, damned spot! out, I say!", engines: ["ollama"], category: "general", publishedDate: null });
  assert.ok(!JSON.stringify(out).includes(KEY), "nothing returned carries the key");
});

test("search: only public web addresses are kept, duplicates go, and the number asked for is bounded by the API's own maximum", async () => {
  const { c, calls } = client(() =>
    json({
      results: [
        { title: "a", url: "https://example.org/page", content: "x" },
        { title: "a again", url: "https://example.org/page/#section", content: "x" },
        { title: "script", url: "javascript:alert(1)", content: "x" },
        { title: "file", url: "file:///etc/passwd", content: "x" },
        { title: "no url", content: "x" },
        "not an object",
        { title: "b", url: "http://example.net/", content: "y".repeat(900) },
      ],
    }),
    { maxResults: 99 },
  );
  const out = await c.search("anything");
  assert.deepEqual(out.results.map((r) => r.url), ["https://example.org/page", "http://example.net/"]);
  assert.equal(out.results[1].snippet.length, 500, "a snippet is bounded");
  assert.equal(calls[0].body.max_results, 10, "the API takes at most 10");
});

test("search: identical searches are cached, a failure is a status never a throw, and no key means nothing is called", async () => {
  const hit = client(() => json({ results: [{ title: "t", url: "https://example.org/", content: "c" }] }));
  await hit.c.search("same question");
  await hit.c.search("SAME   question");
  assert.equal(hit.calls.length, 1, "the second search was answered from the cache");

  const cases = [
    [() => json({}, 401), "unavailable", /refused the key/],
    [() => json({}, 403), "unavailable", /refused the key/],
    [() => json({}, 429), "rate_limited", /rate limiting/],
    [() => json({}, 500), "unavailable", /HTTP 500/],
    [() => ({ status: 200, ok: true, text: async () => "<html>" }), "bad_response", /did not return JSON/],
    [() => json({ nothing: true }), "bad_response", /no results list/],
    [() => ({ status: 200, ok: true, text: async () => "x".repeat(4_100_000) }), "bad_response", /larger than expected/],
    [() => { throw new Error("ECONNREFUSED"); }, "unavailable", /could not be reached/],
    [() => json({ results: [] }), "empty", /found nothing/],
  ];
  for (const [handler, status, detail] of cases) {
    const out = await client(handler).c.search("question");
    assert.equal(out.status, status);
    assert.match(out.detail, detail);
    assert.ok(!out.detail.includes(KEY), "an operator-facing detail never carries the key");
  }
  const slow = new web.OllamaWebClient({ ...CONFIG, timeoutMs: 30 }, (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
  assert.equal((await slow.search("question")).status, "timeout");
  const stopped = new AbortController();
  const waiting = new web.OllamaWebClient(CONFIG, (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
  const pending = waiting.search("question", { signal: stopped.signal });
  stopped.abort();
  assert.equal((await pending).detail, "The request was stopped.");

  const keyless = client(() => json({ results: [] }), { apiKey: "  " });
  assert.equal(keyless.c.available, false);
  const out = await keyless.c.search("question");
  assert.equal(out.status, "disabled");
  assert.equal(keyless.calls.length, 0, "no key, no request");
  assert.equal((await keyless.c.crawl("https://example.org/")).status, "disabled");
  assert.equal((await client(() => json({})).c.search("   ")).status, "empty");
});

test("page reader: the page's own text comes back shaped like the browser reader, and every failure is a status", async () => {
  const ok = client(() => json({ title: "Macbeth Act 5", content: "LADY MACBETH Out, damned spot!", links: ["https://example.org/x"] }));
  const page = await ok.c.crawl("https://shakespeare.mit.edu/macbeth/macbeth.5.1.html");
  assert.equal(ok.calls[0].url, "https://ollama.com/api/web_fetch");
  assert.deepEqual(ok.calls[0].body, { url: "https://shakespeare.mit.edu/macbeth/macbeth.5.1.html" });
  assert.equal(page.status, "ok");
  assert.equal(page.text, "LADY MACBETH Out, damned spot!");
  assert.equal(page.title, "Macbeth Act 5");
  assert.equal(page.finalUrl, "https://shakespeare.mit.edu/macbeth/macbeth.5.1.html", "the address that was asked for: the API reports no redirect, and it was checked before it was sent");
  assert.equal(page.reader, "ollama");
  assert.equal((await client(() => json({ content: "  " })).c.crawl("https://example.org/")).status, "extraction_failed");
  assert.equal((await client(() => json({}, 401)).c.crawl("https://example.org/")).status, "unauthorised");
  assert.equal((await client(() => json({}, 429)).c.crawl("https://example.org/")).status, "unavailable");
  assert.equal((await client(() => { throw new Error("down"); }).c.crawl("https://example.org/")).status, "unavailable");
});

test("fetchSource reads a page through Ollama and says it did, and still checks the address first", async () => {
  const { c, calls } = client(() => json({ title: "Photosynthesis", content: "Photosynthesis happens in the chloroplasts of plant cells. ".repeat(20) }));
  const html = "<html><title>Photosynthesis</title><body><p>short</p></body></html>";
  const direct = async () => ({ status: 200, headers: { get: (n) => (n.toLowerCase() === "content-type" ? "text/html" : null) }, read: async () => ({ bytes: new TextEncoder().encode(html), truncated: false }) });
  const got = await fetchSource.fetchSource("https://www.bbc.co.uk/bitesize/photo", { fetcher: direct, resolve: async () => ["93.184.216.34"], crawler: c });
  assert.equal(got.ok, true);
  assert.equal(got.via, "ollama");
  assert.match(got.text, /chloroplasts/);
  assert.equal(calls.length, 1);
  // A private address never reaches Ollama's reader.
  const refused = await fetchSource.fetchSource("http://10.0.0.5/secret", { fetcher: direct, resolve: async () => ["10.0.0.5"], crawler: c });
  assert.equal(refused.ok, false);
  assert.equal(calls.length, 1, "nothing was sent to Ollama for it");
});

test("composite search: the first provider that finds something answers; a failure falls through, and the honest status survives", async () => {
  const provider = (status, results = [], available = true) => ({ available, search: async (q) => ({ status, query: q, results, detail: status }) });
  const row = [{ title: "t", url: "https://example.org/", snippet: "", engines: [], category: "", publishedDate: null }];
  const calls = [];
  const spy = (inner, name) => ({ available: inner.available, search: async (q, o) => (calls.push(name), inner.search(q, o)) });
  const both = new web.CompositeSearch([spy(provider("unavailable"), "ollama"), spy(provider("ok", row), "searx")]);
  assert.equal((await both.search("q")).status, "ok");
  assert.deepEqual(calls, ["ollama", "searx"]);
  calls.length = 0;
  const first = new web.CompositeSearch([spy(provider("ok", row), "ollama"), spy(provider("ok", row), "searx")]);
  assert.equal((await first.search("q")).status, "ok");
  assert.deepEqual(calls, ["ollama"], "the second is not asked when the first answered");
  assert.equal((await new web.CompositeSearch([provider("unavailable"), provider("empty")]).search("q")).status, "empty", "a working search that found nothing is more honest than a failed one");
  assert.equal((await new web.CompositeSearch([provider("rate_limited"), provider("timeout")]).search("q")).status, "rate_limited", "all failed: the first failure is what is reported");
  assert.equal(new web.CompositeSearch([provider("ok", row, false)]).available, false);
  assert.equal((await new web.CompositeSearch([]).search("q")).status, "disabled");
});

test("composite reader: Ollama's page reader first, the browser behind it, and a failure of both is reported with both reasons", async () => {
  const reader = (status, text = "", detail = status) => ({ available: true, crawl: async (url) => ({ status, detail, url, finalUrl: url, title: "", text, html: "", httpStatus: null }) });
  const first = await new web.CompositeReader([reader("ok", "from ollama"), reader("ok", "from browser")]).crawl("https://example.org/");
  assert.equal(first.text, "from ollama");
  const second = await new web.CompositeReader([reader("unavailable"), reader("ok", "from browser")]).crawl("https://example.org/");
  assert.equal(second.text, "from browser");
  const none = await new web.CompositeReader([reader("unavailable", "", "ollama down"), reader("timeout", "", "browser slow")]).crawl("https://example.org/");
  assert.notEqual(none.status, "ok");
  assert.match(none.detail, /ollama down.*browser slow/);
  assert.equal((await new web.CompositeReader([]).crawl("https://example.org/")).status, "disabled");
});

test("the research stack: Ollama leads when a key is set, SearXNG alone without one, and the choice can be forced", async () => {
  const names = (service) => Object.keys(service);
  void names;
  const config = (extra = {}) => cfgLib.assistantConfig({ NODE_ENV: "development", ASSISTANT_PROVIDER: "mock", ...extra });
  const requested = [];
  const fetchImpl = async (url) => (requested.push(String(url)), json({ results: [{ title: "t", url: "https://www.bbc.co.uk/x", content: "c" }] }));
  const withKey = rt.buildResearch(config(), { OLLAMA_API_KEY: KEY }, fetchImpl);
  const found = await withKey.deps.searx.search("question");
  assert.equal(found.status, "ok");
  assert.ok(requested.some((u) => u === "https://ollama.com/api/web_search"), "the first request went to Ollama");
  requested.length = 0;
  const without = rt.buildResearch(config(), {}, fetchImpl);
  await without.deps.searx.search("question");
  assert.deepEqual(requested, [], "no key: Ollama is never asked");
  const only = rt.buildResearch(config({ RESEARCH_PROVIDER: "searxng" }), { OLLAMA_API_KEY: KEY }, fetchImpl);
  await only.deps.searx.search("question");
  assert.ok(!requested.some((u) => u.includes("ollama.com")), "searxng only, even with a key");
  assert.equal(cfgLib.assistantConfig({ RESEARCH_PROVIDER: "bogus" }).research.provider, "auto");
});
