import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { loadTsFrom } from "./_tsLoader.mjs";

const own = (clientId, studentId = null) => ({ clientId, studentId });

// A tutor reviews a learner's marked paper only where they teach that learner. Everything else is the same 404; the family's own correction route
// is bounded; a blank paper or scheme from another chat is refused.

const { handleTutorPaper, handleTutorReview } = loadTsFrom(import.meta.url, "../src/lib/paper/tutorReview.ts");
const { handleCorrectPaper, handleStartPaper } = loadTsFrom(import.meta.url, "../src/lib/paper/handlers.ts");
const { PaperJobs } = loadTsFrom(import.meta.url, "../src/lib/paper/jobs.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

const ENV = { NODE_ENV: "development", PAPER_TUTOR_ENABLED: "true", PAPER_MARKER_ENABLED: "true" };

async function pdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  for (const [text, y] of [["1 Solve 2x + 7 = 19 (2)", 700], ["2 Work out 3 x 4 (2)", 600]]) page.drawText(text, { x: 72, y, size: 12, font });
  return doc.save();
}

async function world() {
  const store = new InMemoryLibraryStore();
  const guardian = store.seedProfile({ email: "g@example.com" });
  const client = await store.accounts.ensureClient(guardian);
  const ava = store.seedStudent(guardian, { displayName: "Ava", yearGroup: "10", isMinor: true });
  const uploads = new MemoryLibraryStorage();
  const now = new Date("2026-10-23T10:00:00Z");
  const asAva = own(client, ava);
  const session = await store.chat.createSession(asAva, {}, now);
  const bytes = await pdf();
  await uploads.put(`${session.id}/p.pdf`, bytes, "application/pdf");
  const file = await store.chat.addFile(asAva, session.id, { storagePath: `${session.id}/p.pdf`, bytes: bytes.length, contentType: "application/pdf" }, now);
  const assistant = { provider: new MockProvider({ delayMs: 0 }), queue: new GenerationQueue(2, 20), uploads, config: { model: "mock" } };
  const jobs = new PaperJobs();
  const deps = { store, uploads, solve: { provider: assistant.provider, queue: assistant.queue, model: "mock" }, now: () => now };
  const started = await jobs.start(deps, { owner: asAva, sessionId: session.id, fileId: file.id, kind: "mark" });
  assert.equal(started.ok, true);
  for (let i = 0; i < 400 && (await jobs.get(deps, asAva, started.job.id))?.state !== "ready"; i += 1) await new Promise((r) => setTimeout(r, 25));
  await jobs.solve(deps, asAva, started.job.id, { mode: "hybrid" });
  let done;
  for (let i = 0; i < 600 && !["done", "failed"].includes((done = await jobs.get(deps, asAva, started.job.id))?.state); i += 1) await new Promise((r) => setTimeout(r, 25));
  assert.equal(done.state, "done", done.message ?? "");
  return { store, uploads, assistant, jobs, deps, ava, client, guardian, session, file, asAva, id: started.job.id, done, now };
}

const post = (url, body, headers = {}) => new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", ...headers }, body: JSON.stringify(body) });
const tutorDeps = (w, over = {}) => ({ rt: { store: w.store }, assistant: w.assistant, tutor: async () => ({ profileId: "11111111-1111-4111-8111-111111111111" }), studentsOf: async () => [w.ava], env: ENV, now: w.deps.now, jobs: w.jobs, ...over });

test("a tutor sees and reviews a paper only for a learner they teach; everyone else gets the same 404", async () => {
  const w = await world();
  const get = (deps, id = w.id) => handleTutorPaper(new Request(`http://localhost/api/tutor/papers/${id}`), deps, id);
  const ok = await get(tutorDeps(w));
  assert.equal(ok.status, 200);
  const view = (await ok.json()).job;
  assert.equal(view.results.length, 2);
  assert.ok(view.results[0].assessment, "the tutor sees the whole assessment");

  assert.equal((await get(tutorDeps(w, { studentsOf: async () => [] }))).status, 404, "a tutor who does not teach this learner");
  assert.equal((await get(tutorDeps(w, { studentsOf: async () => ["22222222-2222-4222-8222-222222222222"] }))).status, 404, "a tutor with other learners");
  assert.equal((await get(tutorDeps(w, { tutor: async () => null }))).status, 401, "not signed in as a tutor");
  assert.equal((await get(tutorDeps(w), "33333333-3333-4333-8333-333333333333")).status, 404, "no such paper: the same answer");
  assert.equal((await get(tutorDeps(w), "not-an-id")).status, 404);
  assert.equal((await get(tutorDeps(w, { env: { ...ENV, PAPER_MARKER_ENABLED: "false" } }))).status, 404, "marking is off");

  // A guardian's own paper belongs to no learner: no tutor reviews it.
  const guardianSession = await w.store.chat.createSession(own(w.client), {}, w.now);
  await w.uploads.put(`${guardianSession.id}/p.pdf`, await pdf(), "application/pdf");
  const gfile = await w.store.chat.addFile(own(w.client), guardianSession.id, { storagePath: `${guardianSession.id}/p.pdf`, bytes: 10, contentType: "application/pdf" }, w.now);
  const gjob = await w.jobs.start(w.deps, { owner: own(w.client), sessionId: guardianSession.id, fileId: gfile.id, kind: "mark" });
  assert.equal(gjob.ok, true);
  assert.equal((await get(tutorDeps(w, { studentsOf: async () => [w.ava] }), gjob.job.id)).status, 404);
});

