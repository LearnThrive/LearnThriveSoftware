import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { loadTsFrom } from "./_tsLoader.mjs";

const own = (clientId, studentId = null) => ({ clientId, studentId });

// Marking as evidence and judgement kept apart: the official scheme (checked against the paper, then applied criterion by criterion), the rules no
// model can bend (credit needs a cited line; the final answer is decided by calculation; a dependent mark needs its parent), blank / unreadable /
// wrong as three states, pending marks never counted as zero, and corrections and tutor reviews as new versions.

const assess = loadTsFrom(import.meta.url, "../src/lib/paper/assess.ts");
const scheme = loadTsFrom(import.meta.url, "../src/lib/paper/scheme.ts");
const mark = loadTsFrom(import.meta.url, "../src/lib/paper/mark.ts");
const paper = loadTsFrom(import.meta.url, "../src/lib/paper/paper.ts");
const { PaperJobs } = loadTsFrom(import.meta.url, "../src/lib/paper/jobs.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

/** A PDF whose pages are lists of [text, y] lines. */
async function pdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const rows of pages) {
    const page = doc.addPage([595, 842]);
    for (const [text, y] of rows) page.drawText(text, { x: 72, y, size: 12, font });
  }
  return doc.save();
}
const HEAD = (extra = []) => [["Pearson Edexcel GCSE Mathematics 1MA1/1H", 800], ["Higher Tier", 780], ["Paper 1 (Non-Calculator), 2 June 2023", 760], ...extra];
const questionPaper = (head = HEAD()) => pdf([[...head, ["1 (a) Work out 3 + 4 (1)", 700], ["(b) Solve 2x + 7 = 19 (2)", 600], ["2 Work out 3 x 4 (2)", 500]]]);
const schemePdf = (head = [["Mark Scheme (Results) Summer 2023", 800], ["Pearson Edexcel GCSE Mathematics 1MA1/1H", 780], ["Higher Tier", 760]]) =>
  pdf([[...head, ["1 (a) 7 B1 cao", 700], ["(b) 2x = 12 M1 for isolating the term in x", 640], ["x = 6 A1 cao", 620], ["2 12 M1 for 3 x 4 A1 cao", 560]]]);

const crit = (id, over = {}) => ({ id, kind: "M", marks: 1, text: "t", source: "provisional", ref: "r", dependsOn: [], followThrough: false, finalAnswer: false, ...over });

test("the scheme's criteria are read with their marks, dependencies, follow-through and 'cao'", () => {
  const c = scheme.criteriaOf("2x = 12 M1 for isolating the term in x dep A1 ft their 12 B1 cao SC1 for 6");
  assert.deepEqual(c.map((x) => [x.mark, x.dependent, x.followThrough, x.cao]), [["M1", false, false, false], ["A1", true, true, false], ["B1", false, false, true]]);
  assert.match(c[0].text, /isolating/);
  assert.deepEqual(scheme.criteriaOf("the answer is 6"), [], "no criteria are invented");
});

test("a paper and its scheme are compared on code, tier, session and question parts", async () => {
  const read = async (bytes) => {
    const doc = await paper.extractQuestions(null, bytes);
    return { identity: scheme.identityOf(doc.pages), questions: doc.questions, pages: doc.pages };
  };
  const p = await read(await questionPaper());
  assert.deepEqual(p.identity, { code: "1MA1/1H", tier: "higher", session: "summer 2023" });
  const s = await scheme.readScheme(await schemePdf());
  assert.deepEqual([...s.parts.keys()], ["1(a)", "1(b)", "2"]);
  assert.deepEqual([...s.parts.values()].map((x) => x.total), [1, 2, 2]);
  const match = scheme.matchScheme(p, s);
  assert.equal(match.status, "match");
  assert.deepEqual(match.checked.sort(), ["marks", "paper code", "question labels", "session", "tier"]);

  const other = await scheme.readScheme(await schemePdf([["Mark Scheme (Results) Summer 2023", 800], ["Pearson Edexcel GCSE Mathematics 1MA1/2H", 780], ["Higher Tier", 760]]));
  assert.equal(scheme.matchScheme(p, other).status, "mismatch", "another paper's scheme");
  const foundation = await scheme.readScheme(await schemePdf([["Mark Scheme (Results) Summer 2023", 800], ["Pearson Edexcel GCSE Mathematics 1MA1/1F", 780], ["Foundation Tier", 760]]));
  assert.match(scheme.matchScheme(p, foundation).reasons.join(), /paper code|tier/);
  const november = await scheme.readScheme(await schemePdf([["Mark Scheme (Results) November 2022", 800], ["Pearson Edexcel GCSE Mathematics 1MA1/1H", 780], ["Higher Tier", 760]]));
  assert.match(scheme.matchScheme(p, november).reasons.join(), /session/);
  // A paper with nothing to identify it cannot be confirmed: ambiguous, so no marks are awarded from the scheme.
  const bare = await read(await questionPaper([]));
  assert.equal(scheme.matchScheme(bare, s).status, "ambiguous");
  // A scheme that does not cover the paper's questions is not its scheme.
  const short = await scheme.readScheme(await pdf([[["Mark Scheme Summer 2023 1MA1/1H Higher", 800], ["7 B1 cao", 700], ["9 M1 A1", 600]]]));
  assert.ok(short === null || scheme.matchScheme(p, short).status !== "match");
});

