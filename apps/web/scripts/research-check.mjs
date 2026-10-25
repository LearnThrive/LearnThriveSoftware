#!/usr/bin/env node
/**
 * Checks the REAL research stack the way Study Buddy uses it (docs/RESEARCH.md): SearXNG, Crawl4AI, then the pipeline that joins them. It makes real
 * searches and real page loads, so run it by hand; no test calls it, and it prints only what it actually observed. A line is never printed as
 * passed unless the check ran and the result was what it should be.
 *
 *   npm run research:check                      all checks
 *   npm run research:check -- --skip-live       only the services and the local JavaScript fixture (no external website)
 *   npm run research:check -- --query "..."     the search used for the SearXNG check
 *
 * Exit code 0: every check that ran passed. 1: one failed. Checks that could not run are reported as SKIPPED, never as passed.
 */
import { assistantConfig } from "../src/lib/assistant/config.ts";
import { Crawl4aiClient } from "../src/lib/assistant/research/crawl4ai.ts";
import { checkEventClaims } from "../src/lib/assistant/research/claims.ts";
import { fetchSource } from "../src/lib/assistant/research/fetchSource.ts";
import { groundTurn } from "../src/lib/assistant/research/ground.ts";
import { SearxngClient } from "../src/lib/assistant/research/searxng.ts";
import { ResearchService } from "../src/lib/assistant/research/verify.ts";
import { InMemoryLibraryStore } from "../../../packages/data/src/library/memory.ts";
import { sendMessage } from "../src/lib/assistant/service.ts";
import { GenerationQueue } from "../src/lib/assistant/queue.ts";
import { MemoryLibraryStorage } from "../src/lib/library/storage.ts";
import { detectStudyContext } from "../src/lib/assistant/exam/context.ts";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const skipLive = args.includes("--skip-live");
const query = option("query", "Macbeth Lady Macbeth Out damned spot Act 5 Scene 1");

const config = assistantConfig({ ...process.env, NODE_ENV: "development" });
let failed = 0;
const line = (label, state, detail = "") => {
  if (state === "FAILED") failed += 1;
  console.log(`${label.padEnd(34)} ${state}${detail ? `  ${detail}` : ""}`);
};

/* ---- SearXNG ---------------------------------------------------------------------------------------------------------------------------- */
const searx = new SearxngClient({ enabled: true, baseUrl: config.research.baseUrl, timeoutMs: config.research.timeoutMs, maxResults: config.research.maxResults, cacheTtlSeconds: 0 });
const found = await searx.search(query);
if (found.status === "ok") line("SearXNG", "HEALTHY", `${found.results.length} results for "${query}"`);
else line("SearXNG", "FAILED", `${found.status}: ${found.detail}`);

/* ---- Crawl4AI --------------------------------------------------------------------------------------------------------------------------- */
const crawler = new Crawl4aiClient(config.crawler);
const health = await crawler.health();
if (!config.crawler.enabled) line("Crawl4AI", "SKIPPED", "switched off (CRAWL4AI_ENABLED)");
else if (health.ok) line("Crawl4AI", "HEALTHY", `version ${health.version ?? "?"}`);
else line("Crawl4AI", "FAILED", health.detail);

// A page whose text only exists after JavaScript has run. quotes.toscrape.com/js/ is a public practice site built for exactly this: its HTML holds
// the quotations inside a script, so a plain fetch finds no readable quotation and a real browser does. (A local fixture cannot be used: Crawl4AI's own
// address guard refuses private and local addresses, which is the behaviour we want from it, and its raw: input does not run scripts.)
if (health.ok && !skipLive) {
  const jsPage = "https://quotes.toscrape.com/js/";
  const plain = await fetchSource(jsPage, { crawler: null });
  const browser = await fetchSource(jsPage, { crawler });
  const plainSees = plain.ok && /The world as we have created it/.test(plain.text);
  const browserSees = browser.ok && browser.via === "crawl4ai" && /The world as we have created it/.test(browser.text);
  if (browserSees && !plainSees) line("Page extraction (JavaScript page)", "SUCCESS", "the browser read quotations that a plain fetch cannot see");
  else if (browserSees && plainSees) line("Page extraction (JavaScript page)", "INCONCLUSIVE", "both methods saw the text, so this page did not prove JavaScript rendering");
  else line("Page extraction (JavaScript page)", "FAILED", browser.ok ? `via ${browser.via}${browser.crawlNote ? `: ${browser.crawlNote}` : ""}` : `${browser.code}: ${browser.reason}`);
} else line("Page extraction (JavaScript page)", "SKIPPED", health.ok ? "--skip-live" : "Crawl4AI is not healthy");

