import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The two verification improvements, with no network and no model: the citation markers a reply attaches to its own quotations, and the
// entailment-for-recall stage that finds where a page settles a claim. The last two tests drive the REAL gate with a fake recall stage, so what is
// asserted is the behaviour the student would see (a sentence kept, a sentence cut, a marker that never reaches them).

const citations = loadTsFrom(import.meta.url, "../src/lib/assistant/research/citations.ts");
const entail = loadTsFrom(import.meta.url, "../src/lib/assistant/research/entail.ts");
const ground = loadTsFrom(import.meta.url, "../src/lib/assistant/research/ground.ts");
const verify = loadTsFrom(import.meta.url, "../src/lib/assistant/research/verify.ts");
const gate = loadTsFrom(import.meta.url, "../src/lib/assistant/gate.ts");

const PUBLIC = async () => ["93.184.216.34"];
const page = (status, headers, body) => async () => ({
  status,
  headers: { get: (n) => headers[n.toLowerCase()] ?? null },
  read: async (max) => {
    const b = new TextEncoder().encode(body);
    return { bytes: b.subarray(0, max), truncated: b.length > max };
  },
});
const LIMITS = { maxSearches: 3, maxFetches: 3, fetchMaxBytes: 100_000, fetchTimeoutMs: 1_000, perMinute: 50 };
const raw = (url, snippet = "", title = url) => ({ title, url, snippet, engines: ["google"], category: "general", publishedDate: null });
const searxWith = (results, status = "ok") => {
  const calls = [];
  return { calls, available: true, search: async (q) => (calls.push(q), { status, query: q, results, detail: status }) };
};
const service = (searx, pages, recall = null) =>
  new verify.ResearchService({ searx, limits: LIMITS, recall, fetchOptions: { resolve: PUBLIC, fetcher: async (url) => page(200, { "content-type": "text/html" }, pages[url] ?? "<p>nothing relevant here</p>")() } });

/* ------------------------------------------------------------------ the citation markers */

