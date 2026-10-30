import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment, quiet } from "./_routeHelpers.mjs";

// A whole turn that asks for an interactive interface, with the scripted mock standing in for Beam (the mock proves the code, not the model): when one is
// built, when one is not, what is checked before a student can see it, what is stored, and what the model is told about it afterwards.

const svc = loadTsFrom(import.meta.url, "../src/lib/assistant/service.ts");
const cfgLib = loadTsFrom(import.meta.url, "../src/lib/assistant/config.ts");
const verify = loadTsFrom(import.meta.url, "../src/lib/assistant/research/verify.ts");
const format = loadTsFrom(import.meta.url, "../src/lib/openui/format.ts");
const check = loadTsFrom(import.meta.url, "../src/lib/openui/validate.ts");
const intent = loadTsFrom(import.meta.url, "../src/lib/openui/intent.ts");
const ver = loadTsFrom(import.meta.url, "../src/lib/openui/verification.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

const PUBLIC = async () => ["93.184.216.34"];
const LIMITS = { maxSearches: 5, maxFetches: 5, fetchMaxBytes: 200000, fetchTimeoutMs: 1000, perMinute: 50 };
const MACBETH = "https://shakespeare.mit.edu/macbeth/macbeth.5.1.html";
const MACBETH_PAGE = `<html><title>Macbeth Act 5 Scene 1</title><body><h3>Act V, Scene I</h3>
<A NAME=speech1><b>Doctor</b></a><blockquote><A NAME=5.1.1>I have two nights watched with you, but can perceive no truth in your report.</A><br></blockquote>
<A NAME=speech2><b>LADY MACBETH</b></a><blockquote><A NAME=5.1.31>Out, damned spot! out, I say!</A><br><A NAME=5.1.32>One: two: why, then, 'tis time to do't.</A><br></blockquote></body></html>`;
const html = (body) => async () => ({ status: 200, headers: { get: (n) => (n.toLowerCase() === "content-type" ? "text/html" : null) }, read: async (max) => ({ bytes: new TextEncoder().encode(body).subarray(0, max), truncated: false }) });

function macbethResearch() {
  return new verify.ResearchService({
    searx: { available: true, search: async (q) => ({ status: "ok", query: q, results: [{ title: "Macbeth Act 5 Scene 1", url: MACBETH, snippet: "", engines: ["x"], category: "general", publishedDate: null }], detail: "ok" }) },
    limits: LIMITS,
    fetchOptions: { resolve: PUBLIC, fetcher: async (url) => html(url === MACBETH ? MACBETH_PAGE : "<p>unrelated</p>")() },
  });
}

async function world(t, { env = {}, research = null, provider = new MockProvider({ delayMs: 0 }) } = {}) {
  environment(t, {});
  quiet(t);
  const store = new InMemoryLibraryStore();
  const profile = store.seedProfile({ email: "p@example.com" });
  const clientId = await store.accounts.ensureClient(profile);
  const config = cfgLib.assistantConfig({ NODE_ENV: "development", ASSISTANT_PROVIDER: "mock", ...env });
  const owner = { clientId, studentId: null };
  const deps = { store, provider, queue: new GenerationQueue(1, 4), uploads: new MemoryLibraryStorage(), config, research, hosted: true, now: () => new Date("2026-10-21T10:30:15Z"), log: () => {} };
  const run = async (text, { sessionId = null, voice = false, signal } = {}) => {
    const events = [];
    for await (const e of svc.sendMessage(deps, { owner, sessionId, text, voice, signal })) events.push(e);
    return events;
  };
  const stored = async (events) => (await store.chat.listMessages(owner, events.find((e) => e.type === "session").sessionId)).filter((m) => m.role === "assistant");
  return { store, owner, provider, deps, run, stored, config };
}

const ui = (events) => events.filter((e) => e.type === "ui");
const phases = (events) => ui(events).map((e) => e.phase);
const collapse = (list) => list.filter((p, i) => p !== list[i - 1]);
const steps = (events) => events.filter((e) => e.type === "activity").map((e) => e.step);
const finalOf = (events) => ui(events).find((e) => e.phase === "final")?.content;

test("which messages ask for an interface: only the ones that say so, and a student who says no is believed", () => {
  const kind = (text) => intent.planInterface(text)?.kind ?? null;
  assert.equal(kind("Explain photosynthesis"), null, "an ordinary question is answered in words");
  assert.equal(kind("What is the capital of France?"), null);
  assert.equal(kind("Explain how to factorise a quadratic"), null);
  assert.equal(kind("Show me photosynthesis interactively"), "interactive");
  assert.equal(kind("Quiz me on photosynthesis"), "quiz");
  assert.equal(kind("Can you give me a quiz on fractions?"), "quiz");
  assert.equal(kind("Make me flashcards for the water cycle"), "flashcards");
  assert.equal(kind("Plot y = x² for me"), "graph");
  assert.equal(kind("Graph y = 2x + 1"), "graph");
  assert.equal(kind("Draw a graph of a quadratic function"), "graph");
  assert.equal(kind("Compare Remains and War Photographer"), "comparison");
  assert.equal(kind("Compare 3/4 and 2/3"), null, "two fractions are a sentence, not a table");
  assert.equal(kind("Show me a timeline of the First World War"), "timeline");
  assert.equal(kind("Show me a diagram of the water cycle"), "diagram");
  assert.equal(kind("Take me through 2x + 7 = 19 step by step, revealing one step at a time"), "worked");
  assert.equal(kind("Explain question 4 step by step"), null, "plain step by step is answered in words, where the working is checked");
  assert.equal(kind("Give me a revision checklist for photosynthesis"), "organiser");
  for (const declined of ["Quiz me, but just in words please", "No quiz, only an explanation of photosynthesis", "I don't want a diagram, explain the water cycle", "Explain the graph of y = x² in words"]) assert.equal(kind(declined), null, declined);
  assert.equal(kind("quiz"), null, "too short to mean anything");
  assert.ok(intent.planInterface("Quiz me on photosynthesis").guidance.length > 40);
});

test("an ordinary question is answered in words: no interface events, no interface prompt, plain text stored", async (t) => {
  const w = await world(t);
  const events = await w.run("Explain photosynthesis");
  assert.deepEqual(ui(events), []);
  assert.ok(events.some((e) => e.type === "delta"));
  assert.equal(events.at(-1).type, "done");
  assert.doesNotMatch(w.provider.requests.at(-1)[0].content, /INTERFACE in openui-lang/);
  const [answer] = await w.stored(events);
  assert.equal(format.isInterfaceMessage(answer.content), false);
});

test("an interface turn: drawn progressively, checked, stored apart from plain text, and the model was taught the library", async (t) => {
  const w = await world(t);
  const events = await w.run("Show me photosynthesis interactively");
  assert.deepEqual(collapse(phases(events)), ["start", "chunk", "final"]);
  assert.equal(events.filter((e) => e.type === "delta").length, 0, "nothing is sent as ordinary text");
  assert.equal(events.at(-1).type, "done");
  const content = finalOf(events);
  const stored = format.parseStoredMessage(content);
  assert.equal(stored.kind, "interface");
  assert.deepEqual(check.validateInterface(stored.program).issues, [], "what is stored passes the same checks again");
  const streamed = ui(events).filter((e) => e.phase === "chunk").map((e) => e.text).join("");
  assert.equal(check.extractProgram(streamed), stored.program, "what streamed is what was kept");
  const [answer] = await w.stored(events);
  assert.equal(answer.content, content);
  assert.ok(format.isInterfaceMessage(answer.content));
  // What the model was told: the library, the rules, and what to build (not the student's words as instructions).
  const sent = w.provider.requests.at(-1);
  assert.match(sent[0].content, /INTERFACE in openui-lang/);
  assert.match(sent[0].content, /ProcessDiagram\(/);
  assert.match(sent.at(-1).content, /<interface-request>/);
  assert.equal(sent.length, 2, "the system prompt and the student's message");
  const names = steps(events).map((s) => `${s.kind}:${s.state}`);
  assert.ok(names.includes("write:done") && names.includes("verify:done"), names.join(","));
  assert.ok(!steps(events).some((s) => s.state === "running" && !steps(events).some((x) => x.id === s.id && x.state !== "running")), "no step is left running");
});

test("every kind of interface the mock can write passes the validator, so the page is only ever given interfaces that were checked", async (t) => {
  const w = await world(t, { env: { ASSISTANT_PER_MINUTE: "60", ASSISTANT_DAILY_MESSAGES: "500" } });
  const asks = ["Quiz me on photosynthesis", "Plot y = x² and let me move it", "Make flashcards on photosynthesis", "Show me a diagram of photosynthesis", "Compare these two quotations side by side", "Take me through 2x + 7 = 19 step by step, one step at a time", "Show me a timeline of the war", "Give me a revision checklist on photosynthesis", "Show me photosynthesis interactively"];
  for (const ask of asks) {
    const events = await w.run(ask);
    const content = finalOf(events);
    assert.ok(content, `${ask}: an interface was built`);
    const stored = format.parseStoredMessage(content);
    assert.deepEqual(check.validateInterface(stored.program).issues, [], ask);
  }
});

test("a wrong answer key is caught before any student can use the quiz, and the model is asked once to correct it", async (t) => {
  const w = await world(t);
  const events = await w.run("Quiz me on photosynthesis [ui:fixable]");
  assert.deepEqual(collapse(phases(events)), ["start", "chunk", "discard", "start", "chunk", "final"], "a first draft, thrown away, a corrected one");
  assert.equal(w.provider.requests.length, 2, "one repair request, no more");
  const repair = w.provider.requests[1].at(-1);
  assert.equal(repair.role, "user");
  assert.match(repair.content, /answer key says option 1, but "6 × 7" comes to 42, which is option 2/);
  assert.match(repair.content, /Write the WHOLE interface again/);
  assert.equal(w.provider.requests[1].at(-2).role, "assistant", "the rejected draft goes back so the model can fix it");
  const stored = format.parseStoredMessage(finalOf(events));
  assert.match(stored.program, /\["36", "42", "48"\], 1,/, "the stored quiz has the right key");
  const names = steps(events).map((s) => `${s.kind}:${s.state}`);
  assert.ok(names.includes("repair:done"), names.join(","));
  assert.ok(names.includes("verify:failed"), "the failed check is shown as failed, not hidden");
});

test("an interface that stays invalid is thrown away, never shown, and the answer is given in words that say so", async (t) => {
  for (const marker of ["[ui:invalid]", "[ui:truncated]", "[ui:script]"]) {
    const w = await world(t);
    const events = await w.run(`Quiz me on photosynthesis ${marker}`);
    assert.equal(finalOf(events), undefined, `${marker}: no interface`);
    assert.deepEqual(collapse(phases(events)), ["start", "chunk", "discard", "start", "chunk", "discard"], marker);
    assert.equal(w.provider.requests.length, 3, `${marker}: two interface attempts and then the text answer`);
    const text = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
    assert.match(text, /^I could not build the interactive version, so here is the explanation in words\./);
    assert.equal(events.at(-1).type, "done");
    const [answer] = await w.stored(events);
    assert.equal(format.isInterfaceMessage(answer.content), false, "stored as ordinary text");
    assert.match(answer.content, /^I could not build the interactive version/);
    assert.doesNotMatch(w.provider.requests.at(-1)[0].content, /INTERFACE in openui-lang/, "the fallback is an ordinary answer");
    assert.ok(steps(events).some((s) => s.kind === "write" && s.state === "failed"), "the failure is shown as one");
  }
});

test("with no repairs allowed a bad interface goes straight to the text answer; and the setting can switch interfaces off", async (t) => {
  const noRepair = await world(t, { env: { OPENUI_MAX_REPAIRS: "0" } });
  const a = await noRepair.run("Quiz me on photosynthesis [ui:fixable]");
  assert.equal(finalOf(a), undefined);
  assert.equal(noRepair.provider.requests.length, 2, "one interface attempt, then the words");
  const off = await world(t, { env: { OPENUI_ENABLED: "off" } });
  const b = await off.run("Quiz me on photosynthesis");
  assert.deepEqual(ui(b), []);
  assert.ok(b.some((e) => e.type === "delta"));
  const capped = await world(t, { env: { OPENUI_MAX_REPAIRS: "2" } });
  const c = await capped.run("Quiz me on photosynthesis [ui:invalid]");
  assert.equal(capped.provider.requests.length, 4, "the first draft, two repairs, and the words: a bound, not a loop");
  assert.equal(finalOf(c), undefined);
});

test("a spoken question, and a student who asks for words, never get an interface", async (t) => {
  const w = await world(t);
  assert.deepEqual(ui(await w.run("Quiz me on photosynthesis", { voice: true })), []);
  assert.deepEqual(ui(await w.run("Quiz me on photosynthesis, but just in words")), []);
});

test("quotations in an interface are checked against the real text by the research layer, and the result is kept with it", async (t) => {
  const w = await world(t, { research: macbethResearch() });
  const events = await w.run("Compare these two quotations side by side");
  const stored = format.parseStoredMessage(finalOf(events));
  const [real, fake] = [format.quoteKey("Out, damned spot!"), format.quoteKey("To thine own self be true")].map((key) => stored.context.verifications.find((v) => v.key === key));
  assert.equal(real.status, "VERIFIED_EXACT");
  assert.equal(real.speaker, "LADY MACBETH");
  assert.match(real.location, /Act 5/);
  assert.equal(real.source.url, MACBETH);
  assert.match(real.detail, /exact words/);
  assert.notEqual(fake.status, "VERIFIED_EXACT", "words that are not in the text are never shown as verified");
  assert.notEqual(fake.status, "VERIFIED_VARIANT");
  assert.ok(stored.context.sources.some((s) => s.url === MACBETH), "the page that was read is listed as a source");
  const activity = steps(events).filter((s) => s.label === "Checking the quotations against the text").at(-1);
  assert.ok(activity && activity.state === "done" && /confirmed in the text/.test(activity.detail));
});

test("with no research available, a quotation is never passed off as checked", async (t) => {
  const w = await world(t, { research: null });
  const events = await w.run("Compare these two quotations side by side");
  const stored = format.parseStoredMessage(finalOf(events));
  assert.equal(stored.context.verifications.length, 2);
  for (const v of stored.context.verifications) {
    assert.equal(v.status, "UNVERIFIED");
    assert.match(v.detail, /could not be checked here/);
  }
});

test("the five quotation states: each verdict of the research layer maps to what a student is shown", () => {
  const base = { quotation: "Out, damned spot!", work: "Macbeth", evidence: [{ url: MACBETH, title: "Macbeth", tier: "authoritative_text", extract: "Out, damned spot! out, I say!", read: true }], note: "n" };
  const s = (status, extra = {}) => ver.toCheck({ ...base, status, ...extra });
  assert.equal(s("verified_exact", { speaker: "LADY MACBETH", location: "Act 5 Scene 1" }).status, "VERIFIED_EXACT");
  assert.match(s("verified_exact", { speaker: "LADY MACBETH", location: "Act 5 Scene 1" }).detail, /LADY MACBETH, Act 5 Scene 1/);
  assert.equal(s("verified_variant", { sourceWording: "Out, damn'd spot" }).status, "VERIFIED_VARIANT");
  assert.match(s("verified_variant", { sourceWording: "Out, damn'd spot" }).detail, /damn'd spot/);
  assert.equal(s("incorrect_attribution", { note: "These words are spoken by X, not by Y." }).status, "INCORRECT_ATTRIBUTION");
  assert.equal(s("incorrect_attribution", { note: "These words are spoken by X, not by Y." }).detail, "These words are spoken by X, not by Y.");
  assert.equal(s("paraphrase_or_misquote").status, "PARAPHRASE");
  for (const status of ["supported_secondary", "unsupported", "unverifiable"]) {
    const c = s(status);
    assert.equal(c.status, "UNVERIFIED", status);
    assert.equal(c.source, undefined, `${status}: no source is offered as confirmation`);
  }
  assert.match(s("unsupported").detail, /not found in the sources/);
  assert.equal(s("verified_exact").source.url, MACBETH);
  assert.equal(ver.STATUS_LABEL.UNVERIFIED, "Not verified");
});

test("history: the next turn is told an interface was shown, as a short description, never as markers or a program", async (t) => {
  const w = await world(t);
  const first = await w.run("Quiz me on photosynthesis");
  const sessionId = first.find((e) => e.type === "session").sessionId;
  await w.run("Explain the first question", { sessionId });
  const sent = w.provider.requests.at(-1);
  const assistant = sent.filter((m) => m.role === "assistant");
  assert.equal(assistant.length, 1);
  assert.match(assistant[0].content, /^\[LearnThrive AI showed the student an interactive interface\./);
  assert.doesNotMatch(JSON.stringify(sent), /openui:content|openui:end|root = Answer|MultipleChoice\(/);
});

test("Stop during an interface keeps nothing half-built: no interface is stored and none is released", async (t) => {
  const w = await world(t, { provider: new MockProvider({ delayMs: 15 }) });
  const stop = new AbortController();
  const events = [];
  setTimeout(() => stop.abort(), 60);
  for await (const e of svc.sendMessage(w.deps, { owner: w.owner, sessionId: null, text: "Show me photosynthesis interactively [slow]", signal: stop.signal })) events.push(e);
  assert.equal(finalOf(events), undefined);
  assert.equal(events.some((e) => e.type === "error" && e.code !== "aborted"), false);
  const sessionId = events.find((e) => e.type === "session").sessionId;
  const assistant = (await w.store.chat.listMessages(w.owner, sessionId)).filter((m) => m.role === "assistant");
  assert.equal(assistant.some((m) => format.isInterfaceMessage(m.content)), false, "a stopped interface is never stored as one");
  assert.ok(!steps(events).some((s) => s.state === "running" && !steps(events).some((x) => x.id === s.id && x.state !== "running")), "nothing is left running");
});

test("every request an interface turn makes is charged, and a failed provider says so rather than answering with something else", async (t) => {
  const w = await world(t);
  await w.run("Quiz me on photosynthesis [ui:fixable]");
  const day = new Date(Math.floor(new Date("2026-10-21T10:30:15Z").getTime() / 86_400_000) * 86_400_000);
  const charged = await w.store.chat.usageCount(w.owner.clientId, svc.USAGE_TOKENS_DAY, day);
  assert.ok(charged > 100, `both requests were counted (${charged})`);
  const failing = await world(t);
  const events = await failing.run("Quiz me on photosynthesis [fail]");
  assert.deepEqual(events.at(-1), { type: "error", code: "unavailable" });
  assert.equal(finalOf(events), undefined);
});