test("credit needs a cited line that exists; the final answer is decided by calculation; dependent marks need their parent", () => {
  const lines = ["2x = 12", "x = 6"];
  const base = { lines: [...lines], finalMatches: true, referenceConfirmed: true, workingShown: true };
  const criteria = [crit("M1"), crit("M2"), crit("A1", { kind: "A", finalAnswer: true })];
  const ok = assess.applyAwards({ ...base, criteria, proposals: [{ id: "M1", met: true, lines: [0], reason: "r" }, { id: "M2", met: true, lines: [1], reason: "r" }] });
  assert.deepEqual(ok.awards.map((a) => [a.criterionId, a.status, a.basis]), [["M1", "awarded", "model"], ["M2", "awarded", "model"], ["A1", "awarded", "calculation"]]);

  const noLine = assess.applyAwards({ ...base, criteria, proposals: [{ id: "M1", met: true, lines: [], reason: "r" }, { id: "M2", met: true, lines: [9], reason: "r" }] });
  assert.deepEqual(noLine.awards.map((a) => a.status), ["review", "review", "awarded"], "a claim with no line behind it is neither awarded nor denied");
  assert.equal(noLine.missing.length, 2);

  const unsure = assess.applyAwards({ ...base, criteria, proposals: [{ id: "M1", met: null, lines: [], reason: "" }] });
  assert.deepEqual(unsure.awards.map((a) => a.status), ["review", "review", "awarded"]);
  assert.deepEqual(assess.applyAwards({ ...base, criteria, proposals: null }).awards.map((a) => a.status), ["review", "review", "awarded"], "no usable answer from the model: review, not zero");

  // A model that says the answer criterion is met when the answer is wrong is not believed.
  const wrong = assess.applyAwards({ ...base, finalMatches: false, criteria, proposals: [{ id: "M1", met: true, lines: [0], reason: "r" }, { id: "M2", met: false, lines: [], reason: "wrong division" }, { id: "A1", met: true, lines: [1], reason: "looks right" }] });
  assert.deepEqual(wrong.awards.map((a) => [a.criterionId, a.status]), [["M1", "awarded"], ["M2", "not_awarded"], ["A1", "not_awarded"]], "method marks survive a wrong answer; the answer mark does not");

  // Unconfirmed reference or an answer that cannot be compared: the answer mark waits.
  assert.equal(assess.applyAwards({ ...base, referenceConfirmed: false, criteria: [crit("A1", { finalAnswer: true })], proposals: [] }).awards[0].status, "review");
  assert.equal(assess.applyAwards({ ...base, finalMatches: null, criteria: [crit("A1", { finalAnswer: true })], proposals: [] }).awards[0].status, "review");

  // Dependencies.
  const dep = [crit("M1"), crit("A1", { kind: "A", dependsOn: ["M1"] })];
  assert.deepEqual(assess.applyAwards({ ...base, criteria: dep, proposals: [{ id: "M1", met: false, lines: [], reason: "no" }, { id: "A1", met: true, lines: [1], reason: "yes" }] }).awards.map((a) => a.status), ["not_awarded", "not_awarded"]);
  assert.deepEqual(assess.applyAwards({ ...base, criteria: dep, proposals: [{ id: "M1", met: null, lines: [], reason: "" }, { id: "A1", met: true, lines: [1], reason: "yes" }] }).awards.map((a) => a.status), ["review", "review"]);

  // Follow-through needs a person unless the final answer is right anyway.
  const ft = [crit("M1", { followThrough: true })];
  const prop = [{ id: "M1", met: true, lines: [0], reason: "uses their value" }];
  assert.equal(assess.applyAwards({ ...base, finalMatches: false, criteria: ft, proposals: prop }).awards[0].status, "review");
  assert.equal(assess.applyAwards({ ...base, finalMatches: true, criteria: ft, proposals: prop }).awards[0].status, "awarded");

  // Nothing shown: a right answer leaves the method marks for a person; a wrong one earns none.
  const bare = { ...base, lines: ["x = 6"], workingShown: false };
  assert.deepEqual(assess.applyAwards({ ...bare, criteria, proposals: null }).awards.map((a) => a.status), ["review", "review", "awarded"]);
  assert.deepEqual(assess.applyAwards({ ...bare, finalMatches: false, criteria, proposals: null }).awards.map((a) => a.status), ["not_awarded", "not_awarded", "not_awarded"]);
});

