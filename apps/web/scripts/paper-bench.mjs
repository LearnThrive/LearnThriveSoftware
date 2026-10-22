#!/usr/bin/env node
/**
 * Paper Tutor benchmark (docs/PAPER_BENCHMARK.md). Takes each case through the real pipeline (extract, solve, check, place) and scores it with
 * src/lib/paper/bench.ts: extraction, transcription, answers, verification coverage, FALSE "verified", placement and run time.
 *
 *   npm run paper:bench -- [--split dev|heldout|all] [--manifest benchmarks/paper/manifest.json] [--no-synthetic]
 *                          [--provider stand-in|ollama] [--model qwen3.5:9b] [--ollama http://127.0.0.1:11434] [--no-solve]
 *                          [--out ../../docs/PAPER_BENCHMARK_RESULTS.md]
 *
 *   Synthetic cases are built here (no copyrighted paper is needed or committed) and use a stand-in model that answers as the case says,
 *   wrongly on purpose where a case is a trap: they test the pipeline and the checker, and are NOT evidence about real papers or a real model.
 *   External cases are real papers the owner has downloaded into benchmarks/paper/data/ (never committed; see the guide) and listed in the manifest
 *   with the source URL, licence, SHA-256 and the annotator's expected questions and answers. A case whose file is missing or whose hash differs
 *   is reported NOT RUN: it is never counted as a pass, and an unmeasured gate is never "met".
 *
 *   Held-out cases are for reporting. The harness keeps a count of how often they have been run (benchmarks/paper/heldout-runs.json) and says so;
 *   do not change the code in response to a held-out result, or they stop being held out.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OllamaProvider } from "../src/lib/assistant/ollama.ts";
import { GenerationQueue } from "../src/lib/assistant/queue.ts";
import { RELEASE_THRESHOLDS, summarise } from "../src/lib/paper/bench.ts";
import { runCase, standInModel, syntheticCases } from "../src/lib/paper/benchRun.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "benchmarks", "paper");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback = "") => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? fallback) : fallback;
};

const split = value("--split", "all");
if (!["dev", "heldout", "all"].includes(split)) {
  console.error('--split must be "dev", "heldout" or "all"');
  process.exit(2);
}
const manifestPath = resolve(value("--manifest", join(root, "manifest.json")));
const providerName = value("--provider", "stand-in");
const solve = !flag("--no-solve");
const outFile = resolve(value("--out", join(here, "..", "..", "..", "docs", "PAPER_BENCHMARK_RESULTS.md")));
const rawFile = join(dirname(outFile), "benchmarks", "paper-results.json");

const queue = new GenerationQueue(1, 500);
const realDeps = () => {
  if (providerName !== "ollama") return null;
  const model = value("--model", "qwen3.5:9b");
  return { provider: new OllamaProvider({ baseUrl: value("--ollama", "http://127.0.0.1:11434"), model, visionModel: model, contextSize: 8192 }), queue, model, visionModel: model };
};

const reports = [];
const meta = [];

if (!flag("--no-synthetic")) {
  for (const c of await syntheticCases()) {
    if (split !== "all" && c.case.split !== split) continue;
    const deps = { provider: standInModel(c.model), queue, model: "stand-in" };
    reports.push(await runCase(c.case, c.bytes, solve ? deps : null, { solve }));
    meta.push({ id: c.case.id, title: c.case.title, kind: "synthetic", split: c.case.split });
  }
}

if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const c of manifest.cases ?? []) {
    if (c.example || (split !== "all" && c.split !== split)) continue;
    meta.push({ id: c.id, title: c.title, kind: "external", split: c.split, source: c.source });
    const file = c.file ? join(dirname(manifestPath), c.file) : null;
    if (!file || !existsSync(file)) {
      reports.push({ id: c.id, split: c.split, status: "not_run", reason: "the file is not in benchmarks/paper/data/ (download it from the source in the manifest)" });
      continue;
    }
    const bytes = new Uint8Array(readFileSync(file));
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (!c.sha256 || hash !== c.sha256) {
      reports.push({ id: c.id, split: c.split, status: "not_run", reason: c.sha256 ? `the file's SHA-256 (${hash.slice(0, 12)}...) is not the manifest's: it is not the paper that was annotated` : "the manifest has no SHA-256 for this case" });
      continue;
    }
    const deps = realDeps();
    if (solve && !deps) {
      reports.push({ id: c.id, split: c.split, status: "not_run", reason: "answers need a real model: run with --provider ollama (or --no-solve for extraction only)" });
      continue;
    }
    reports.push(await runCase(c, bytes, solve ? deps : null, { solve }));
  }
}

// Held-out discipline: say how many times they have been looked at.
const runsFile = join(root, "heldout-runs.json");
let heldoutRuns = 0;
const externalHeldout = reports.filter((r) => r.split === "heldout" && r.status === "run" && meta.find((m) => m.id === r.id)?.kind === "external");
if (externalHeldout.length) {
  const log = existsSync(runsFile) ? JSON.parse(readFileSync(runsFile, "utf8")) : { runs: [] };
  log.runs.push({ at: new Date().toISOString(), cases: externalHeldout.map((r) => r.id) });
  writeFileSync(runsFile, JSON.stringify(log, null, 2) + "\n");
  heldoutRuns = log.runs.length;
}

const pct = (n) => (n === null || n === undefined ? "n/a" : `${(n * 100).toFixed(1)}%`);
const lines = ["# Paper Tutor benchmark results", "", `Generated by \`npm run paper:bench\` (provider: ${providerName}${providerName === "ollama" ? ` ${value("--model", "qwen3.5:9b")}` : ""}; solve: ${solve}). Synthetic cases use a stand-in model and are not evidence about real papers or a real model.`, ""];
for (const which of ["dev", "heldout", "all"]) {
  if (split !== "all" && which !== split && which !== "all") continue;
  const s = summarise(reports, which);
  lines.push(`## ${which === "all" ? "All cases" : which === "dev" ? "Development cases" : "Held-out cases"}`, "", `Cases: ${s.cases} (run ${s.run}, NOT RUN ${s.notRun}). Mean run time ${s.seconds.toFixed(1)} s.`, "");
  lines.push("| Measure | Result | Release threshold | Gate |", "| --- | --- | --- | --- |");
  lines.push(`| Extraction recall | ${pct(s.extractionRecall)} | >= ${pct(RELEASE_THRESHOLDS.extractionRecall)} | ${s.gates.extractionRecall} |`);
  lines.push(`| Extraction precision | ${pct(s.extractionPrecision)} | >= ${pct(RELEASE_THRESHOLDS.extractionPrecision)} | ${s.gates.extractionPrecision} |`);
  lines.push(`| Transcription (printed words found) | ${pct(s.transcription)} | >= ${pct(RELEASE_THRESHOLDS.transcription)} | ${s.gates.transcription} |`);
  lines.push(`| Answer accuracy | ${pct(s.answerAccuracy)} | (reported, no threshold) | n/a |`);
  lines.push(`| Verified coverage (right answers the checker vouched for) | ${pct(s.verifiedCoverage)} | (reported) | n/a |`);
  lines.push(`| **False "verified"** (wrong, vouched for) | ${s.falseVerified} | ${RELEASE_THRESHOLDS.falseVerified} | ${s.gates.falseVerified} |`);
  lines.push(`| Bad placements (over printing, tiny, off page) | ${s.placementBad} | ${RELEASE_THRESHOLDS.placementBad} | ${s.gates.placementBad} |`, "");
}
lines.push("## Per case", "", "| Case | Kind | Split | Status | Recall | Precision | Transcription | Accuracy | False verified | Bad placements | Seconds |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const r of reports) {
  const m = meta.find((x) => x.id === r.id);
  lines.push(`| ${r.id} | ${m?.kind ?? ""} | ${r.split} | ${r.status === "run" ? "run" : `NOT RUN: ${r.reason}`} | ${pct(r.extraction?.recall)} | ${pct(r.extraction?.precision)} | ${pct(r.transcription?.mean)} | ${pct(r.answers?.accuracy)} | ${r.answers ? r.answers.falseVerified.length : "n/a"} | ${r.placement ? r.placement.bad.length : "n/a"} | ${r.seconds?.toFixed(1) ?? "n/a"} |`);
}
const failures = reports.filter((r) => r.answers?.falseVerified.length);
if (failures.length) {
  lines.push("", '## False "verified" answers', "");
  for (const r of failures) for (const f of r.answers.falseVerified) lines.push(`- ${r.id} question ${f.label}: shown \`${f.shown}\`, expected \`${f.expected}\``);
}
if (heldoutRuns > 1) lines.push("", `> The held-out cases have now been run ${heldoutRuns} times. Results from them must not be used to change the code.`);
mkdirSync(dirname(rawFile), { recursive: true });
writeFileSync(outFile, lines.join("\n") + "\n");
writeFileSync(rawFile, JSON.stringify({ provider: providerName, solve, summaries: { dev: summarise(reports, "dev"), heldout: summarise(reports, "heldout"), all: summarise(reports, "all") }, reports }, null, 2) + "\n");
console.log(lines.join("\n"));
const all = summarise(reports, "all");
process.exit(Object.values(all.gates).includes("failed") ? 1 : 0);
