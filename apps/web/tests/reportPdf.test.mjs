import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan17 C19: the PDF of approved reports. Structure, text handling and, above all, no private notes.

const { buildReportsPdf } = loadTsFrom(import.meta.url, "../src/lib/reports/reportPdf.ts");

const report = (overrides = {}) => ({
  title: "GCSE Maths", subject: "Maths", dateLabel: "Tuesday, 3 November 2026", tutorName: "Tahasin Hasan", studentNames: "Ava Khan",
  publicSummary: "Ava worked through simultaneous equations.", progress: "Much quicker at elimination.", engagement: "High", ...overrides,
});
const info = { heading: "Lesson report", brand: "LearnThrive Tuition", footer: "Created 5 Oct 2026" };
const text = (pdf) => Buffer.from(pdf).toString("latin1");

test("a valid PDF: header, one page, a correct xref table and trailer", () => {
  const body = text(buildReportsPdf([report()], info));
  assert.ok(body.startsWith("%PDF-1.4\n"));
  assert.ok(body.endsWith("%%EOF\n"));
  assert.equal((body.match(/\/Type \/Page /g) ?? []).length, 1);
  const xref = Number(/startxref\n(\d+)/.exec(body)[1]);
  assert.ok(body.slice(xref).startsWith("xref\n"));
  const offsets = [...body.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  offsets.forEach((offset, i) => assert.ok(body.slice(offset).startsWith(`${i + 1} 0 obj`), `object ${i + 1} at its offset`));
});

test("the visible fields are in the file", () => {
  const body = text(buildReportsPdf([report()], info));
  for (const needle of ["GCSE Maths", "Tahasin Hasan", "Ava Khan", "simultaneous equations", "Much quicker", "Page 1 of 1"]) assert.ok(body.includes(needle), needle);
});

test("private tutor fields never reach the file, even when a whole LessonReport is passed in", () => {
  const whole = report({ internalTutorNotes: "SECRET-NOTE-do-not-share", confidence: "LOW", status: "APPROVED", approvedBy: "admin-1" });
  const body = text(buildReportsPdf([whole], info));
  assert.ok(!body.includes("SECRET-NOTE"));
  assert.ok(!body.includes("Confidence"));
  assert.ok(!body.includes("admin-1"));
});

test("parentheses and backslashes are escaped, curly quotes and non-WinAnsi characters survive as one byte", () => {
  const body = text(buildReportsPdf([report({ publicSummary: "Ava (Year 9) wrote a\\b “quote” – and 数学." })], info));
  assert.ok(body.includes(String.raw`Ava \(Year 9\) wrote a\\b \223quote\224 \226 and ??.`));
  assert.ok([...body].every((c) => c.charCodeAt(0) < 128), "the file is ASCII, so offsets are byte offsets");
});

test("long text wraps and spills onto more pages; several reports share one document", () => {
  const long = "word ".repeat(2500);
  const pdf = text(buildReportsPdf([report({ publicSummary: long }), report({ title: "Second lesson" })], info));
  const pages = (pdf.match(/\/Type \/Page /g) ?? []).length;
  assert.ok(pages >= 3, `pages: ${pages}`);
  assert.ok(pdf.includes(`Page ${pages} of ${pages}`));
  assert.ok(pdf.includes("Second lesson"));
});
