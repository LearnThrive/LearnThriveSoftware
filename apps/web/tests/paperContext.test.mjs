import assert from "node:assert/strict";
import test from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { loadTsFrom } from "./_tsLoader.mjs";

const own = (clientId, studentId = null) => ({ clientId, studentId });

// Uploading 3(a), getting its answer, then uploading 3(b): the second upload shows only the part. It must be solved with the shared question, the
// original page (the diagram), and the earlier result as a claim to re-check; saved with the job so a reload or a recovery solves it the same
// way; never merged with an unrelated question 3; and told plainly when the context is missing or ambiguous.

const { linkContext, arrivesWithoutContext } = loadTsFrom(import.meta.url, "../src/lib/paper/context.ts");
const { PaperJobs } = loadTsFrom(import.meta.url, "../src/lib/paper/jobs.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

const FLOOR = "The diagram shows a plan of a floor.\nPetra has 3 tins of paint.\nThere are 2.5 litres of paint in each tin.\nPetra thinks 1 litre of paint will cover 10 m² of floor.";
const PART_A = "Assuming Petra is correct, does she have enough paint to cover the floor?";
const PART_B = "Petra's paint actually covers 11 m² per litre. Does this change your answer to part (a)? You must show your working.";

const fragment = (number, over = {}) => ({ id: `n-${number}`, number, page: 1, text: "Part words.", ownText: "Part words.", marks: null, box: null, answer: null, bands: [], answerLine: null, fromText: false, ...over });
const earlierJob = (id, fileId, questions, checkpoints = {}) => ({ id, fileId, questions, checkpoints });
const solvedA = { id: "q1", finalAnswer: "Yes", status: "unchecked", steps: [{ say: "Area", math: "80 - 12 = 68\\text{ m}^2" }, { math: "7.5 \\times 10 = 75\\text{ m}^2" }], conclusion: "Yes, because 75 m^2 is more than 68 m^2." };

test("a part that arrives without its shared words is told apart from one that has them", () => {
  assert.equal(arrivesWithoutContext(fragment("3(b)")), true);
  assert.equal(arrivesWithoutContext(fragment("3(b)", { stem: FLOOR })), false, "a page that has its own stem is its own question, whatever its number");
  assert.equal(arrivesWithoutContext(fragment("3")), false, "a whole question has no parent to find");
});

test("3(b) is linked to the one earlier question 3 that has shared words, with its page and what was concluded", () => {
  const jobs = [earlierJob("job-a", "file-a", [{ id: "q1", number: "3(a)", page: 1, stem: FLOOR }], { q1: solvedA })];
  const link = linkContext([fragment("3(b)")], jobs).get("n-3(b)");
  assert.equal(link.kind, "linked");
  assert.deepEqual([link.context.fromJobId, link.context.fromFileId, link.context.page, link.context.group], ["job-a", "file-a", 1, "3"]);
  assert.equal(link.context.stem, FLOOR);
  assert.equal(link.context.earlier[0].number, "3(a)");
  assert.equal(link.context.earlier[0].answer, "Yes");
  assert.ok(link.context.earlier[0].steps.some((line) => line.includes("75")), "the earlier result is carried as claims to re-check");
});

test("never merged by number alone: a part with its own stem is not linked, two earlier question 3s are ambiguous, none at all is missing", () => {
  const one = [earlierJob("job-a", "file-a", [{ id: "q1", number: "3(a)", page: 1, stem: FLOOR }])];
  assert.equal(linkContext([fragment("3(b)", { stem: "A different question about a garden." })], one).get("n-3(b)").kind, "none");
  const two = [...one, earlierJob("job-c", "file-c", [{ id: "q1", number: "3(a)", page: 1, stem: "A completely different paper's question 3, about a garden path." }])];
  assert.deepEqual(linkContext([fragment("3(b)")], two).get("n-3(b)"), { kind: "ambiguous", groups: 2 });
  assert.deepEqual(linkContext([fragment("3(b)")], []).get("n-3(b)"), { kind: "missing" });
  assert.deepEqual(linkContext([fragment("5(b)")], one).get("n-5(b)"), { kind: "missing" }, "question 5 is not question 3");
  // The same question uploaded twice is one group, not two.
  const twice = [...one, earlierJob("job-b", "file-b", [{ id: "q1", number: "3(b)", page: 2, stem: FLOOR }])];
  assert.equal(linkContext([fragment("3(c)")], twice).get("n-3(c)").kind, "linked");
});

/** A model with the owner's pages: it lists what is on the picture it is shown, solves from the words and the pictures it is given, and keeps its requests. */
class Pages extends MockProvider {
  constructor() {
    super({ delayMs: 0 });
    this.listing = null;
    this.solverRequests = [];
    /** When set, part (a) is solved WRONGLY (a misread floor of 78 m², so "No"), as the owner's model sometimes did. */
    this.wrongA = false;
  }
  async *stream(messages, options) {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const send = function* (value) {
      yield { type: "text", text: JSON.stringify(value) };
      yield { type: "done" };
    };
    if (options.json && system.startsWith("List the questions on this exam")) return yield* send(this.listing);
    if (options.json && system.startsWith("This is an exam page, or part of one")) return yield* send({ marks: [] });
    if (options.json && system.startsWith("You are locating questions")) return yield* send({ items: [] });
    if (options.json && system.startsWith("You write worked solutions")) {
      const user = messages.find((m) => m.role === "user");
      this.solverRequests.push({ text: user.content, images: user.images?.length ?? 0 });
      const partB = user.content.includes("actually covers 11");
      const withContext = user.content.includes("Petra has 3 tins of paint");
      if (!partB && this.wrongA) return yield* send({ transcription: user.content, givens: ["top edge 10 m"], final_answer: "No", conclusion: "No, because 75 m^2 is less than 78 m^2.", comparison: { have: "75 m^2", need: "78 m^2", relation: "<" }, steps: [{ say: "Whole rectangle", math: "10 \\times 8 = 80\\text{ m}^2" }, { say: "Wrong corner", math: "(10 - 6) \\times 5 = 20\\text{ m}^2" }, { say: "Floor", math: "80 - 20 + 18 = 78\\text{ m}^2" }, { say: "Paint", math: "3 \\times 2.5 = 7.5\\text{ litres}" }, { say: "Covers", math: "7.5 \\times 10 = 75\\text{ m}^2" }, { say: "Compare", math: "75\\text{ m}^2 < 78\\text{ m}^2" }], explanation: "The paint covers less than the floor.", assumptions: [], confidence: "medium", check: { kind: "none" } });
      if (partB && !withContext) return yield* send({ transcription: user.content, givens: [], final_answer: "", conclusion: "", steps: [], explanation: "", assumptions: ["the floor area is not given"], confidence: "low", check: { kind: "none" } });
      return yield* send(
        partB
          ? { transcription: user.content, givens: ["11 m² per litre", "7.5 litres"], final_answer: "No", conclusion: "No, it does not change: she still has enough paint, because 82.5 m^2 is more than 68 m^2.", comparison: { have: "82.5 m^2", need: "68 m^2", relation: ">=" }, steps: [{ say: "Floor area from part (a)", math: "10 \\times 8 - (10 - 6) \\times (8 - 5) = 68\\text{ m}^2" }, { say: "Area the paint now covers", math: "7.5 \\times 11 = 82.5\\text{ m}^2" }, { say: "Compare", math: "82.5\\text{ m}^2 > 68\\text{ m}^2" }], explanation: "The paint covers more, so she still has enough.", assumptions: [], confidence: "medium", check: { kind: "none" } }
          : { transcription: user.content, givens: ["top edge 10 m"], final_answer: "Yes", conclusion: "Yes, because 75 m^2 is more than 68 m^2.", comparison: { have: "75 m^2", need: "68 m^2", relation: ">=" }, steps: [{ say: "Whole rectangle", math: "10 \\times 8 = 80\\text{ m}^2" }, { say: "Missing corner", math: "(10 - 6) \\times (8 - 5) = 12\\text{ m}^2" }, { say: "Floor", math: "80 - 12 = 68\\text{ m}^2" }, { say: "Paint", math: "3 \\times 2.5 = 7.5\\text{ litres}" }, { say: "Covers", math: "7.5 \\times 10 = 75\\text{ m}^2" }], explanation: "Compare the area covered with the floor area.", assumptions: [], confidence: "medium", check: { kind: "none" } },
      );
    }
    yield* super.stream(messages, options);
  }
}

const png = (seed) => {
  const canvas = createCanvas(600, 800);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 600, 800);
  ctx.fillStyle = "#000";
  ctx.font = "20px sans-serif";
  ctx.fillText(`page ${seed}`, 40, 60);
  return new Uint8Array(canvas.toBuffer("image/png"));
};

