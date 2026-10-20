import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { loadTsFrom } from "./_tsLoader.mjs";

// Phase D: the metadata rules, the plan/apply logic of the import tool, and the command line around it.

const meta = loadTsFrom(import.meta.url, "../src/lib/library/metadata.ts");
const imp = loadTsFrom(import.meta.url, "../src/lib/library/import.ts");
const storage = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

async function pdf(label) {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]).drawText(label, { x: 20, y: 200 });
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

const entry = (over = {}) => ({
  file: "quadratics.pdf", title: "Quadratic equations", description: "Factorising.", subject: "Maths", level: "GCSE", topic: "Algebra", type: "worksheet",
  tags: ["Algebra", "quadratics", "algebra"], authorship: "LearnThrive Tuition", publishedAt: "2026-11-01", ...over,
});

test("slugify: plain lowercase words", () => {
  assert.equal(meta.slugify("Quadratic Equations: the formula & you!"), "quadratic-equations-the-formula-and-you");
  assert.equal(meta.slugify("  Café – Résumé  "), "cafe-resume");
  assert.equal(meta.slugify("!!!"), "");
});

test("metadata: a good entry is normalised, a draft has no date", () => {
  const { entries, problems } = meta.parseMetadata({ resources: [entry(), entry({ file: "b.pdf", title: "Cells", publishedAt: null, examBoard: " AQA ", accessTier: "free_sample", slug: "cells-intro", version: 3, yearGroup: "Year 10" })] });
  assert.deepEqual(problems, []);
  assert.equal(entries[0].input.slug, "quadratic-equations");
  assert.deepEqual(entries[0].input.tags, ["algebra", "quadratics"], "lower-cased and de-duplicated");
  assert.equal(entries[0].input.accessTier, "members");
  assert.equal(entries[0].input.publishedAt.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(entries[1].input.publishedAt, null);
  assert.equal(entries[1].input.examBoard, "AQA");
  assert.equal(entries[1].input.version, 3);
  assert.deepEqual(entries[1].file, ["b.pdf"]);
  assert.deepEqual(meta.parseMetadata({ resources: [entry({ file: undefined, files: ["a.pdf", "b.pdf"] })] }).entries[0].file, ["a.pdf", "b.pdf"]);
});

test("metadata: authorship is required, and exam boards and publishers are refused as authors", () => {
  for (const authorship of [undefined, "", "   ", "---"]) {
    const { problems } = meta.parseMetadata({ resources: [entry({ authorship })] });
    assert.match(problems.join("\n"), /"authorship" is required/, JSON.stringify(authorship));
  }
  for (const authorship of ["AQA", "Pearson Edexcel", "OCR (2019 paper)", "Cambridge University Press", "CGP Books", "BBC Bitesize", "Department for Education"]) {
    assert.match(meta.parseMetadata({ resources: [entry({ authorship })] }).problems.join("\n"), /not redistributed/, authorship);
  }
  assert.deepEqual(meta.parseMetadata({ resources: [entry({ authorship: "Written by Sam Patel for LearnThrive" })] }).problems, []);
});

test("metadata: every problem is reported at once, with the entry named", () => {
  const { entries, problems } = meta.parseMetadata({
    resources: [
      entry({ title: "", file: "../x.pdf", level: "GCSE+", type: "poster", subject: "", topic: "", publishedAt: "soon", accessTier: "free", tags: "a", version: 0 }),
      entry({ slug: "Bad Slug", description: "x".repeat(2001), tags: Array.from({ length: 21 }, (_, i) => `t${i}`), file: "" }),
      entry({ slug: "dup" }),
      entry({ slug: "dup" }),
      "nope",
    ],
  });
  assert.deepEqual(entries.map((e) => e.input.slug), ["dup"], "only the first of the duplicate pair survives");
  const text = problems.join("\n");
  for (const wanted of ["title must be", "no path", "level must be one of KS2", "type must be one of worksheet", "subject must be", "topic must be", 'publishedAt must be a date', "accessTier must be", "tags must be a list", "version must be", 'slug "Bad Slug"', "description is over 2000", "at most 20 tags", 'needs "file"', 'slug "dup" is used twice', "Entry 5: not an object"]) {
    assert.ok(text.includes(wanted), `missing: ${wanted}\n${text}`);
  }
  assert.deepEqual(meta.parseMetadata({}).problems, ['The metadata file must be {"resources": [ ... ]}.']);
  assert.match(meta.parseMetadata({ resources: [] }).problems[0], /lists no resources/);
});

function folderOf(files, metadata) {
  return { readMetadata: () => (metadata === null ? null : typeof metadata === "string" ? metadata : JSON.stringify(metadata)), readFile: (name) => files[name] ?? null };
}

test("plan: checks files, refuses unsafe ones, and stops the whole run on any problem", async () => {
  const store = new InMemoryLibraryStore();
  const good = await pdf("good");
  const script = Buffer.from("%PDF-1.4\n1 0 obj << /OpenAction << /S /JavaScript /JS (x) >> >> endobj\n%%EOF");
  assert.deepEqual((await imp.planImport(folderOf({}, null), store.resources)).problems, ["library.json was not found in the folder."]);
  assert.deepEqual((await imp.planImport(folderOf({}, "{not json"), store.resources)).problems, ["library.json is not valid JSON."]);

  const plan = await imp.planImport(
    folderOf({ "quadratics.pdf": good, "bad.pdf": script, "text.pdf": Buffer.from("hello") }, { resources: [entry(), entry({ file: "bad.pdf", slug: "bad" }), entry({ file: "missing.pdf", slug: "missing" }), entry({ file: "text.pdf", slug: "text" })] }),
    store.resources,
  );
  assert.equal(plan.items.length, 1);
  const text = plan.problems.join("\n");
  assert.match(text, /bad: "bad\.pdf": This PDF contains scripting/);
  assert.match(text, /missing: the file "missing\.pdf" is not in the folder/);
  assert.match(text, /text: "text\.pdf": This file does not look like a PDF/);
  await assert.rejects(() => imp.applyImport(plan, { resources: store.resources, storage: new storage.MemoryLibraryStorage() }), /refusing/);
  assert.equal(await store.resources.findBySlug("quadratic-equations"), null, "nothing written");

  const clash = await imp.planImport(folderOf({ "a.pdf": good, "b.pdf": good }, { resources: [entry({ file: undefined, files: ["a.pdf", "a.pdf"] })] }), store.resources);
  assert.match(clash.problems.join("\n"), /listed twice/);
});

test("apply: files first to versioned paths, rows after, idempotent, a changed file is a new version and the old one stays", async () => {
  const store = new InMemoryLibraryStore();
  const blobs = new storage.MemoryLibraryStorage();
  const v1 = await pdf("one");
  const run = async (bytes, over = {}) => {
    const plan = await imp.planImport(folderOf({ "quadratics.pdf": bytes }, { resources: [entry(over)] }), store.resources);
    assert.deepEqual(plan.problems, []);
    return { plan, summary: await imp.applyImport(plan, { resources: store.resources, storage: blobs }) };
  };

  const first = await run(v1);
  assert.equal(first.plan.items[0].action, "create");
  assert.deepEqual(first.summary, { created: 1, updated: 0, newVersions: 0, uploaded: 1 });
  const saved = await store.resources.findBySlug("quadratic-equations");
  assert.equal(saved.version, 1);
  assert.equal(saved.authorship, "LearnThrive Tuition");
  const [file] = await store.resources.files(saved.id);
  assert.equal(file.storagePath, "quadratic-equations/v1/quadratics.pdf");
  assert.ok(blobs.objects.has(file.storagePath));

  const again = await run(v1, { title: "Quadratic equations (retitled)", slug: "quadratic-equations" });
  assert.equal(again.plan.items[0].action, "update");
  assert.deepEqual(again.summary, { created: 0, updated: 1, newVersions: 0, uploaded: 0 }, "same bytes: nothing uploaded, version kept");
  assert.equal((await store.resources.findBySlug("quadratic-equations")).title, "Quadratic equations (retitled)");

  const v2 = await pdf("two");
  const changed = await run(v2, { slug: "quadratic-equations" });
  assert.equal(changed.plan.items[0].action, "new-version");
  assert.deepEqual(changed.summary, { created: 0, updated: 0, newVersions: 1, uploaded: 1 });
  const now = await store.resources.findBySlug("quadratic-equations");
  assert.equal(now.version, 2);
  assert.deepEqual((await store.resources.files(now.id)).map((f) => f.storagePath), ["quadratic-equations/v2/quadratics.pdf"]);
  assert.ok(blobs.objects.has("quadratic-equations/v1/quadratics.pdf"), "the old version's file is not deleted");

  const lower = await imp.planImport(folderOf({ "quadratics.pdf": v2 }, { resources: [entry({ slug: "quadratic-equations", version: 1 })] }), store.resources);
  assert.match(lower.problems.join("\n"), /lower than the stored version 2/);
});

test("the command line: dry run writes nothing and names the problems, and apply asks for its settings", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lt-import-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "quadratics.pdf"), await pdf("cli"));
  writeFileSync(join(dir, "library.json"), JSON.stringify({ resources: [entry()] }));
  const script = join(import.meta.dirname, "..", "scripts", "library-import.mjs");
  const env = { ...process.env };
  for (const key of ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) delete env[key];
  const run = (...args) => spawnSync(process.execPath, ["--import", "tsx", script, ...args], { env, encoding: "utf8", cwd: join(import.meta.dirname, "..") });

  const dry = run("--dir", dir);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /create\s+quadratic-equations\s+v1\s+1 file\(s\)/);
  assert.match(dry.stdout, /Dry run: 1 resource\(s\) checked, nothing written/);

  const needs = run("--dir", dir, "--apply");
  assert.equal(needs.status, 2);
  assert.match(needs.stderr, /--apply needs DATABASE_URL/);
  assert.equal(run().status, 2);

  writeFileSync(join(dir, "library.json"), JSON.stringify({ resources: [entry({ authorship: "" })] }));
  const bad = run("--dir", dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /"authorship" is required/);
  assert.match(bad.stderr, /Nothing was imported/);
});
