import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// Phase D: the catalogue's address bar, what each phase shows, and the words for each phase.

const cat = loadTsFrom(import.meta.url, "../src/lib/library/catalogue.ts");
const cfg = loadTsFrom(import.meta.url, "../src/lib/library-config.ts");
const copy = loadTsFrom(import.meta.url, "../src/components/library/libraryCopy.ts");

test("catalogue query: every value is checked, junk is dropped, bounds hold", () => {
  assert.deepEqual(cat.parseCatalogueQuery({}), { q: "", subject: "", level: "", type: "", topic: "", page: 1 });
  const q = cat.parseCatalogueQuery({ q: "  fractions \n ", subject: "Maths", level: "GCSE", type: "exam paper", topic: "Number", page: "3" });
  assert.deepEqual(q, { q: "fractions", subject: "Maths", level: "GCSE", type: "exam paper", topic: "Number", page: 3 });
  const junk = cat.parseCatalogueQuery({ level: "ZZ", type: "<script>", page: "-4", q: "\u0000x", subject: ["A", "B"] });
  assert.equal(junk.level, "");
  assert.equal(junk.type, "");
  assert.equal(junk.page, 1);
  assert.equal(junk.q, "x");
  assert.equal(junk.subject, "A", "the first of repeated values");
  assert.equal(cat.parseCatalogueQuery({ page: "99999" }).page, cat.MAX_PAGE);
  assert.equal(cat.parseCatalogueQuery({ page: "2.5" }).page, 2);
  assert.equal(cat.parseCatalogueQuery({ page: "abc" }).page, 1);
  assert.equal(cat.parseCatalogueQuery({ q: "x".repeat(500) }).q.length, 100);
  assert.equal(cat.parseCatalogueQuery({ subject: "x".repeat(500) }).subject.length, 80);
});

test("catalogue query: into a repository query and back into an address", () => {
  const q = cat.parseCatalogueQuery({ q: "fractions", level: "KS2", page: "2" });
  assert.deepEqual(cat.toResourceQuery(q), { q: "fractions", level: "KS2", limit: cat.PAGE_SIZE, offset: cat.PAGE_SIZE });
  assert.deepEqual(cat.toResourceQuery(cat.parseCatalogueQuery({})), { limit: cat.PAGE_SIZE, offset: 0 });
  assert.equal(cat.catalogueHref("/library", q), "/library?q=fractions&level=KS2&page=2");
  assert.equal(cat.catalogueHref("/library", { ...q, page: 1 }), "/library?q=fractions&level=KS2");
  assert.equal(cat.catalogueHref("/library", {}), "/library");
  assert.equal(cat.catalogueHref("/library", { q: "a&b=c d" }), "/library?q=a%26b%3Dc+d", "values are encoded, never concatenated");
});

test("subject and topic addresses come from names, and only published names are found", () => {
  assert.equal(cat.nameSlug("Verbal reasoning"), "verbal-reasoning");
  const facets = [{ value: "Maths", count: 3 }, { value: "11+", count: 1 }, { value: "Verbal reasoning", count: 2 }];
  assert.equal(cat.findBySlug(facets, "maths").value, "Maths");
  assert.equal(cat.findBySlug(facets, "11").value, "11+");
  assert.equal(cat.findBySlug(facets, "verbal-reasoning").count, 2);
  assert.equal(cat.findBySlug(facets, "astrology"), null);
  assert.equal(cat.findBySlug(facets, "MATHS"), null, "addresses are lowercase");
});

test("phases: the catalogue opens at enrolled and live, never at info, live closes the waitlist, and an odd value is info", () => {
  assert.deepEqual(cfg.libraryShows("info"), { comingSoon: true, waitlist: true, catalogue: false });
  assert.deepEqual(cfg.libraryShows("enrolled"), { comingSoon: true, waitlist: true, catalogue: true });
  assert.deepEqual(cfg.libraryShows("live"), { comingSoon: false, waitlist: false, catalogue: true }, "subscriptions open: nothing is coming soon and the waitlist closes");
  assert.equal(cfg.libraryShows(cfg.libraryPhase({ LIBRARY_PHASE: "nonsense" })).catalogue, false);
  assert.equal(cfg.libraryShows(cfg.libraryPhase({})).catalogue, false);
  assert.equal(cfg.libraryShows(cfg.libraryPhase({ LIBRARY_PHASE: " Enrolled " })).catalogue, true);
});

test("copy: the info phase keeps the coming-soon words, the open phase tells the truth about what is open", () => {
  const info = copy.heroCopy("info");
  assert.equal(info.eyebrow, "Library · Coming soon");
  assert.equal(info.status, "Coming soon");
  assert.match(info.howNote, /^None of this is open yet\./);
  const open = copy.heroCopy("enrolled");
  assert.equal(open.eyebrow, "Library · Open to enrolled students");
  assert.match(open.intro, /A subscription for everyone else is coming soon\./);
  assert.ok(!open.howNote.includes("None of this is open yet"));
  assert.ok(!/coming soon\.?$/i.test(open.status), "the Library itself is not 'coming soon' once it is open");

  const prices = { monthly: null, annual: null };
  const before = copy.libraryFaqs(prices);
  const sameAsInfo = copy.libraryFaqs(prices, "info");
  assert.deepEqual(before, sameAsInfo, "no phase given means info, as before");
  const faqs = Object.fromEntries(copy.libraryFaqs(prices, "enrolled").map((f) => [f.id, f.answer]));
  assert.match(faqs["library-when"], /open now to enrolled students/i);
  assert.match(faqs["library-access"], /free samples are open to anyone with an account/);
  assert.ok(!faqs["library-access"].includes("None of this is open yet"));
  // Nothing invented: no count, no date, no claim about quality or exam boards in any phase.
  for (const phase of ["info", "enrolled", "live"]) {
    const all = JSON.stringify([copy.heroCopy(phase), copy.libraryFaqs(prices, phase)]).toLowerCase();
    for (const banned of ["thousands", "best", "guarantee", "aligned", "official", "grade 9"]) assert.ok(!all.includes(banned), `${phase}: ${banned}`);
  }
});
