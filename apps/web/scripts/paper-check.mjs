#!/usr/bin/env node
/**
 * The Paper Tutor against a REAL model (the Gate 4 check): each fixture paper is read, its questions found, solved by the local model
 * on Ollama, checked by calculation and written onto the paper. Prints every question's answer and verdict and writes the annotated
 * PDF and a picture of every output page to docs/screenshots/paper-tutor/ for looking at.
 *
 *   node --import tsx scripts/paper-check.mjs [--only gcse] [--mode hybrid|filled|worked]
 *
 * Synthetic papers only. The model is the development default (ASSISTANT_MODEL, else qwen3.5:9b).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assistantConfig } from "../src/lib/assistant/config.ts";
import { renderPdfPages } from "../src/lib/assistant/documents.ts";
import { OllamaProvider } from "../src/lib/assistant/ollama.ts";
import { GenerationQueue } from "../src/lib/assistant/queue.ts";
import { extractQuestions, photoToPdf, solvePaper } from "../src/lib/paper/paper.ts";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const only = arg("--only", "");
const mode = arg("--mode", "hybrid");
const out = join(here, "..", "..", "..", "docs", "screenshots", "paper-tutor");
mkdirSync(out, { recursive: true });

// What each paper's questions should come to (null: not checkable by a number, look at it).
const EXPECT = {
  "gcse-multipage.pdf": { q1: /x\^\{?8\}?/, q2: /x\s*=\s*4[\s\S]*y\s*=\s*3/, q3: /\\frac\{7\}\{8\}|7\s*\/\s*8/, q4: /68/, q5: /5\.2\s*\\times\s*10\^\{?-4\}?/ },
  "mixed.pdf": { q1: /\b10\b/ },
  "text-native.pdf": { q1: /x\s*=\s*6|^\s*6\s*$/, q2: /3x\s*\+\s*12/ },
  "scan-flate.pdf": { q1: /\b18\b/ },
  "worksheet.png": { q1: /\b56\b/ },
};

const config = assistantConfig({ NODE_ENV: "development", ...process.env });
const provider = new OllamaProvider({ baseUrl: process.env.ASSISTANT_BASE_URL ?? "http://127.0.0.1:11434", model: config.model, visionModel: config.visionModel ?? undefined, contextSize: 8192 });
const deps = { provider, queue: new GenerationQueue(1, 8), model: config.model, visionModel: config.visionModel ?? config.model };

let right = 0;
let total = 0;
let honest = 0;
for (const file of Object.keys(EXPECT).filter((f) => !only || f.includes(only))) {
  const raw = new Uint8Array(readFileSync(join(here, "..", "tests", "fixtures", "documents", file)));
  const bytes = file.endsWith(".png") ? await photoToPdf(raw, "image/png") : raw;
  const started = Date.now();
  const document = await extractQuestions(deps, bytes);
  if ("problem" in document) {
    console.log(`${file}: ${document.problem}`);
    continue;
  }
  console.log(`\n== ${file}: ${document.questions.length} question(s) found: ${document.questions.map((q) => `${q.id}${q.fromText ? "" : "*"}`).join(" ")} (* read from the picture)`);
  const result = await solvePaper(deps, document, { mode });
  for (const q of result.solved) {
    const want = EXPECT[file][q.id];
    const correct = want ? want.test(q.finalAnswer) : null;
    total += 1;
    if (correct) right += 1;
    // Honest: a right answer, or a wrong one that is NOT presented as checked.
    if (correct || !["verified", "checked_reading"].includes(q.status)) honest += 1;
    console.log(`  ${q.id} ${correct ? "RIGHT" : correct === false ? "WRONG" : "?    "} ${q.status.padEnd(15)} answer: ${q.finalAnswer || "(none)"}${q.statusNote ? `  [${q.statusNote}]` : ""}`);
  }
  const stem = file.replace(/\.(pdf|png)$/, "");
  writeFileSync(join(out, `${stem}-${mode}.pdf`), result.pdf);
  const pages = await renderPdfPages(result.pdf, { scale: 1.2 });
  for (const p of pages) writeFileSync(join(out, `${stem}-${mode}-p${p.number}.jpg`), p.jpeg());
  console.log(`  ${result.pageCount} pages (worked pages ${result.workedPages.join(", ") || "none"}), placements ${result.placements.map((p) => `${p.questionId}:${p.kind}`).join(" ")}, ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
console.log(`\n${right}/${total} answers right; ${honest}/${total} honest (right, or not presented as checked).`);