async function world() {
  const store = new InMemoryLibraryStore();
  const a = await store.accounts.ensureClient(store.seedProfile({ email: "ctx@example.com" }));
  const uploads = new MemoryLibraryStorage();
  const t0 = new Date("2026-10-23T10:00:00Z");
  const provider = new Pages();
  const process = () => ({ jobs: new PaperJobs(3000), deps: { store, uploads, solve: { provider, queue: new GenerationQueue(2, 10), model: "mock", visionModel: "mock" }, now: () => t0 } });
  const upload = async (sessionId, seed) => {
    const bytes = png(seed);
    await uploads.put(`${sessionId}/${seed}.png`, bytes, "image/png");
    return store.chat.addFile(own(a), sessionId, { storagePath: `${sessionId}/${seed}.png`, bytes: bytes.length, contentType: "image/png" }, t0);
  };
  return { store, a, provider, process, upload, t0, session: await store.chat.createSession(own(a), {}, t0) };
}

async function until(p, who, id, states) {
  for (let i = 0; i < 600; i += 1) {
    const job = await p.jobs.get(p.deps, who, id);
    if (states.includes(job?.state)) return job;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`job never reached ${states}`);
}

const listing = (shared, label, text) => ({ questions: [{ number: "3", text: shared, parts: [{ label, text, parts: [] }] }] });

