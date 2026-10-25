#!/usr/bin/env node
/**
 * A reusable accuracy benchmark for the evidence pipeline (docs/RESEARCH.md). It runs labelled cases from tests/fixtures/research-eval.json through
 * the REAL stack (SearXNG, Crawl4AI, live websites) and reports, per case and in total, what the verification layer said against what it should say.
 * It does NOT call a language model, and it says nothing about essay quality: that needs the human protocol in docs/ESSAY_BENCHMARK_PROTOCOL.md.
 *
 *   npm run research:eval                    one run, written to docs/benchmarks/research-eval.json
 *   npm run research:eval -- --runs 3        repeat (a fresh session and cache each time) to see how stable the results are
 *   npm run research:eval -- --no-crawler    the same cases through the plain-fetch fallback, to compare
 *
 * Results depend on what the search engine returns that day, so a case that cannot be settled is reported as a miss, never quietly passed.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assistantConfig } from "../src/lib/assistant/config.ts";
import { detectStudyContext } from "../src/lib/assistant/exam/context.ts";
import { checkEventClaims } from "../src/lib/assistant/research/claims.ts";
import { Crawl4aiClient } from "../src/lib/assistant/research/crawl4ai.ts";
import { groundTurn } from "../src/lib/assistant/research/ground.ts";
import { SearxngClient } from "../src/lib/assistant/research/searxng.ts";
import { ResearchService } from "../src/lib/assistant/research/verify.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const runs = Math.max(1, Number(args[args.indexOf("--runs") + 1]) || 1);
const useCrawler = !args.includes("--no-crawler");
// The public search engines behind SearXNG suspend a client that asks too fast. A pause between cases keeps the benchmark from breaking what it measures.
const pause = Number(args[args.indexOf("--pause-ms") + 1]) || 2500;
const fixture = JSON.parse(readFileSync(join(here, "..", "tests", "fixtures", "research-eval.json"), "utf8"));
const config = assistantConfig({ ...process.env, NODE_ENV: "development" });

const searx = new SearxngClient({ enabled: true, baseUrl: config.research.baseUrl, timeoutMs: config.research.timeoutMs, maxResults: config.research.maxResults, cacheTtlSeconds: 0 });
const crawler = new Crawl4aiClient(config.crawler);
const crawlerUp = useCrawler && config.crawler.enabled && (await crawler.health()).ok;
const service = () =>
  new ResearchService({
    searx,
    limits: { maxSearches: 6, maxFetches: 6, fetchMaxBytes: config.research.fetchMaxBytes, fetchTimeoutMs: 20_000, perMinute: 600 },
    fetchOptions: { crawler: crawlerUp ? crawler : null },
    cacheTtlSeconds: 0,
  });

const all = [];
for (let run = 1; run <= runs; run += 1) {
  const rows = [];
  for (const c of fixture.quotations) {
    const t0 = Date.now();
    const v = await service().session("eval").verifyQuotation({ quotation: c.quotation, work: c.work, claimedSpeaker: c.speaker });
    await new Promise((r) => setTimeout(r, pause));
    rows.push({ run, id: c.id, kind: c.kind, got: v.status, expect: c.expect, ok: c.expect.includes(v.status), speaker: v.speaker ?? null, location: v.location ?? null, ms: Date.now() - t0 });
  }
  // Event cases: ground once per question, then judge the reply sentence against the pages read.
  const byQuestion = new Map();
  for (const c of fixture.events) {
    const t0 = Date.now();
    if (!byQuestion.has(c.question)) {
      const session = service().session("eval");
      const g = await groundTurn(session, detectStudyContext(c.question), c.question);
      byQuestion.set(c.question, { session, sources: g.sources.length });
    }
    const { session, sources } = byQuestion.get(c.question);
    const claims = checkEventClaims(c.reply, session.pageTexts(), c.question);
    const got = claims[0]?.status ?? "not_judged";
    rows.push({ run, id: c.id, kind: c.kind, got, expect: c.expect, ok: c.expect.includes(got), sourcesRead: sources, ms: Date.now() - t0 });
  }
  all.push(...rows);
}

// A case whose search could not run is NOT TESTED, not a failure of the verifier and not a pass.
const unsettled = all.filter((r) => r.got === "unverifiable" && !r.expect.includes("unverifiable")).length;
for (const r of all) if (r.got === "unverifiable" && !r.expect.includes("unverifiable")) r.ok = null;
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}% (${n}/${d})` : "NOT TESTED");
const where = (pred) => all.filter((r) => r.ok !== null && pred(r)); // cases whose search could not run are not counted either way
const metrics = {
  exactQuotationAccuracy: pct(where((r) => r.kind === "authentic" && r.got === "verified_exact").length, where((r) => r.kind === "authentic").length),
  speakerAttributionCorrect: pct(where((r) => r.kind === "authentic" && r.got === "verified_exact" && r.speaker).length, where((r) => r.kind === "authentic").length),
  wrongAttributionRejected: pct(where((r) => r.kind === "wrong_attribution" && r.got === "incorrect_attribution").length, where((r) => r.kind === "wrong_attribution").length),
  falseQuotationsVerified: where((r) => ["invented", "misquote"].includes(r.kind) && ["verified_exact", "verified_variant"].includes(r.got)).length,
  falseEventsPresentedAsSupported: where((r) => r.kind === "false_event" && r.got === "supported").length,
  falseEventsCaught: pct(where((r) => r.kind === "false_event" && ["contradicted", "unsupported"].includes(r.got)).length, where((r) => r.kind === "false_event").length),
  trueEventsRejectedAsContradicted: where((r) => r.kind === "true_event" && r.got === "contradicted").length,
  trueEventsSupported: pct(where((r) => r.kind === "true_event" && r.got === "supported").length, where((r) => r.kind === "true_event").length),
  casesAsExpected: pct(where((r) => r.ok === true).length, all.filter((r) => r.ok !== null).length),
  casesNotTestedBecauseSearchCouldNotRun: unsettled,
  medianMsPerCase: all.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(all.length / 2)] ?? null,
};
const report = { when: new Date().toISOString(), crawler: crawlerUp ? "Crawl4AI" : "plain fetch", runs, metrics, cases: all, notLiveTested: ["essay quality (needs teachers)", "a real model's answers (run by the owner)"] };
const out = join(here, "..", "..", "..", "docs", "benchmarks", "research-eval.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2));
for (const r of all) console.log(`${r.ok === null ? "N/T " : r.ok ? "ok  " : "MISS"} run ${r.run} ${r.id.padEnd(24)} ${String(r.got).padEnd(24)} expected ${r.expect.join("|")}  ${r.ms} ms`);
console.log("\n" + JSON.stringify({ crawler: report.crawler, runs, ...metrics }, null, 2));
console.log(`\nWritten to ${out}`);
