import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

const own = (clientId, studentId = null) => ({ clientId, studentId });

// Paper jobs live in the store, not in one process: a worker that dies is replaced, the finished questions are kept, and a worker that has
// lost its job (taken over, cancelled) stops writing. The "processes" here are two PaperJobs sharing one store.

const { PaperJobs } = loadTsFrom(import.meta.url, "../src/lib/paper/jobs.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

const WORKSHEET = new Uint8Array(readFileSync(new URL("./fixtures/documents/text-native.pdf", import.meta.url)));
const questionOf = (messages) => /<question>\s*([\s\S]*?)\s*<\/question>/.exec([...messages].reverse().find((m) => m.role === "user")?.content ?? "")?.[1] ?? "";

/** The model for one process: remembers which questions it was asked, and can hold one question until the test lets it go. */
class Model extends MockProvider {
  constructor() {
    super({ delayMs: 0 });
    this.asked = [];
    this.holdOn = null;
    this.entered = new Promise((resolve) => (this.reached = resolve));
    this.released = new Promise((resolve) => (this.release = resolve));
  }
  async *stream(messages, options) {
    const text = questionOf(messages);
    if (options.json && text) this.asked.push(text);
    if (this.holdOn && text.includes(this.holdOn)) {
      this.reached();
      await this.released;
    }
    yield* super.stream(messages, options);
  }
}

async function world() {
  const store = new InMemoryLibraryStore();
  const a = await store.accounts.ensureClient(store.seedProfile({ email: "a@example.com" }));
  const uploads = new MemoryLibraryStorage();
  const t0 = new Date("2026-10-21T10:00:00Z");
  const session = await store.chat.createSession(own(a), {}, t0);
  await uploads.put(`${session.id}/w.pdf`, WORKSHEET, "application/pdf");
  const file = await store.chat.addFile(own(a), session.id, { storagePath: `${session.id}/w.pdf`, bytes: WORKSHEET.length, contentType: "application/pdf" }, t0);
  const process = (model, at = t0) => ({ model, jobs: new PaperJobs(3000), deps: { store, uploads, solve: { provider: model, queue: new GenerationQueue(2, 10), model: "mock" }, now: () => at } });
  return { store, uploads, a, session, file, process, t0 };
}

async function until(p, who, id, states) {
  for (let i = 0; i < 400; i += 1) {
    const job = await p.jobs.get(p.deps, who, id);
    if (states.includes(job?.state)) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job never reached ${states}`);
}

test("a worker that dies mid-paper is replaced: the finished questions are kept and only the rest is redone, once", async () => {
  const w = await world();
  const first = w.process(new Model());
  const started = await first.jobs.start(first.deps, { owner: own(w.a), sessionId: w.session.id, fileId: w.file.id });
  const ready = await until(first, own(w.a), started.job.id, ["ready", "failed"]);
  assert.equal(ready.state, "ready");
  const [q1, q2] = ready.questions;
  first.model.holdOn = q2.text.slice(0, 14);
  assert.equal((await first.jobs.solve(first.deps, own(w.a), started.job.id, { mode: "hybrid" })).ok, true);
  await first.model.entered;
  const midway = await w.store.papers.get(own(w.a), started.job.id);
  assert.deepEqual(Object.keys(midway.checkpoints), [q1.id], "question 1 is saved the moment it is finished");
  assert.equal(midway.state, "solving");

  // The first process is gone (its lease ran out). Another one asks for work.
  const later = new Date(w.t0.getTime() + 10 * 60_000);
  const second = w.process(new Model(), later);
  assert.equal(await second.jobs.recover(second.deps), 1);
  const done = await until(second, own(w.a), started.job.id, ["done", "failed"]);
  assert.equal(done.state, "done", done.message ?? "");
  assert.deepEqual(done.results.map((r) => r.id), [q1.id, q2.id], "both questions are in the result");
  assert.ok(second.model.asked.every((text) => !text.includes(q1.text.slice(0, 14))), "question 1 was not solved again");
  assert.ok(second.model.asked.some((text) => text.includes(q2.text.slice(0, 14))), "question 2 was");
  const record = await w.store.papers.get(own(w.a), started.job.id);
  assert.equal(record.attempts, 2);
  assert.equal(record.leaseOwner, null);

  // The first process wakes up. Its writes are refused, so it adds nothing: one summary, one PDF.
  const messages = (await w.store.chat.listMessages(own(w.a), w.session.id)).length;
  const files = (await w.store.chat.listFiles(own(w.a), w.session.id)).length;
  first.model.release();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await w.store.papers.get(own(w.a), started.job.id)).state, "done");
  assert.equal((await w.store.chat.listMessages(own(w.a), w.session.id)).length, messages, "the old worker posted nothing");
  assert.equal((await w.store.chat.listFiles(own(w.a), w.session.id)).length, files, "nor stored a second PDF");
  assert.equal(messages, 1);
});

test("a job interrupted while reading the paper is read again; one that keeps failing is given up on", async () => {
  const w = await world();
  const first = w.process(new Model());
  // Create the job as a worker would, then let that worker vanish before it saves anything.
  const created = await w.store.papers.create(own(w.a), { sessionId: w.session.id, fileId: w.file.id, schemeFileId: null, kind: "solve" }, { id: "gone", leaseMs: 1000 }, w.t0);
  assert.equal(created.ok, true);
  const later = new Date(w.t0.getTime() + 60_000);
  const second = w.process(new Model(), later);
  assert.equal(await second.jobs.recover(second.deps), 1);
  const ready = await until(second, own(w.a), created.job.id, ["ready", "failed"]);
  assert.equal(ready.state, "ready");
  assert.deepEqual(ready.questions.map((q) => q.number), ["1", "2"]);

  // A paper that kills every worker that touches it: after three runs it is failed, not retried for ever.
  const w2 = await world();
  const c = await w2.store.papers.create(own(w2.a), { sessionId: w2.session.id, fileId: w2.file.id, schemeFileId: null, kind: "solve" }, { id: "w-1", leaseMs: 1000 }, w2.t0);
  let at = w2.t0;
  for (const id of ["w-2", "w-3"]) {
    at = new Date(at.getTime() + 60_000);
    assert.equal((await w2.store.papers.claimStale({ id, leaseMs: 1000 }, at)).claimed.length, 1);
  }
  at = new Date(at.getTime() + 60_000);
  const last = await w2.process(new Model(), at);
  assert.equal(await last.jobs.recover(last.deps), 0);
  const failed = await w2.store.papers.get(own(w2.a), c.job.id);
  assert.equal(failed.state, "failed");
  assert.match(failed.message, /more than once/);
  assert.equal(first.model.asked.length, 0);
});

test("cancelling from another process stops the worker that has the job, and nothing is written after", async () => {
  const w = await world();
  const first = w.process(new Model());
  const started = await first.jobs.start(first.deps, { owner: own(w.a), sessionId: w.session.id, fileId: w.file.id });
  const ready = await until(first, own(w.a), started.job.id, ["ready"]);
  first.model.holdOn = ready.questions[1].text.slice(0, 14);
  await first.jobs.solve(first.deps, own(w.a), started.job.id, { mode: "hybrid" });
  await first.model.entered;
  const other = w.process(new Model());
  assert.equal(await other.jobs.cancel(other.deps, own(w.a), started.job.id), true);
  const asked = first.model.asked.length;
  first.model.release();
  await new Promise((r) => setTimeout(r, 300));
  const record = await w.store.papers.get(own(w.a), started.job.id);
  assert.equal(record.state, "cancelled");
  assert.deepEqual(Object.keys(record.checkpoints), [ready.questions[0].id], "the question that finished after the cancel was not saved");
  assert.equal((await w.store.chat.listMessages(own(w.a), w.session.id)).length, 0, "no summary was posted");
  assert.ok(first.model.asked.length <= asked + 1, "no further questions were started");
});