test("(a) then (b) in one chat: the second upload is solved with the shared question, the original page and the checked result, and the decision is carried", async () => {
  const w = await world();
  const p = w.process();
  w.provider.listing = listing(FLOOR, "(a)", PART_A);
  const fileA = await w.upload(w.session.id, "a");
  const startedA = await p.jobs.start(p.deps, { owner: own(w.a), sessionId: w.session.id, fileId: fileA.id });
  const readyA = await until(p, own(w.a), startedA.job.id, ["ready", "failed"]);
  assert.deepEqual(readyA.questions.map((x) => [x.number, x.contextState]), [["3(a)", undefined]]);
  assert.equal(readyA.questions[0].stem, FLOOR, "the shared words are saved with the job for later uploads");
  assert.equal((await p.jobs.solve(p.deps, own(w.a), startedA.job.id, { mode: "worked" })).ok, true);
  const doneA = await until(p, own(w.a), startedA.job.id, ["done", "failed"]);
  assert.equal(doneA.state, "done", doneA.message ?? "");
  assert.equal(doneA.results[0].answer, "Yes");

  // (b): a picture of the part only, no stem, no diagram.
  w.provider.listing = { questions: [{ number: "", text: "", parts: [{ label: "(b)", text: PART_B, parts: [] }] }] };
  w.provider.listing = { questions: [{ number: "3", text: "", parts: [{ label: "(b)", text: PART_B, parts: [] }] }] };
  const fileB = await w.upload(w.session.id, "b");
  const startedB = await p.jobs.start(p.deps, { owner: own(w.a), sessionId: w.session.id, fileId: fileB.id });
  const readyB = await until(p, own(w.a), startedB.job.id, ["ready", "failed"]);
  const [qb] = readyB.questions;
  assert.equal(qb.number, "3(b)");
  assert.equal(qb.contextState, "linked");
  assert.deepEqual([qb.context.fromJobId, qb.context.fromFileId, qb.context.group], [startedA.job.id, fileA.id, "3"]);
  assert.equal(qb.context.stem, FLOOR);
  assert.match(readyB.message ?? "", /using its shared words and its page from your earlier upload/);

  // A different process takes it up (a reload or a recovery): the link was saved, so it solves the same way.
  const q = w.process();
  assert.equal((await q.jobs.solve(q.deps, own(w.a), startedB.job.id, { mode: "worked" })).ok, true);
  const doneB = await until(q, own(w.a), startedB.job.id, ["done", "failed"]);
  assert.equal(doneB.state, "done", doneB.message ?? "");
  const request = w.provider.solverRequests.at(-1);
  assert.match(request.text, /<earlier_in_this_chat>/);
  assert.ok(request.text.includes("Petra has 3 tins of paint"), "the shared facts");
  assert.ok(request.text.includes("Part 3(a): an earlier attempt gave \"Yes\""), "the earlier result, as a claim");
  assert.match(request.text, /reading of the diagram was not/);
  assert.equal(request.images, 2, "this page and the original page with the diagram, not the whole history");
  const result = doneB.results[0];
  assert.equal(result.answer, "No", "does this change your answer: No, the decision is the same");
  assert.ok(result.steps.some((s) => (s.math ?? "").includes("7.5 \\times 11 = 82.5")), "coverage becomes 7.5 x 11 = 82.5");
  assert.match(result.note, /82\.5 m\^2 is more than 68 m\^2/);
  assert.match(result.note, /does not change/, "and the decision, with its reason");
  assert.ok(w.provider.solverRequests.filter((r) => r.text.includes("<earlier_in_this_chat>")).length >= 1);
});

