#!/usr/bin/env node
/**
 * Checks a REAL SearXNG instance the way Study Buddy will use it (docs/RESEARCH.md). It makes one or two real searches, so run it by hand; no test
 * calls it, and it prints what happened without claiming more than it saw.
 *
 *   node apps/web/scripts/research-check.mjs                    uses SEARXNG_BASE_URL (default http://127.0.0.1:8888)
 *   node apps/web/scripts/research-check.mjs --query "AQA GCSE English Literature specification"
 *   node apps/web/scripts/research-check.mjs --base http://127.0.0.1:8888
 *
 * Exit code 0: JSON search works and returned results. 1: it did not (the reason is printed with the fix).
 */
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const base = (option("base", process.env.SEARXNG_BASE_URL) || "http://127.0.0.1:8888").replace(/\/?$/, "/");
const query = option("query", "AQA GCSE English Literature specification");
const timeoutMs = Number(process.env.SEARXNG_TIMEOUT_MS) || 8000;

const say = (line) => console.log(`[research-check] ${line}`);
const fail = (line) => {
  say(`FAILED: ${line}`);
  process.exit(1);
};

const url = new URL("search", base);
url.searchParams.set("q", query);
url.searchParams.set("format", "json");
url.searchParams.set("safesearch", "1");

say(`searching ${new URL(base).origin} for: ${query}`);
let response;
const started = Date.now();
try {
  response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
} catch (error) {
  const code = error?.cause?.code ?? error?.name ?? "error";
  fail(`could not reach ${new URL(base).origin} (${code}). Is the instance running? npm start runs it; or: docker compose -f config/compose.yaml up -d searxng`);
}

if (response.status === 403) fail("HTTP 403. SearXNG has the JSON format switched off. Add `json` to `search.formats` in its settings.yml (see config/searxng/settings.yml) and restart it.");
if (response.status === 429) fail("HTTP 429. SearXNG's limiter is rejecting this client. Turn the limiter off for a private instance, or give it Valkey.");
if (!response.ok) fail(`HTTP ${response.status}.`);

let body;
try {
  body = await response.json();
} catch {
  fail("the answer was not JSON. Check SEARXNG_BASE_URL points at SearXNG itself and that the json format is enabled.");
}
const results = Array.isArray(body?.results) ? body.results : [];
say(`HTTP 200 in ${Date.now() - started} ms, ${results.length} results`);
if (!results.length) {
  const unresponsive = Array.isArray(body?.unresponsive_engines) ? body.unresponsive_engines.map((e) => (Array.isArray(e) ? e.join(": ") : String(e))) : [];
  fail(`no results${unresponsive.length ? `; engines that did not answer: ${unresponsive.slice(0, 5).join(", ")}` : ""}. The instance works but its upstream engines gave nothing (they may be rate limiting it).`);
}
for (const r of results.slice(0, 5)) {
  let host = "?";
  try {
    host = new URL(r.url).hostname;
  } catch {
    // an unreadable address is still shown as ?
  }
  say(`  ${host}  ${String(r.title ?? "").slice(0, 70)}  [${(r.engines ?? [r.engine]).filter(Boolean).slice(0, 3).join(", ")}]`);
}
say("OK: JSON search works. Study Buddy uses this address (SEARXNG_BASE_URL, default http://127.0.0.1:8888).");