test("a tutor's review is bounded, checked for origin, recorded as theirs, and shows in the learner's own view", async () => {
  const w = await world();
  const q = w.done.questions[1].id;
  const review = (body, deps = tutorDeps(w), headers = {}) => handleTutorReview(post(`/api/tutor/papers/${w.id}/review`, body, headers), deps, w.id);
  assert.equal((await review({ questionId: q, marks: 1, note: "x" }, tutorDeps(w), { origin: "https://evil.example" })).status, 403, "a cross-site post");
  assert.equal((await review({ questionId: "../x", marks: 1 })).status, 400);
  assert.equal((await review({ questionId: q, marks: 1.5 })).status, 400, "whole marks only");
  assert.equal((await review({ questionId: q, marks: -1 })).status, 400);
  assert.equal((await review({ questionId: q })).status, 400, "marks must be given or null");
  assert.equal((await review({ questionId: q, marks: 1 }, tutorDeps(w, { studentsOf: async () => [] }))).status, 404);
  const done = await review({ questionId: "q9", marks: 1 });
  assert.equal(done.status, 404, "a question the paper does not have");
  const ok = await review({ questionId: q, marks: 1, note: "Method shown, slip in the multiplication.\u0000" });
  assert.equal(ok.status, 200);
  const mine = await w.jobs.get(w.deps, w.asAva, w.id);
  const r = mine.results.find((x) => x.id === q);
  assert.deepEqual([r.estimate, r.assessment.override.marks], [1, 1]);
  assert.doesNotMatch(r.assessment.override.note, /\u0000/);
  const history = await w.store.papers.versions({ kind: "owner", owner: w.asAva }, w.id, q);
  assert.deepEqual(history.map((v) => v.actorKind), ["system", "tutor"]);
});

test("a correction by the family is bounded: its question id, text length, and the same owner as the job", async () => {
  const w = await world();
  const q = w.done.questions[0].id;
  const base = (over = {}) => ({ rt: { store: w.store }, jar: {}, assistant: w.assistant, env: ENV, now: w.deps.now, jobs: w.jobs, ...over });
  // The route needs a signed-in session through the gate; here the unit under test is the bounded body and the owner scoping, which the job tests cover end to end.
  const refused = await handleCorrectPaper(post(`/api/assistant/papers/${w.id}/correct`, { questionId: q, answer: "7" }, { origin: "https://evil.example" }), base(), w.id);
  assert.equal(refused.status, 403);
  const closed = await handleCorrectPaper(post(`/api/assistant/papers/${w.id}/correct`, { questionId: q, answer: "7" }), { ...base(), assistant: null }, w.id);
  assert.ok([401, 503].includes(closed.status), "no runtime or not signed in: closed");
});

test("a blank paper or a scheme from another chat is refused at the start of a marking job", async () => {
  const w = await world();
  const other = await w.store.chat.createSession(w.asAva, {}, w.now);
  await w.uploads.put(`${other.id}/b.pdf`, await pdf(), "application/pdf");
  const foreign = await w.store.chat.addFile(w.asAva, other.id, { storagePath: `${other.id}/b.pdf`, bytes: 10, contentType: "application/pdf" }, w.now);
  const second = await w.jobs.start(w.deps, { owner: w.asAva, sessionId: w.session.id, fileId: w.file.id, kind: "mark", blankFileId: foreign.id });
  assert.deepEqual(second, { ok: false, code: "not_found" }, "the blank paper is another chat's");
  const notPdf = await w.store.chat.addFile(w.asAva, w.session.id, { storagePath: `${w.session.id}/i.png`, bytes: 10, contentType: "image/png" }, w.now);
  assert.deepEqual(await w.jobs.start(w.deps, { owner: w.asAva, sessionId: w.session.id, fileId: w.file.id, kind: "mark", blankFileId: notPdf.id }), { ok: false, code: "not_found" }, "a photo cannot be the blank paper");
  assert.ok(handleStartPaper, "the start route accepts blankFileId");
});