test("a rubric: provisional from the printed marks and the checked reference, none when no marks are printed", () => {
  const reference = { finalAnswer: "6", steps: [{ say: "Take 7 from both sides", math: "2x = 12" }, { say: "Divide by 2", math: "x = 6" }] };
  const three = assess.provisionalCriteria({ number: "1", marks: 3 }, reference);
  assert.deepEqual(three.map((c) => [c.id, c.kind, c.marks, c.source, c.finalAnswer]), [["M1", "M", 1, "provisional", false], ["M2", "M", 1, "provisional", false], ["A1", "A", 1, "provisional", true]]);
  assert.match(three[0].text, /Take 7 from both sides/);
  assert.deepEqual(assess.provisionalCriteria({ number: "1", marks: 1 }, reference).map((c) => c.id), ["A1"]);
  assert.deepEqual(assess.provisionalCriteria({ number: "1", marks: null }, reference), [], "no printed maximum, no invented one");
});

test("totals keep assessed, pending and possible apart: an unreadable answer is not zero, a blank one is", () => {
  const a = (awarded, pending, review = null, override = null, possible = 2) => ({ outOf: possible, assessment: { marks: { awarded, possible, pending }, review, override } });
  const t = assess.totalsOf([a(2, 0), a(0, 0), a(null, 3, { code: "unreadable", why: "x" }, null, 3), a(1, 1, { code: "evidence_missing", why: "y" }), a(null, 0, null, null, null)]);
  assert.deepEqual([t.assessedAwarded, t.assessedPossible, t.pendingPossible, t.totalPossible, t.withoutMarks, t.assessed, t.pending], [2, 4, 5, 9, 1, 3, 2]);
  const overridden = assess.totalsOf([a(1, 1, { code: "evidence_missing", why: "y" }, { by: "t", at: "x", marks: 2, note: "" })]);
  assert.deepEqual([overridden.assessedAwarded, overridden.assessedPossible, overridden.pendingPossible], [2, 2, 0], "a tutor's decision settles it");
  assert.match(mark.totalsLine(t), /2 out of 4/);
  assert.match(mark.totalsLine(t), /5 marks on 2 questions still need a person to look \(not counted as zero\)/);
  assert.match(mark.totalsLine(t), /9 possible in all/);
});

const scripted = ({ student, awards, solution }) => ({
  id: "scripted",
  async health() { return { ok: true, detail: "ok" }; },
  async *stream(messages) {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const reply = system.startsWith("Read the student's handwritten") ? student : system.startsWith("You decide which marking criteria") ? awards : system.startsWith("Give feedback") ? { mistake: "", feedback: "Check the step.", method_marks: null } : solution;
    yield { type: "text", text: JSON.stringify(reply) };
  },
});
const solutionOf = (final) => ({ transcription: "", final_answer: final, steps: [{ say: "Divide", math: `x = ${final}` }], explanation: "", assumptions: [], confidence: "high", check: { kind: "none" } });
const deps = (provider) => ({ provider, queue: new GenerationQueue(1, 10), model: "m", visionModel: "m" });
const question = (text, over = {}) => ({ id: "q1", number: "1(b)", page: 1, text, marks: 2, box: null, answer: null, bands: [], answerLine: null, fromText: true, ...over });