test("a part with no earlier upload is solved from what is shown and says what is missing, instead of inventing it; another chat's upload is never used", async () => {
  const w = await world();
  const p = w.process();
  // The earlier question 3 is in a different chat of the same family.
  const other = await w.store.chat.createSession(own(w.a), {}, w.t0);
  w.provider.listing = listing(FLOOR, "(a)", PART_A);
  const earlier = await w.upload(other.id, "a");
  const startedA = await p.jobs.start(p.deps, { owner: own(w.a), sessionId: other.id, fileId: earlier.id });
  await until(p, own(w.a), startedA.job.id, ["ready"]);
  assert.equal((await p.jobs.solve(p.deps, own(w.a), startedA.job.id, { mode: "worked" })).ok, true);
  await until(p, own(w.a), startedA.job.id, ["done"]);

  w.provider.listing = { questions: [{ number: "3", text: "", parts: [{ label: "(b)", text: PART_B, parts: [] }] }] };
  const fileB = await w.upload(w.session.id, "b");
  const startedB = await p.jobs.start(p.deps, { owner: own(w.a), sessionId: w.session.id, fileId: fileB.id });
  const readyB = await until(p, own(w.a), startedB.job.id, ["ready"]);
  assert.equal(readyB.questions[0].contextState, "missing", "nothing in THIS chat to link to");
  assert.match(readyB.message ?? "", /have not seen the rest of it/);
  assert.equal((await p.jobs.solve(p.deps, own(w.a), startedB.job.id, { mode: "worked" })).ok, true);
  const doneB = await until(p, own(w.a), startedB.job.id, ["done"]);
  const request = w.provider.solverRequests.at(-1);
  assert.match(request.text, /NOT available/);
  assert.ok(!request.text.includes("Petra has 3 tins of paint"), "the other chat's words were not lent");
  assert.equal(doneB.results[0].answer, "", "no answer is made up from facts it was not given");
  assert.equal(doneB.results[0].status, "unsolved");
});

// ---------------------------------------------------------------------------------------------------------------------------------
// A correction must win over the answer it corrects
// ---------------------------------------------------------------------------------------------------------------------------------

const { contextKey, refreshContext } = loadTsFrom(import.meta.url, "../src/lib/paper/context.ts");