/* ---- the pipeline ----------------------------------------------------------------------------------------------------------------------- */
if (skipLive) {
  line("Pipeline (live websites)", "SKIPPED", "--skip-live");
} else if (found.status !== "ok") {
  line("Pipeline (live websites)", "SKIPPED", "SearXNG gave no results");
} else {
  const service = new ResearchService({
    searx,
    limits: { maxSearches: 5, maxFetches: 5, fetchMaxBytes: config.research.fetchMaxBytes, fetchTimeoutMs: 20_000, perMinute: 60 },
    fetchOptions: { crawler: config.crawler.enabled && health.ok ? crawler : null },
    cacheTtlSeconds: 0,
  });
  const session = service.session("research-check");
  const question = "Write a model answer: starting with Act 5 Scene 1, how far is Lady Macbeth presented as changing in Macbeth?";
  const ctx = detectStudyContext(question);
  const started = Date.now();
  const grounding = await groundTurn(session, ctx, question);
  if (grounding.sources.length) line("Grounding", "SUCCESS", `${grounding.sources.length} page(s) read in ${Date.now() - started} ms: ${grounding.sources.map((s) => `${new URL(s.url).hostname} [${s.tier}]`).join(", ")}`);
  else line("Grounding", "FAILED", grounding.note);

  const via = [...session.read.values()].filter((p) => p.ok).map((p) => `${new URL(p.url).hostname}:${p.via}`);
  line("Extraction path", via.length ? "OBSERVED" : "FAILED", via.join(", ") || "no page was read");
  const fell = [...session.read.values()].filter((p) => p.ok && p.crawlNote).map((p) => p.crawlNote);
  if (fell.length) line("Crawler fallback", "OBSERVED", fell[0]);

  const right = await session.verifyQuotation({ quotation: "Out, damned spot! Out, I say!", work: "Macbeth", claimedSpeaker: "Lady Macbeth" });
  line("Quotation (right speaker)", right.status.toUpperCase(), `${right.speaker ?? "speaker unchecked"}${right.location ? `, ${right.location}` : ""} | ${right.note}`);
  const wrong = await session.verifyQuotation({ quotation: "Out, damned spot! Out, I say!", work: "Macbeth", claimedSpeaker: "Macbeth" });
  line("Quotation (wrong speaker)", wrong.status.toUpperCase(), wrong.note);
  const mustReject = wrong.status === "incorrect_attribution" || wrong.attribution === "unchecked";
  if (!mustReject) line("Wrong speaker not verified", "FAILED", `status ${wrong.status}`);
  if (wrong.status === "verified_exact" && wrong.attribution !== "unchecked") line("Wrong speaker not verified", "FAILED", "a wrong speaker was verified");

  const claims = checkEventClaims("Lady Macbeth sees Banquo's ghost at the banquet. Macbeth sees Banquo's ghost at the banquet.", session.pageTexts(), question);
  line("Event claims against read pages", claims.length ? "RAN" : "NOT TESTED", claims.map((c) => `${c.subject}/${c.event}: ${c.status}`).join("; ") || "no page mentioned the event");
}

/* ---- the gate, end to end: real research, a SCRIPTED model (no language model is called) -------------------------------------------------- */
if (!skipLive && found.status === "ok") {
  const draft = 'In Act 5 Macbeth cries "Out, damned spot! Out, I say!", which shows his guilt. Lady Macbeth sees Banquo\'s ghost at the banquet. She sleepwalks and tries to wash imagined blood from her hands.';
  const calls = [];
  const provider = {
    id: "mock",
    capabilities: async () => ({ vision: false, jsonMode: false, toolUse: false, maxContext: 8192 }),
    health: async () => ({ ok: true, detail: "ok" }),
    async *stream(messages) {
      calls.push(messages.at(-1).content.slice(0, 40));
      yield { type: "text", text: draft };
      yield { type: "done", provider: "mock", model: "mock", usage: { promptTokens: 1, completionTokens: 1 }, stats: { firstTokenMs: 1, totalMs: 1 } };
    },
  };
  const store = new InMemoryLibraryStore();
  const profile = store.seedProfile({ email: "check@example.com" });
  const clientId = await store.accounts.ensureClient(profile);
  const cfg = assistantConfig({ NODE_ENV: "development", ASSISTANT_PROVIDER: "mock" });
  const live = new ResearchService({ searx, limits: { maxSearches: 6, maxFetches: 6, fetchMaxBytes: config.research.fetchMaxBytes, fetchTimeoutMs: 20_000, perMinute: 60 }, fetchOptions: { crawler: config.crawler.enabled && health.ok ? crawler : null }, cacheTtlSeconds: 0 });
  const events = [];
  const started = Date.now();
  for await (const e of sendMessage({ store, provider, queue: new GenerationQueue(1, 2), uploads: new MemoryLibraryStorage(), config: cfg, research: live }, { owner: { clientId, studentId: null }, sessionId: null, text: "Write a model answer: starting with Act 5 Scene 1, how far is Lady Macbeth presented as changing in Macbeth?" })) events.push(e);
  const shown = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
  const leaked = /ghost/i.test(shown.split("---")[0]) || /Macbeth cries/.test(shown.split("---")[0]);
  line("Gate (live research, scripted model)", leaked ? "FAILED" : "PASSED", leaked ? "an unsupported statement reached the student" : `the false event and the wrong-speaker quotation were removed before display (${Date.now() - started} ms, ${calls.length} model call(s))`);
  console.log("  student saw: " + JSON.stringify(shown.slice(0, 420)));
}

console.log(failed ? `\n${failed} check(s) FAILED.` : "\nNo check failed. Items marked SKIPPED or NOT TESTED were not verified.");
process.exit(failed ? 1 : 0);
