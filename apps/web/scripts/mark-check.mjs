#!/usr/bin/env node
/**
 * Marking a completed paper against a REAL model: records the accuracy of reading the student's writing, of the verdicts, and of the
 * honesty of the labels. Needs Ollama running with a vision-capable model (ASSISTANT_MODEL / ASSISTANT_VISION_MODEL).
 *
 *   node --import tsx scripts/mark-check.mjs [--only gcse|text-native]
 *
 * The completed papers are SYNTHETIC: a fixture paper has answers drawn into its answer spaces in a handwriting-style font, the page
 * is rasterised and rebuilt as a picture-only PDF (no text layer, as a scan or phone photo would be). That is a tidier test than a
 * real student's pen: the numbers printed here say how well the model reads and marks THIS set, not how it will do on real
 * handwriting, which has not been measured. Each paper has known right and wrong answers, so every verdict has a ground truth.
 *
 * Writes the marked PDFs and a picture of each page to docs/screenshots/paper-marker/ for looking at.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";
import { assistantConfig } from "../src/lib/assistant/config.ts";
import { fontBytes } from "../src/lib/paper/annotate.ts";
import { renderPdfPages } from "../src/lib/assistant/documents.ts";
import { OllamaProvider } from "../src/lib/assistant/ollama.ts";
import { GenerationQueue } from "../src/lib/assistant/queue.ts";
import { extractQuestions, markCompleted } from "../src/lib/paper/paper.ts";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const only = arg("--only", "");
const out = join(here, "..", "..", "..", "docs", "screenshots", "paper-marker");
mkdirSync(out, { recursive: true });

// What the student wrote for each question, what it should be read as, and the verdict a correct marker gives.
const PAPERS = {
  "text-native.pdf": {
    q1: { written: "x = 6", reads: /6/, verdict: "correct" },
    q2: { written: "3x + 11", reads: /3x\s*\+\s*11/, verdict: "incorrect" },
  },
  "gcse-multipage.pdf": {
    q1: { written: "x^8", reads: /x\^\{?8\}?/, verdict: "correct" },
    q2: { written: "x = 4, y = 2", reads: /y\s*=\s*2/, verdict: "incorrect" },
    q3: { written: "7/8", reads: /7\}?\s*\/?\s*\{?8|frac\{7\}\{8\}/, verdict: "correct" },
    q4: { written: "£86", reads: /86/, verdict: "incorrect" },
    q5: { written: "5.2 x 10^-4", reads: /5\.2/, verdict: "correct" },
  },
};

/** The fixture paper with the answers handwritten into the first empty band of each question, as a picture-only PDF. */
async function completed(file, answers) {
  const raw = new Uint8Array(readFileSync(join(here, "..", "tests", "fixtures", "documents", file)));
  const document = await extractQuestions(null, raw);
  const doc = await PDFDocument.load(raw);
  doc.registerFontkit(fontkit);
  const hand = await doc.embedFont(fontBytes(), { subset: true });
  for (const q of document.questions) {
    const band = q.bands[0];
    const written = answers[q.id]?.written;
    if (band && written) doc.getPage(q.page - 1).drawText(written, { x: band.x + 10, y: band.y + band.h - 22, size: 17, font: hand, color: rgb(0.05, 0.05, 0.1) });
  }
  const filled = await doc.save();
  const pages = await renderPdfPages(filled, { scale: 2 });
  const scan = await PDFDocument.create();
  for (const p of pages) {
    const size = doc.getPage(p.number - 1).getSize();
    const page = scan.addPage([size.width, size.height]);
    page.drawImage(await scan.embedJpg(p.jpeg()), { x: 0, y: 0, width: size.width, height: size.height });
  }
  return scan.save();
}

const config = assistantConfig({ NODE_ENV: "development", ...process.env });
const provider = new OllamaProvider({ baseUrl: process.env.ASSISTANT_BASE_URL ?? "http://127.0.0.1:11434", model: config.model, visionModel: config.visionModel ?? undefined, contextSize: 8192 });
const deps = { provider, queue: new GenerationQueue(1, 8), model: config.model, visionModel: config.visionModel ?? config.model };
console.log(`model ${deps.model}, vision ${deps.visionModel}`);

const tally = { found: 0, expected: 0, read: 0, verdicts: 0, verdictsRight: 0, wronglyAccused: 0, correctCredited: 0, correctTotal: 0, needsChecking: 0 };
for (const [file, answers] of Object.entries(PAPERS).filter(([f]) => !only || f.includes(only))) {
  const started = Date.now();
  const bytes = await completed(file, answers);
  const document = await extractQuestions(deps, bytes);
  if ("problem" in document) {
    console.log(`${file}: ${document.problem}`);
    continue;
  }
  const expectedIds = Object.keys(answers);
  tally.expected += expectedIds.length;
  tally.found += expectedIds.filter((id) => document.questions.some((q) => q.id === id)).length;
  console.log(`\n== ${file}: ${document.questions.length} question(s) found (${expectedIds.length} expected): ${document.questions.map((q) => q.id).join(" ")}`);
  const result = await markCompleted(deps, document, {});
  for (const q of result.marked) {
    const truth = answers[q.id];
    if (!truth) continue;
    const readOk = truth.reads.test(q.student.answer);
    if (readOk) tally.read += 1;
    const judged = q.outcome === "correct" || q.outcome === "incorrect";
    if (q.outcome === "needs_checking") tally.needsChecking += 1;
    if (judged) {
      tally.verdicts += 1;
      if (q.outcome === truth.verdict) tally.verdictsRight += 1;
    }
    if (truth.verdict === "correct") {
      tally.correctTotal += 1;
      if (q.outcome === "correct") tally.correctCredited += 1;
    }
    // The worst failure: a right answer called wrong.
    if (truth.verdict === "correct" && q.outcome === "incorrect") tally.wronglyAccused += 1;
    console.log(`  ${q.id} wrote "${truth.written}" read "${q.student.answer}" (${q.student.legibility}) ${readOk ? "READ-OK " : "READ-OFF"} -> ${q.outcome}${q.outcome === truth.verdict ? " (as it should)" : ""}  reference ${q.reference.finalAnswer || "(none)"} [${q.reference.status}]${q.estimate !== null ? ` est ${q.estimate}/${q.outOf}` : ""}`);
    if (q.feedback) console.log(`      feedback: ${q.feedback}`);
  }
  const stem = file.replace(/\.pdf$/, "");
  writeFileSync(join(out, `${stem}-marked.pdf`), result.pdf);
  for (const p of await renderPdfPages(result.pdf, { scale: 1.2 })) writeFileSync(join(out, `${stem}-marked-p${p.number}.jpg`), p.jpeg());
  console.log(`  ${result.pageCount} pages (feedback pages ${result.feedbackPages.join(", ")}), ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
const pct = (a, b) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : "n/a");
console.log("\nAccuracy on this synthetic set (not real handwriting):");
console.log(`  question extraction:   ${pct(tally.found, tally.expected)}`);
console.log(`  reading the writing:   ${pct(tally.read, tally.expected)}`);
console.log(`  verdicts given:        ${pct(tally.verdicts, tally.expected)} (the rest left as needs checking / no answer)`);
console.log(`  verdicts right:        ${pct(tally.verdictsRight, tally.verdicts)}`);
console.log(`  right answers credited:${pct(tally.correctCredited, tally.correctTotal)}`);
console.log(`  right answers called wrong: ${tally.wronglyAccused}`);