const solved = (answer, comparison, extra = {}) => ({ id: "q1", finalAnswer: answer, status: "unchecked", steps: [{ math: "80 - 12 = 68\\text{ m}^2" }], conclusion: answer === "Yes" ? "Yes, because 75 m^2 is more than 68 m^2." : "No, because 75 m^2 is less than 78 m^2.", comparison, ...extra });
const wrongFirst = () => [
  earlierJob("job-1", "file-1", [{ id: "q1", number: "3(a)", page: 1, stem: FLOOR }], { q1: solved("No", { have: "75 m^2", need: "78 m^2" }) }),
  earlierJob("job-2", "file-2", [{ id: "q1", number: "3(a)", page: 1, stem: FLOOR.replace("The diagram shows", "This diagram shows") }], { q1: solved("Yes", { have: "75 m^2", need: "68 m^2" }) }),
];

test("the latest applicable answer is the active one, with its source and version together; the superseded one stays in the history only", () => {
  const link = linkContext([fragment("3(b)")], wrongFirst()).get("n-3(b)");
  assert.equal(link.kind, "linked", "two uploads of one question with slightly different readings of its words are one group");
  const [active] = link.context.earlier;
  assert.deepEqual([active.number, active.answer, active.version, active.source.jobId, active.source.questionId], ["3(a)", "Yes", 2, "job-2", "q1"]);
  assert.deepEqual(active.comparison, { have: "75 m^2", need: "68 m^2" });
  assert.equal(link.context.fromJobId, "job-2", "the page shown is the latest upload of the question");
  assert.deepEqual(link.context.history.map((h) => [h.number, h.version, h.answer, h.source.jobId]), [["3(a)", 1, "No", "job-1"]], "history is kept, marked as superseded");
  assert.ok(link.context.earlier.every((e) => e.answer !== "No"), "a superseded answer is not active context");
  // A later attempt that produced no answer does not supersede one that did.
  const later = [...wrongFirst(), earlierJob("job-3", "file-3", [{ id: "q1", number: "3(a)", page: 1, stem: FLOOR }], { q1: { id: "q1", finalAnswer: "", status: "unsolved", steps: [] } })];
  assert.equal(linkContext([fragment("3(b)")], later).get("n-3(b)").context.earlier[0].answer, "Yes");
});

test("two uploads of different words are still two questions; a changed word or two is not", () => {
  const near = [earlierJob("a", "fa", [{ id: "q1", number: "3(a)", page: 1, stem: FLOOR }]), earlierJob("b", "fb", [{ id: "q1", number: "3(a)", page: 1, stem: FLOOR.replace("Petra has", "Petra had") }])];
  assert.equal(linkContext([fragment("3(b)")], near).get("n-3(b)").kind, "linked");
  const apart = [earlierJob("a", "fa", [{ id: "q1", number: "3(a)", page: 1, stem: FLOOR }]), earlierJob("c", "fc", [{ id: "q1", number: "3(a)", page: 1, stem: "A rectangular garden is 12 m long and 7 m wide. A path 1 m wide goes all the way round it." }])];
  assert.deepEqual(linkContext([fragment("3(b)")], apart).get("n-3(b)"), { kind: "ambiguous", groups: 2 });
});

test("a saved link is refreshed from the current answers at solve time, and a result solved on an older answer is not kept", () => {
  const stale = linkContext([fragment("3(b)")], [wrongFirst()[0]]).get("n-3(b)").context;
  assert.equal(stale.earlier[0].answer, "No");
  const fresh = refreshContext(stale, wrongFirst());
  assert.equal(fresh.earlier[0].answer, "Yes");
  assert.equal(fresh.earlier[0].version, 2);
  assert.notEqual(contextKey(stale), contextKey(fresh), "a result checkpointed on the old answer carries a different key, so it is not restored over the correction");
  assert.equal(contextKey(fresh), contextKey(refreshContext(fresh, wrongFirst())), "and refreshing again changes nothing");
  assert.deepEqual(refreshContext(stale, []), stale, "with nothing to refresh from (the earlier jobs expired) the saved link stands");
});