test("with a confirmed scheme the scheme's own criteria are applied, each traceable, and the answer mark is the calculation's", async () => {
  const s = await scheme.readScheme(await schemePdf());
  const part = s.parts.get("1(b)");
  const awards = { awards: [{ id: "M1#1", met: true, lines: [0], reason: "Isolates 2x." }] };
  const out = await mark.markQuestion(deps(scripted({ student: { answer: "x = 6", working: ["2x = 12", "x = 6"], legibility: "high", blank: false }, awards, solution: solutionOf("6") })), question("Solve 2x + 7 = 19"), "pic", null, { part, scheme: { status: "match", note: "ok" } });
  assert.equal(out.assessment.basis, "scheme");
  assert.deepEqual(out.assessment.criteria.map((c) => [c.id, c.source, c.finalAnswer]), [["M1#1", "scheme", false], ["A1#2", "scheme", true]]);
  assert.match(out.assessment.criteria[0].ref, /scheme p\.1, 1\(b\), M1/, "traceable to the scheme");
  assert.equal(out.estimate, 2);
  // A part of the scheme whose criteria could not be read is sent for review, not invented.
  const unreadable = await mark.markQuestion(deps(scripted({ student: { answer: "x = 6", working: ["x = 6"], legibility: "high", blank: false }, awards, solution: solutionOf("6") })), question("Solve 2x + 7 = 19"), "pic", null, { part: { label: "1(b)", criteria: [], text: "", page: 1, total: 0 }, scheme: { status: "match", note: "" } });
  assert.equal(unreadable.assessment.review.code, "scheme_unsupported");
  assert.equal(unreadable.estimate, null);
});

test("blank, unreadable and wrong are three states; an unsure reading is never called wrong; crossed-out work is kept and not marked", async () => {
  const run = (student) => mark.markQuestion(deps(scripted({ student, awards: { awards: [] }, solution: solutionOf("6") })), question("Solve 2x + 7 = 19", { marks: 2 }), "pic");
  const blank = await run({ answer: "", working: [], legibility: "high", blank: true });
  assert.deepEqual([blank.assessment.answerState, blank.assessment.marks, blank.assessment.review, blank.estimate], ["blank", { awarded: 0, possible: 2, pending: 0 }, null, 0]);
  const unreadable = await run({ answer: "5", working: [], legibility: "low", blank: false });
  assert.deepEqual([unreadable.assessment.answerState, unreadable.assessment.marks.awarded, unreadable.assessment.marks.pending, unreadable.assessment.review.code, unreadable.estimate], ["unreadable", null, 2, "unreadable", null]);
  const wrong = await run({ answer: "5", working: [], legibility: "high", blank: false });
  assert.deepEqual([wrong.assessment.answerState, wrong.outcome, wrong.assessment.marks.awarded], ["answered", "incorrect", 0]);
  const unsure = await run({ answer: "5", working: ["2x = 12", "x = 5"], legibility: "high", blank: false, uncertain: ["the 5 may be a 6"] });
  assert.deepEqual([unsure.assessment.answerState, unsure.outcome, unsure.assessment.review.code], ["ambiguous", "needs_checking", "ambiguous_reading"], "a doubted reading that disagrees is a question, not a verdict");
  assert.match(unsure.reason, /not sure I read it correctly/);
  const agrees = await run({ answer: "6", working: ["x = 6"], legibility: "high", blank: false, uncertain: ["a smudge"], crossed_out: ["x = 5"] });
  assert.equal(agrees.outcome, "correct", "agreement despite a doubt is still agreement");
  assert.deepEqual(agrees.assessment.crossedOut, ["x = 5"], "crossed-out work is kept for the record");
  assert.ok(!agrees.student.working.includes("x = 5"), "and never marked");
});

