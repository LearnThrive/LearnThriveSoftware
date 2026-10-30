import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// Who says a quoted line, and how sure the checker may be of it. A live check (30 October 2026) told a student that "Out, damned spot!" was "spoken by Doct,
// not by Lady Macbeth": the loose plain-text reading of a page had run two speeches together. A speaker read from an unambiguous layout may contradict a
// student; one read loosely never may. The words are still verified either way.

const play = loadTsFrom(import.meta.url, "../src/lib/assistant/research/playText.ts");
const verify = loadTsFrom(import.meta.url, "../src/lib/assistant/research/verify.ts");

const PUBLIC = async () => ["93.184.216.34"];
const LIMITS = { maxSearches: 3, maxFetches: 3, fetchMaxBytes: 200000, fetchTimeoutMs: 1000, perMinute: 20 };
const page = (body, type = "text/html") => async () => ({ status: 200, headers: { get: (n) => (n.toLowerCase() === "content-type" ? type : null) }, read: async (max) => ({ bytes: new TextEncoder().encode(body).subarray(0, max), truncated: false }) });

function research(url, body) {
  return new verify.ResearchService({
    searx: { available: true, search: async (q) => ({ status: "ok", query: q, results: [{ title: "Macbeth", url, snippet: "", engines: ["x"], category: "general", publishedDate: null }], detail: "ok" }) },
    limits: LIMITS,
    fetchOptions: { resolve: PUBLIC, fetcher: async () => page(body)() },
  });
}

// A Project Gutenberg style text, where the speaker is an abbreviation and a stage name ("Lady M.") does not fit the loose reading.
const GUTENBERG = `<html><title>Macbeth</title><body><pre>
ACT V. SCENE I.
Doct. I have two nights watched with you: but can perceive no truth in your report.
Lady M. Out, damned spot! out, I say!--One: two: why, then, 'tis time to do't.
</pre></body></html>`;
const MIT = `<html><title>Macbeth Act 5 Scene 1</title><body><h3>Act V, Scene I</h3>
<A NAME=speech1><b>Doctor</b></a><blockquote><A NAME=5.1.1>I have two nights watched with you, but can perceive no truth in your report.</A><br></blockquote>
<A NAME=speech2><b>LADY MACBETH</b></a><blockquote><A NAME=5.1.31>Out, damned spot! out, I say!</A><br><A NAME=5.1.32>One: two: why, then, 'tis time to do't.</A><br></blockquote></body></html>`;

test("a speaker read from an unambiguous layout is marked structured, and a loose reading is not", () => {
  const mit = play.parseSpeeches({ html: MIT, text: "", url: "https://shakespeare.mit.edu/macbeth/macbeth.5.1.html" });
  assert.deepEqual(mit.map((s) => [s.speaker, s.structured]), [["Doctor", true], ["LADY MACBETH", true]]);
  const md = play.parseSpeeches({ html: "", text: "**Doctor**\n> Hark! she speaks.\n\n**LADY MACBETH**\n> Out, damned spot! out, I say!", url: "https://example.org/x" });
  assert.ok(md.length && md.every((s) => s.structured), "bold names in converted Markdown");
  const folger = play.parseSpeeches({ html: "", text: "LADY MACBETH 2072 Out, damned spot, out, I say!", url: "https://www.folger.edu/x" });
  assert.ok(folger.length && folger.every((s) => s.structured), "Folger line numbers");
  const loose = play.parseSpeeches({ html: "", text: GUTENBERG.replace(/<[^>]+>/g, ""), url: "https://www.gutenberg.org/files/1533/1533-h/1533-h.htm" });
  assert.ok(loose.length >= 1 && loose.every((s) => !s.structured), "plain text with abbreviated names is only a loose reading");
  // And the loose reading really does run speeches together, which is why it cannot be trusted to contradict anyone.
  const found = play.locateQuotation(loose, "Out, damned spot!");
  assert.ok(found, "the words are found");
  assert.equal(found.speech.speaker, "Doct", "the loose reading attributed the line to the wrong speaker (the bug seen live)");
});

test("a loose reading never tells a student they have the wrong speaker: the words are verified and the speaker is reported as not checked", async () => {
  const url = "https://www.gutenberg.org/files/1533/1533-h/1533-h.htm";
  const session = research(url, GUTENBERG).session("u1");
  const verdict = await session.verifyQuotation({ quotation: "Out, damned spot!", work: "Macbeth", claimedSpeaker: "Lady Macbeth", claimedAct: 5, claimedScene: 1 });
  assert.equal(verdict.status, "verified_exact", "the exact words are in an authoritative text");
  assert.notEqual(verdict.status, "incorrect_attribution");
  assert.equal(verdict.attribution, "unchecked");
  assert.equal(verdict.speaker, undefined, "a speaker the loose reading guessed is not reported as the real one");
});

test("a structured reading still catches a real wrong speaker and a real wrong place", async () => {
  const url = "https://shakespeare.mit.edu/macbeth/macbeth.5.1.html";
  const wrongSpeaker = await research(url, MIT).session("u2").verifyQuotation({ quotation: "Out, damned spot!", work: "Macbeth", claimedSpeaker: "Macbeth" });
  assert.equal(wrongSpeaker.status, "incorrect_attribution");
  assert.equal(wrongSpeaker.speaker, "LADY MACBETH");
  assert.match(wrongSpeaker.note, /spoken by LADY MACBETH/);
  const wrongPlace = await research(url, MIT).session("u3").verifyQuotation({ quotation: "Out, damned spot!", work: "Macbeth", claimedSpeaker: "Lady Macbeth", claimedAct: 2, claimedScene: 2 });
  assert.equal(wrongPlace.status, "incorrect_attribution");
  assert.match(wrongPlace.note, /Act 5 Scene 1/);
  const right = await research(url, MIT).session("u4").verifyQuotation({ quotation: "Out, damned spot!", work: "Macbeth", claimedSpeaker: "Lady Macbeth", claimedAct: 5, claimedScene: 1 });
  assert.equal(right.status, "verified_exact");
  assert.equal(right.attribution, "confirmed");
  assert.equal(right.speaker, "LADY MACBETH");
});
