import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { InMemoryLibraryStore, ResourceInput } from "@learnthrive/data/library";
import { storagePathFor } from "./files";
import type { LibraryStorage } from "./storage";

/**
 * DEVELOPMENT AND TESTS ONLY (reached through /api/dev/library-seed, a 404 in production): a small synthetic catalogue,
 * each with a generated PDF, so the Library can be seen and tested without any content. Every title says "dev seed",
 * every file is a one-page PDF saying so, and nothing here is real teaching material or a claim about the Library.
 */
export interface SeedResource extends Omit<ResourceInput, "publishedAt" | "authorship"> {
  published: "past" | "draft" | "future";
}

const base = { description: "", examBoard: null, yearGroup: null, tags: [] as string[], accessTier: "members" as const, published: "past" as const };

export const SEED_RESOURCES: SeedResource[] = [
  { ...base, slug: "dev-seed-fractions-practice", title: "Fractions practice (dev seed)", description: "Adding and comparing fractions. Synthetic test document.", subject: "Maths", level: "KS2", topic: "Number", resourceType: "worksheet", tags: ["fractions", "number"] },
  { ...base, slug: "dev-seed-quadratics", title: "Quadratic equations (dev seed)", description: "Factorising and the formula. Synthetic test document.", subject: "Maths", level: "GCSE", topic: "Algebra", resourceType: "worksheet", tags: ["algebra", "quadratics"] },
  { ...base, slug: "dev-seed-sequences", title: "Sequences and nth terms (dev seed)", description: "Linear and quadratic sequences. Synthetic test document.", subject: "Maths", level: "GCSE", topic: "Algebra", resourceType: "notes", accessTier: "free_sample", tags: ["algebra", "sequences"] },
  { ...base, slug: "dev-seed-mock-paper-1", title: "Mock paper 1 (dev seed)", description: "An exam-style paper. Synthetic test document.", subject: "Maths", level: "GCSE", examBoard: "AQA", topic: "Mixed", resourceType: "exam paper", tags: ["mock"] },
  { ...base, slug: "dev-seed-mock-paper-1-marks", title: "Mock paper 1 mark scheme (dev seed)", description: "Marking guidance. Synthetic test document.", subject: "Maths", level: "GCSE", examBoard: "AQA", topic: "Mixed", resourceType: "mark scheme", tags: ["mock"] },
  { ...base, slug: "dev-seed-persuasive-writing", title: "Persuasive writing (dev seed)", description: "Techniques and a planning grid. Synthetic test document.", subject: "English", level: "KS3", topic: "Writing", resourceType: "notes", accessTier: "free_sample", tags: ["writing"] },
  { ...base, slug: "dev-seed-poetry-comparison", title: "Comparing poems (dev seed)", description: "A comparison framework. Synthetic test document.", subject: "English", level: "GCSE", topic: "Poetry", resourceType: "worksheet", tags: ["poetry"] },
  { ...base, slug: "dev-seed-cells", title: "Cells and organ systems (dev seed)", description: "Cell structure and function. Synthetic test document.", subject: "Science", level: "KS3", topic: "Biology", resourceType: "worksheet", tags: ["biology", "cells"] },
  { ...base, slug: "dev-seed-forces", title: "Forces and motion (dev seed)", description: "Speed, distance and time. Synthetic test document.", subject: "Science", level: "GCSE", topic: "Physics", resourceType: "worksheet", tags: ["physics", "forces"] },
  { ...base, slug: "dev-seed-verbal-reasoning", title: "Verbal reasoning set A (dev seed)", description: "Word puzzles for the 11+. Synthetic test document.", subject: "11+", level: "11+", topic: "Verbal reasoning", resourceType: "worksheet", tags: ["11+", "reasoning"] },
  { ...base, slug: "dev-seed-draft", title: "Unpublished draft (dev seed)", subject: "Maths", level: "GCSE", topic: "Algebra", resourceType: "notes", published: "draft" },
  { ...base, slug: "dev-seed-scheduled", title: "Scheduled for later (dev seed)", subject: "Maths", level: "GCSE", topic: "Algebra", resourceType: "notes", published: "future" },
];

async function seedPdf(title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText(title, { x: 56, y: 760, size: 20, font, color: rgb(0.06, 0.15, 0.27) });
  page.drawText("Synthetic development document. Not real teaching material.", { x: 56, y: 730, size: 11, font });
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

/** `count` more published synthetic resources (for paging), all Maths, GCSE, members. Idempotent. */
export async function seedBulk(store: InMemoryLibraryStore, count: number): Promise<number> {
  const n = Math.min(Math.max(Math.trunc(count), 0), 200);
  for (let i = 1; i <= n; i += 1) {
    await store.resources.upsert({
      slug: `dev-seed-bulk-${String(i).padStart(3, "0")}`,
      title: `Bulk item ${String(i).padStart(3, "0")} (dev seed)`,
      description: "Synthetic paging test document.",
      subject: "Maths",
      level: "GCSE",
      examBoard: null,
      topic: "Bulk",
      resourceType: "worksheet",
      yearGroup: null,
      tags: ["bulk"],
      accessTier: "members",
      authorship: "LearnThrive Tuition (development seed)",
      publishedAt: new Date(Date.now() - 3_600_000 - i * 1000),
    });
  }
  return n;
}

/** Idempotent: running it twice leaves the same catalogue. Returns how many resources exist afterwards. */
export async function seedCatalogue(store: InMemoryLibraryStore, storage: LibraryStorage, now: Date = new Date()): Promise<number> {
  for (const seed of SEED_RESOURCES) {
    const { published, ...rest } = seed;
    const publishedAt = published === "draft" ? null : published === "future" ? new Date(now.getTime() + 30 * 24 * 3_600_000) : new Date(now.getTime() - 24 * 3_600_000);
    const resource = await store.resources.upsert({ ...rest, authorship: "LearnThrive Tuition (development seed)", publishedAt });
    const bytes = await seedPdf(seed.title);
    const storagePath = storagePathFor(seed.slug, resource.version, `${seed.slug}.pdf`);
    await storage.put(storagePath, bytes, "application/pdf");
    await store.resources.setFiles(resource.id, [{ storagePath, bytes: bytes.length, contentType: "application/pdf", checksumSha256: createHash("sha256").update(bytes).digest("hex") }]);
  }
  return SEED_RESOURCES.length;
}

/** The development test account made by `GET /api/dev/library-seed?action=tester`. In-memory only: it vanishes when the dev server restarts. */
export const TEST_ACCOUNT = { email: "tester@example.com", password: "study-buddy-test-2026", name: "Test Tester" } as const;