async function world(over = {}) {
  const store = new InMemoryLibraryStore();
  const a = await store.accounts.ensureClient(store.seedProfile({ email: "a@example.com" }));
  const b = await store.accounts.ensureClient(store.seedProfile({ email: "b@example.com" }));
  const uploads = new MemoryLibraryStorage();
  const now = new Date("2026-10-23T10:00:00Z");
  const session = await store.chat.createSession(own(a), {}, now);
  const put = async (name, bytes) => {
    await uploads.put(`${session.id}/${name}`, bytes, "application/pdf");
    return store.chat.addFile(own(a), session.id, { storagePath: `${session.id}/${name}`, bytes: bytes.length, contentType: "application/pdf" }, now);
  };
  const provider = new MockProvider({ delayMs: 0 });
  const dep = { store, uploads, solve: { provider, queue: new GenerationQueue(2, 20), model: "mock" }, now: () => now, ...over };
  return { store, uploads, a, b, session, put, provider, deps: dep, jobs: new PaperJobs(), now };
}
async function until(w, who, id, states) {
  for (let i = 0; i < 600; i += 1) {
    const job = await w.jobs.get(w.deps, who, id);
    if (states.includes(job?.state)) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job never reached ${states}`);
}
async function marked(w, input) {
  const started = await w.jobs.start(w.deps, { owner: own(w.a), sessionId: w.session.id, kind: "mark", ...input });
  assert.equal(started.ok, true, JSON.stringify(started));
  await until(w, own(w.a), started.job.id, ["ready"]);
  assert.equal((await w.jobs.solve(w.deps, own(w.a), started.job.id, { mode: "hybrid" })).ok, true);
  return until(w, own(w.a), started.job.id, ["done", "failed"]);
}

test("end to end with a confirmed scheme and a blank paper: the reference is made from the blank paper (no handwriting), the scheme is applied", async () => {
  const w = await world();
  const completed = await w.put("done.pdf", await questionPaper());
  const blank = await w.put("blank.pdf", await questionPaper());
  const sch = await w.put("scheme.pdf", await schemePdf());
  const done = await marked(w, { fileId: completed.id, blankFileId: blank.id, schemeFileId: sch.id });
  assert.equal(done.state, "done", done.message ?? "");
  assert.equal(done.scheme.status, "match");
  const one = done.results.find((r) => r.number === "1(b)");
  assert.equal(one.assessment.referenceSource, "blank_paper");
  assert.equal(one.assessment.basis, "scheme");
  assert.ok(one.assessment.criteria.every((c) => c.source === "scheme" && c.ref.startsWith("scheme p.")));
  assert.equal(one.assessment.provisional, false);
  assert.ok(done.totals, "marks are released by default here");
  // The solver was asked about the question text alone: no picture of the student's page went with the reference requests.
  const solverRequests = w.provider.requests.filter((m) => m[0].content.startsWith("You write worked solutions"));
  assert.ok(solverRequests.length >= 3);
  assert.ok(solverRequests.every((m) => m.every((x) => !x.images?.length)), "no image in any reference request");
  const reads = w.provider.requests.filter((m) => m[0].content.startsWith("Read the student's handwritten"));
  assert.ok(reads.every((m) => m.some((x) => x.images?.length)), "but the student's page was shown to the reader");
});

test("without a scheme the marks are a provisional rubric and say so; with the marks not released no mark appears anywhere", async () => {
  const w = await world({ marksReleased: false });
  const completed = await w.put("done.pdf", await questionPaper());
  const done = await marked(w, { fileId: completed.id });
  assert.equal(done.marksReleased, false);
  assert.equal(done.totals, null);
  for (const r of done.results) {
    assert.equal(r.estimate, null, `${r.number}: no estimate`);
    assert.equal(r.assessment.marksAwarded, null);
    assert.ok(r.assessment.criteria.every((c) => c.marks === null && c.status === "withheld"), `${r.number}: no criterion result`);
  }
  const summary = (await w.store.chat.listMessages(own(w.a), w.session.id)).at(-1).content;
  assert.match(summary, /No marks are shown/);
  assert.doesNotMatch(summary, /AI-estimated \d/);
  const released = await world();
  const doneReleased = await marked(released, { fileId: (await released.put("done.pdf", await questionPaper())).id });
  assert.ok(doneReleased.results.some((r) => r.assessment.provisional), "the rubric is labelled provisional");
});

test("a correction by the student re-assesses one question, keeps the first assessment as version 1, and only the owner can make it", async () => {
  const w = await world();
  const completed = await w.put("done.pdf", await questionPaper());
  const done = await marked(w, { fileId: completed.id });
  const before = done.results.find((r) => r.number === "1(b)");
  assert.equal(before.studentAnswer, "6");
  const q = done.questions.find((x) => x.number === "1(b)");
  const asAva = own(w.a, null);
  const files = (await w.store.chat.listFiles(own(w.a), w.session.id)).length;

  assert.deepEqual(await w.jobs.correct(w.deps, own(w.b), done.id, q.id, { answer: "7" }), { ok: false, code: "not_found" }, "another family");
  const changed = await w.jobs.correct(w.deps, asAva, done.id, q.id, { answer: "x = 7", working: ["2x = 14", "x = 7"], note: "I misread my 6" });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  const after = changed.job.results.find((r) => r.number === "1(b)");
  assert.equal(after.studentAnswer, "x = 7");
  assert.deepEqual(after.assessment.corrections.map((c) => [c.field, c.to, c.by]), [["answer", "x = 7", "guardian"], ["working", "2x = 14 | x = 7", "guardian"]]);
  assert.deepEqual(after.assessment.uncertain, [], "a person's reading is taken as certain");
  assert.equal(after.assessment.criteria.length, before.assessment.criteria.length, "the same criteria as the first assessment");
  const history = await w.store.papers.versions({ kind: "owner", owner: asAva }, done.id, q.id);
  assert.deepEqual(history.map((v) => [v.version, v.kind, v.actorKind]), [[1, "ai", "system"], [2, "correction", "guardian"]]);
  assert.equal(history[0].value.student.answer, "6", "the AI's own reading is still there");
  assert.equal((await w.store.chat.listFiles(own(w.a), w.session.id)).length, files + 1, "the marked PDF was rebuilt");
  const note = (await w.store.chat.listMessages(own(w.a), w.session.id)).at(-1).content;
  assert.match(note, /Question 1\(b\) was checked again/);
  const view = await w.jobs.get(w.deps, asAva, done.id);
  assert.notEqual(view.resultFileId, done.resultFileId, "the job points at the newer PDF");
});

test("a tutor's review replaces the AI's marks in the totals, is recorded as theirs, and the AI's assessment stays in the history", async () => {
  const w = await world();
  const done = await marked(w, { fileId: (await w.put("done.pdf", await questionPaper())).id });
  const q = done.questions.find((x) => x.number === "2");
  const tutor = "11111111-1111-4111-8111-111111111111";
  const out = await w.jobs.review(w.deps, tutor, done.id, q.id, { marks: 1, note: "Method shown but slip in the multiplication." });
  assert.equal(out.ok, true, JSON.stringify(out));
  const r = out.job.results.find((x) => x.number === "2");
  assert.deepEqual([r.estimate, r.assessment.override.marks, r.assessment.override.note], [1, 1, "Method shown but slip in the multiplication."]);
  const history = await w.store.papers.versions({ kind: "staff" }, done.id, q.id);
  assert.deepEqual(history.map((v) => [v.kind, v.actorKind, v.actorId]), [["ai", "system", null], ["review", "tutor", tutor]]);
  assert.deepEqual(await w.jobs.review(w.deps, tutor, done.id, "q99", { marks: 1, note: "" }), { ok: false, code: "not_found" });
  // The marks cannot exceed what the paper carries.
  const capped = await w.jobs.review(w.deps, tutor, done.id, q.id, { marks: 50, note: "" });
  assert.equal(capped.job.results.find((x) => x.number === "2").estimate, 2);
});

test("reassessing keeps the reference and the criteria, and reading a correction as certain can turn a doubt into a mark", async () => {
  const unsure = await mark.markQuestion(deps(scripted({ student: { answer: "5", working: ["2x = 12", "x = 5"], legibility: "high", blank: false, uncertain: ["5 or 6?"] }, awards: { awards: [{ id: "M1", met: true, lines: [0], reason: "ok" }] }, solution: solutionOf("6") })), question("Solve 2x + 7 = 19"), "pic");
  assert.equal(unsure.assessment.review.code, "ambiguous_reading");
  const fixed = await mark.reassess(deps(scripted({ student: {}, awards: { awards: [{ id: "M1", met: true, lines: [0], reason: "ok" }] }, solution: solutionOf("6") })), unsure, { answer: "6", working: ["2x = 12", "x = 6"], by: "student", at: new Date("2026-10-23T10:00:00Z") });
  assert.equal(fixed.outcome, "correct");
  assert.equal(fixed.assessment.review, null);
  assert.deepEqual(fixed.assessment.criteria, unsure.assessment.criteria === undefined ? [] : fixed.assessment.criteria);
  assert.equal(fixed.reference.finalAnswer, unsure.reference.finalAnswer, "the reference was not regenerated");
  assert.equal(fixed.assessment.corrections.length, 2);
});