test("a citation marker names the source a quotation is attributed to, and is never part of the answer", () => {
  const draft = `Lady Macbeth calls on the spirits to "unsex me here" [[cite:1]]. Later she says "out, damned spot" [[ cite : 2 ]].`;
  const parsed = citations.parseCitations(draft);
  assert.deepEqual(
    parsed.citations.map((c) => [c.number, c.quotation]),
    [
      [1, "unsex me here"],
      [2, "out, damned spot"],
    ],
  );
  assert.doesNotMatch(parsed.text, /\[\[|cite/i);
  assert.match(parsed.text, /to "unsex me here"\./, "the space the marker left behind is tidied, and nothing else is touched");
  assert.equal(citations.hasCitations(parsed.text), false);
  // A marker with no quotation in its own sentence claims nothing about any words.
  assert.equal(citations.parseCitations("The play is a tragedy [[cite:2]].").citations[0].quotation, null);
  // The rule the research block carries, and the check that decides whether an answer needs touching at all.
  assert.match(citations.citationRule(2), /\[\[cite:1\]\]/);
  assert.equal(citations.citationRule(0), "");
  assert.equal(citations.hasCitations("A plain answer with [1] brackets and a cite in the prose."), false);
});

test("the research block numbers its sources and asks for the number beside every quotation", () => {
  const block = ground.groundingBlock(
    { status: "partial", queries: ["q"], note: "", sources: [{ url: "https://www.folger.edu/macbeth", title: "Macbeth", tier: "authoritative_text", excerpt: "unsex me here" }] },
    true,
    { searches: 1, fetches: 1 },
  );
  assert.match(block, /- \[1\] \[authoritative text\] Macbeth <https:\/\/www\.folger\.edu\/macbeth>: unsex me here/);
  assert.match(block, /\[\[cite:1\]\]/);
  // Nothing was read: there is nothing to number, so there is no rule either.
  assert.equal(ground.groundingBlock(null, true, { searches: 0, fetches: 0 }), "");
});

test("a cited source is checked first: the page the reply named settles the words with no search at all", async () => {
  const folger = "https://www.folger.edu/macbeth";
  const searx = searxWith([raw("https://www.bbc.co.uk/x")]);
  const svc = service(searx, { [folger]: "<p>Act 1, Scene 5. LADY MACBETH: Come, you spirits ... unsex me here.</p>" });
  const session = svc.session("u");
  await session.fetchPage(folger);
  const v = await session.verifyQuotation({ quotation: "unsex me here", work: "Macbeth", sourceUrl: folger });
  assert.equal(v.status, "verified_exact");
  assert.equal(searx.calls.length, 0, "the named page was read this turn, so nothing had to be looked up");
});

test("a citation that does not settle it falls back to the ordinary search, so a marker can never make a quotation harder to check", async () => {
  const folger = "https://www.folger.edu/macbeth";
  const bbc = "https://www.bbc.co.uk/x";
  const searx = searxWith([raw(folger)]);
  const svc = service(searx, { [bbc]: "<p>nothing relevant here at all</p>", [folger]: "<p>Act 5, Scene 1. LADY MACBETH: Out, damned spot! Out, I say!</p>" });
  const session = svc.session("u");
  await session.fetchPage(bbc);
  const v = await session.verifyQuotation({ quotation: "Out, damned spot! Out, I say!", work: "Macbeth", sourceUrl: bbc });
  assert.equal(searx.calls.length, 1, "the words were looked up after the page it named did not carry them");
  assert.equal(v.status, "verified_exact");
});

/* ------------------------------------------------------------------ the recall stage */

test("the recall stage keeps only what the code can stand behind: a span that is really on the page, about the claim's own character", () => {
  const passages = [{ id: "p1", label: "the play", text: "Gerald is dismissed from the works after the strike." }];
  const claims = [{ id: "c1", subject: "Gerald", event: "prison", sentence: "Gerald is sent to prison." }];
  const asked = (span, relation = "supports", passage = "p1") => entail.acceptSupports([{ claim: "c1", relation, passage, span }], claims, passages);
  // The page says it in its own words, and the words are really there: the span is kept as the model copied it.
  assert.deepEqual(asked("Gerald is dismissed from the works"), [{ claim: "c1", relation: "supports", span: "Gerald is dismissed from the works", label: "the play", others: [] }]);
  // A span the model made up, a page that was never given, words too short to prove anything, and anything but supports/contradicts: all dropped.
  assert.equal(asked("Gerald is sent to prison for fraud").length, 0);
  assert.equal(asked("Gerald is dismissed from the works", "supports", "p9").length, 0);
  assert.equal(asked("dismissed from the works").length, 0);
  assert.equal(asked("Gerald is dismissed from the works", "unrelated").length, 0);
  // A span that supports the claim without mentioning its character is not evidence about that character.
  assert.equal(asked("the strike closed the works").length, 0);
  // A contradiction names the person the sources say did it.
  const other = entail.acceptSupports([{ claim: "c1", relation: "contradicts", passage: "p1", span: "Eric is dismissed from the works" }], claims, [{ id: "p1", label: "the play", text: "Eric is dismissed from the works after the strike." }]);
  assert.deepEqual(other, [{ claim: "c1", relation: "contradicts", span: "Eric is dismissed from the works", label: "the play", others: ["Eric"] }]);
  // Case, punctuation and spacing are not differences, and the words come back with their spacing tidied; fewer than four of them is not a quotation.
  assert.equal(entail.locateWords("Gerald is dismissed from", "x Gerald   is  dismissed! from y"), "Gerald is dismissed from");
  assert.equal(entail.locateWords("Gerald is dismissed", "x Gerald   is  dismissed! y"), null);
});

/* ------------------------------------------------------------------ the gate, both together */

/** A prep with exactly the fields the gate reads, and a rewrite that keeps whatever the model wrote (like a repair that changes nothing). */
const prepFor = (session, sources, ctx = { subject: "english_literature", activity: "exam_answer", work: "Macbeth" }) => ({
  ctx,
  session,
  grounding: sources.length ? { status: "grounded", queries: [], sources, note: "" } : null,
  willGround: true,
  extracts: [],
  quoteChecks: new Map(),
  verdicts: new Map(),
  mode: "verified",
});
const keepDraft = async (_instruction, draft) => draft;
const scrub = (spaces) => spaces.replace(/\s+/g, " ");

test("the gate checks a cited quotation against the source it names, and reports a number that was never listed", async () => {
  const folger = "https://www.folger.edu/macbeth";
  const searx = searxWith([raw(folger)]);
  const svc = service(searx, { [folger]: "<p>Act 1, Scene 5. LADY MACBETH: Come, you spirits ... unsex me here.</p>" });
  const session = svc.session("u");
  await session.fetchPage(folger);
  const sources = [{ url: folger, title: "Macbeth", tier: "authoritative_text", excerpt: "unsex me here" }];
  // Cited properly: the words are in the page it named, so there is no problem and no search.
  const good = await gate.reviewAnswer(prepFor(session, sources), `Lady Macbeth calls on the spirits to "unsex me here" [[cite:1]].`, { rewrite: keepDraft });
  assert.equal(good.firstDraft.length, 0);
  assert.equal(searx.calls.length, 0);
  assert.doesNotMatch(good.text, /\[\[|cite/i, "the marker is not part of the answer");
  assert.match(scrub(good.text), /to "unsex me here"\./);
  // A number that was never listed is reported, and the sentence that carries it is cut rather than attributed to nothing.
  const bad = await gate.reviewAnswer(prepFor(session, sources), `She calls on the spirits: "unsex me here" [[cite:4]] today.`, { rewrite: keepDraft });
  assert.equal(bad.firstDraft.length, 1);
  assert.equal(bad.firstDraft[0].status, "UNSUPPORTED");
  assert.match(bad.firstDraft[0].problem, /source 4/);
  assert.doesNotMatch(bad.text, /unsex me here/);
  assert.doesNotMatch(bad.text, /\[\[/);
});

test("a claim the exact check cannot read is not cut when the recall stage can point at the page that settles it", async () => {
  const url = "https://www.history.example.org/the-play";
  const pages = { [url]: "<p>Gerald is dismissed from the works after the strike, and leaves the family.</p>" };
  const draft = "Gerald is sent to prison for his part in the strike.";
  const ctx = { subject: "history", activity: "exam_answer", work: null };
  const session = async (svc) => {
    const s = svc.session("u");
    await s.fetchPage(url);
    return s;
  };
  const proposing = (span) => ({
    id: "fake-recall",
    findSupport: async ({ claims, passages }) => [{ claim: claims[0].id, relation: "supports", passage: passages[0].id, span }],
  });

  // With the stage: the page settles the claim in words the event patterns do not carry, so nothing is cut.
  const kept = await gate.reviewAnswer(prepFor(await session(service(searxWith([]), pages, proposing("Gerald is dismissed from the works"))), [], ctx), draft, { rewrite: keepDraft });
  assert.deepEqual(kept.firstDraft, []);
  assert.match(kept.text, /sent to prison/);

  // Without it, the same sentence is unsupported, and the gate cuts it: that is the behaviour this stage exists to correct.
  const without = await gate.reviewAnswer(prepFor(await session(service(searxWith([]), pages, null)), [], ctx), draft, { rewrite: keepDraft });
  assert.equal(without.firstDraft.length, 1);
  assert.equal(without.firstDraft[0].status, "UNSUPPORTED");
  assert.doesNotMatch(without.text, /sent to prison/);

  // And a stage that invents a span buys nothing: the words it offers must really be on the page.
  const liar = await gate.reviewAnswer(prepFor(await session(service(searxWith([]), pages, proposing("Gerald is sent to prison for fraud"))), [], ctx), draft, { rewrite: keepDraft });
  assert.equal(liar.firstDraft.length, 1);
  assert.equal(liar.firstDraft[0].status, "UNSUPPORTED");
});