const solveAll = async (w, p, sessionId, seed, wrong) => {
  w.provider.wrongA = wrong;
  w.provider.listing = listing(FLOOR, "(a)", PART_A);
  const file = await w.upload(sessionId, seed);
  const started = await p.jobs.start(p.deps, { owner: own(w.a), sessionId, fileId: file.id });
  await until(p, own(w.a), started.job.id, ["ready", "failed"]);
  assert.equal((await p.jobs.solve(p.deps, own(w.a), started.job.id, { mode: "worked" })).ok, true);
  const done = await until(p, own(w.a), started.job.id, ["done", "failed"]);
  assert.equal(done.state, "done", done.message ?? "");
  return { id: started.job.id, done };
};

const partBListing = () => ({ questions: [{ number: "3", text: "", parts: [{ label: "(b)", text: PART_B, parts: [] }] }] });

test("wrong first answer, then the corrected one, then part (b): (b) is solved on the correction, and the history is kept", async () => {
  const w = await world();
  const p = w.process();
  const first = await solveAll(w, p, w.session.id, "a1", true);
  assert.equal(first.done.results[0].answer, "No", "the first answer was wrong");
  const second = await solveAll(w, p, w.session.id, "a2", false);
  assert.equal(second.done.results[0].answer, "Yes", "and the corrected one");

  w.provider.listing = partBListing();
  const fileB = await w.upload(w.session.id, "b");
  const startedB = await p.jobs.start(p.deps, { owner: own(w.a), sessionId: w.session.id, fileId: fileB.id });
  const readyB = await until(p, own(w.a), startedB.job.id, ["ready"]);
  assert.equal(readyB.questions[0].contextState, "linked");
  assert.equal(readyB.questions[0].context.earlier[0].answer, "Yes");
  assert.equal(readyB.questions[0].context.earlier[0].version, 2);
  assert.equal((await p.jobs.solve(p.deps, own(w.a), startedB.job.id, { mode: "worked" })).ok, true);
  const doneB = await until(p, own(w.a), startedB.job.id, ["done", "failed"]);
  assert.equal(doneB.state, "done", doneB.message ?? "");
  const request = w.provider.solverRequests.at(-1).text;
  assert.match(request, /an earlier attempt gave "Yes"/);
  assert.doesNotMatch(request, /gave "No"/, "the superseded answer is not in the context");
  assert.doesNotMatch(request, /78 m/, "nor its figures");
  // Nothing is erased: both earlier jobs and their results are still there.
  const jobs = await w.store.papers.listForSession(own(w.a), w.session.id);
  assert.deepEqual(jobs.filter((j) => j.id !== startedB.job.id).map((j) => Object.values(j.checkpoints)[0].finalAnswer), ["No", "Yes"]);
});

test("a correction made after (b) was read but before it was solved, and a recovery by another process, still win", async () => {
  const w = await world();
  const p = w.process();
  await solveAll(w, p, w.session.id, "a1", true);

  // (b) is read now, and linked to the wrong answer.
  w.provider.listing = partBListing();
  const fileB = await w.upload(w.session.id, "b");
  const startedB = await p.jobs.start(p.deps, { owner: own(w.a), sessionId: w.session.id, fileId: fileB.id });
  const readyB = await until(p, own(w.a), startedB.job.id, ["ready"]);
  assert.equal(readyB.questions[0].context.earlier[0].answer, "No");

  // The correction arrives while (b) waits for its choice.
  await solveAll(w, p, w.session.id, "a2", false);

  // Another process takes (b) up: it reads the upload again (the model shows it the same part), must solve on the correction, and save that.
  w.provider.listing = partBListing();
  const other = w.process();
  assert.equal((await other.jobs.solve(other.deps, own(w.a), startedB.job.id, { mode: "worked" })).ok, true);
  const doneB = await until(other, own(w.a), startedB.job.id, ["done", "failed"]);
  assert.equal(doneB.state, "done", doneB.message ?? "");
  const request = w.provider.solverRequests.at(-1).text;
  assert.match(request, /an earlier attempt gave "Yes"/);
  assert.doesNotMatch(request, /gave "No"/);
  const saved = await w.store.papers.get(own(w.a), startedB.job.id);
  assert.equal(saved.questions[0].context.earlier[0].answer, "Yes", "the saved link carries the corrected answer for any later recovery");
  assert.equal(saved.questions[0].context.earlier[0].version, 2);
});
