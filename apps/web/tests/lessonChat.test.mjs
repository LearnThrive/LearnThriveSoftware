import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// Lesson chat over HTTP (docs/LESSON_CHAT.md): the handlers the routes call, with the real service and the real in-memory lessons. All people are
// synthetic. The data package has its own, deeper tests of the rules (packages/data/src/lessonChat*.test.ts); these prove the HTTP layer wires them
// in, reads nothing from the request that the server should decide, and that the Socket.IO relay gets no other way in.

const { getDataProvider, resetDataProvider } = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");
const chat = loadTsFrom(import.meta.url, "../../../packages/data/src/lessonChat/index.ts");
const handlers = loadTsFrom(import.meta.url, "../src/lib/lessonChat/handlers.ts");
const runtime = loadTsFrom(import.meta.url, "../src/lib/lessonChat/runtime.ts");
const { signServiceRequest, SERVICE_SIGNATURE_HEADER, SERVICE_TIMESTAMP_HEADER, verifyClassroomJoinToken, signClassroomJoinToken } = loadTsFrom(import.meta.url, "../../../packages/shared/classroomToken.ts");

const MIN = 60_000;
const LEADS = { emails: ["lead@example.test"] };

const person = (over) => ({ email: "x@example.test", name: "Synthetic", ...over });
const tutorU = person({ id: "acct-tutor", name: "Tutor One", role: "TUTOR", roles: ["TUTOR"], profileId: "T1", tutorId: "T1" });
const studentU = person({ id: "acct-student", name: "Student One", role: "STUDENT", roles: ["STUDENT"], profileId: "S1", studentId: "S1" });
const otherStudentU = person({ id: "acct-student-2", role: "STUDENT", roles: ["STUDENT"], profileId: "S2", studentId: "S2" });
const otherTutorU = person({ id: "acct-tutor-2", role: "TUTOR", roles: ["TUTOR"], profileId: "T2", tutorId: "T2" });
const parentU = person({ id: "acct-parent", role: "CLIENT", roles: ["CLIENT"], profileId: "C1", clientId: "C1" });
const otherParentU = person({ id: "acct-parent-2", role: "CLIENT", roles: ["CLIENT"], profileId: "C2", clientId: "C2" });
const juniorU = person({ id: "acct-junior", role: "JUNIOR_TUTOR", roles: ["JUNIOR_TUTOR"], profileId: "T1", tutorId: "T1" });
const adminU = person({ id: "acct-admin", role: "ADMIN", roles: ["ADMIN"], profileId: "acct-admin" });
const leadU = person({ id: "acct-lead", email: "Lead@Example.test", role: "TUTOR", roles: ["TUTOR"], profileId: "T9", tutorId: "T9" });

/** Lessons around the real clock: one on now, one tomorrow, one that ended hours ago, one cancelled. Every one is T1's, for S1 / C1. */
async function world(configOver = {}) {
  resetDataProvider();
  runtime.resetLessonChat();
  const data = getDataProvider();
  const make = async (offsetMinutes, status = "PLANNED") => {
    const assignment = await data.assignments.create({ title: "Maths", subject: "Maths", tutorId: "T1", studentIds: ["S1"], clientIds: ["C1"], status: "ACTIVE" });
    return data.lessons.create({ assignmentId: assignment.id, tutorId: "T1", studentIds: ["S1"], clientIds: ["C1"], title: "Maths", subject: "Maths", startAt: new Date(Date.now() + offsetMinutes * MIN).toISOString(), durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status });
  };
  const now = await make(-10);
  const tomorrow = await make(24 * 60);
  const past = await make(-300);
  const cancelled = await make(-10, "CANCELLED");
  const repo = new chat.InMemoryLessonChatRepository();
  const files = new chat.InMemoryFileStore();
  const config = { ...chat.DEFAULT_LESSON_CHAT_CONFIG, messagesPerMinute: 1000, ...configOver };
  const service = chat.createLessonChatService({ lessons: { get: async (id) => (await data.lessons.get(id)) ?? null }, repo, files, scanner: chat.allowAllScanner, config, urlSecret: "test-only-url-secret-not-real" });
  const deps = { chat: { open: true, service, config }, leads: LEADS };
  return { data, now, tomorrow, past, cancelled, repo, files, deps, service };
}

const json = (body, headers = {}) => new Request("http://localhost:3000/api/lessons/x/messages", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0]);
const upload = (name, type, bytes = PNG, caption) => {
  const form = new FormData();
  form.set("file", new File([bytes], name, { type }));
  if (caption) form.set("caption", caption);
  return new Request("http://localhost:3000/api/lessons/x/messages", { method: "POST", body: form });
};
const status = async (promise) => (await promise).status;
const body = async (response) => response.json();

// ---- who may send, over HTTP ------------------------------------------------------------------------------------------------------------

test("signed out is 401 everywhere, a closed chat is 503, and a request from another site is refused", async () => {
  const w = await world();
  const { listMessages, sendMessage, removeMessage, openFile } = handlers;
  assert.equal(await status(listMessages(null, w.now.id, w.deps)), 401);
  assert.equal(await status(sendMessage(null, w.now.id, json({ text: "hi" }), w.deps)), 401);
  assert.equal(await status(removeMessage(null, w.now.id, "m", json({ reason: "x" }), w.deps)), 401);
  assert.equal(await status(openFile(null, w.now.id, "f", new URL("http://x/?u=a&exp=1&sig=z"), w.deps)), 401);
  const closed = { chat: { open: false, reason: "Lesson chat is not open yet." }, leads: LEADS };
  for (const user of [tutorU, adminU]) {
    assert.equal(await status(listMessages(user, w.now.id, closed)), 503);
    assert.equal(await status(sendMessage(user, w.now.id, json({ text: "hi" }), closed)), 503);
  }
  const cross = await sendMessage(tutorU, w.now.id, json({ text: "hi" }, { origin: "https://evil.example" }), w.deps);
  assert.equal(cross.status, 403);
  assert.equal((await body(cross)).code, "ORIGIN");
  assert.equal((await w.repo.listMessages(w.now.id)).length, 0);
});

test("the lesson's tutor and a student on it send over HTTP; and only `text` is read from the body (sender, lesson and time are never the client's)", async () => {
  const w = await world();
  const sent = await handlers.sendMessage(tutorU, w.now.id, json({ text: "Photograph question 3.", senderParty: "student", senderName: "Forged", lessonId: "other", createdAt: "2001-01-01", accountId: "acct-admin", role: "ADMIN" }), w.deps);
  assert.equal(sent.status, 201);
  const out = (await body(sent)).message;
  assert.equal(out.senderParty, "tutor");
  assert.equal(out.senderName, "Tutor One");
  assert.ok(Date.now() - Date.parse(out.createdAt) < 60_000);
  const [stored] = await w.repo.listMessages(w.now.id);
  assert.deepEqual([stored.senderAccountId, stored.senderRecordId, stored.lessonId], ["acct-tutor", "T1", w.now.id]);
  assert.equal((await handlers.sendMessage(studentU, w.now.id, json({ text: "Here it is." }), w.deps)).status, 201);
});

test("rejected over HTTP: before the start, after the end, a cancelled lesson, an unassigned tutor, a student of another lesson, a parent, a junior tutor, an administrator", async () => {
  const w = await world();
  const send = (user, lesson, text = "hi") => handlers.sendMessage(user, lesson.id, json({ text }), w.deps);
  const expectRefused = async (response, code, httpStatus = 403) => {
    assert.equal(response.status, httpStatus, code);
    assert.equal((await body(response)).code, code);
  };
  await expectRefused(await send(tutorU, w.tomorrow), "TOO_EARLY");
  await expectRefused(await send(studentU, w.tomorrow), "TOO_EARLY");
  await expectRefused(await send(tutorU, w.past), "TOO_LATE");
  await expectRefused(await send(studentU, w.past), "TOO_LATE");
  await expectRefused(await send(tutorU, w.cancelled), "LESSON_CANCELLED");
  await expectRefused(await send(studentU, w.cancelled), "LESSON_CANCELLED");
  await expectRefused(await send(otherTutorU, w.now), "NOT_PARTICIPANT");
  await expectRefused(await send(otherStudentU, w.now), "NOT_PARTICIPANT");
  await expectRefused(await send(parentU, w.now), "NOT_PARTICIPANT");
  await expectRefused(await send(adminU, w.now), "NOT_PARTICIPANT");
  await expectRefused(await send(leadU, w.now), "NOT_PARTICIPANT");
  await expectRefused(await send(juniorU, w.now), "JUNIOR_TUTOR_CANNOT_SEND");
  await expectRefused(await handlers.sendMessage(tutorU, "no-such-lesson", json({ text: "hi" }), w.deps), "LESSON_NOT_FOUND", 404);
  for (const lesson of [w.now, w.tomorrow, w.past, w.cancelled]) assert.equal((await w.repo.listMessages(lesson.id)).length, 0);
});

test("the grace window comes from config over HTTP: 0 by default, and wider when set", async () => {
  const strict = await world();
  const justOver = await (async () => {
    const lesson = await strict.data.lessons.create({ assignmentId: strict.now.assignmentId, tutorId: "T1", studentIds: ["S1"], clientIds: ["C1"], title: "Ended 2 minutes ago", subject: "Maths", startAt: new Date(Date.now() - 62 * MIN).toISOString(), durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status: "PLANNED" });
    return lesson;
  })();
  assert.equal((await handlers.sendMessage(tutorU, justOver.id, json({ text: "late" }), strict.deps)).status, 403, "default grace is 0");
  const roomy = await world({ graceAfterMinutes: 5 });
  const lesson = await roomy.data.lessons.create({ assignmentId: roomy.now.assignmentId, tutorId: "T1", studentIds: ["S1"], clientIds: ["C1"], title: "Ended 2 minutes ago", subject: "Maths", startAt: new Date(Date.now() - 62 * MIN).toISOString(), durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status: "PLANNED" });
  assert.equal((await handlers.sendMessage(tutorU, lesson.id, json({ text: "within the grace" }), roomy.deps)).status, 201);
});

test("a bad body is a 400/415, not a message, and an unrecognised content type is refused", async () => {
  const w = await world();
  const send = (request) => handlers.sendMessage(tutorU, w.now.id, request, w.deps);
  for (const bad of [{}, { text: "" }, { text: 5 }, { text: "x".repeat(2001) }, [], null]) assert.equal((await send(json(bad))).status, 400, JSON.stringify(bad)?.slice(0, 20));
  assert.equal((await send(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" }))).status, 400);
  assert.equal((await send(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "text/plain" }, body: "hi" }))).status, 415);
  assert.equal((await send(json({ text: "x".repeat(40_000) }))).status, 413, "a JSON body is capped before it is parsed");
  assert.equal((await w.repo.listMessages(w.now.id)).length, 0);
});

// ---- files over HTTP ------------------------------------------------------------------------------------------------------------------------

test("files: a png from the student is shared; other types, an oversized file and path-traversal names are rejected, and nothing is stored for them", async () => {
  const w = await world({ maxFileBytes: 1000 });
  const send = (request, user = studentU) => handlers.sendMessage(user, w.now.id, request, w.deps);
  const ok = await send(upload("diagram.png", "image/png", PNG, "my diagram"));
  assert.equal(ok.status, 201);
  const shared = (await body(ok)).message;
  assert.equal(shared.text, "my diagram");
  assert.equal(shared.file.displayName, "diagram.png");
  assert.match(shared.file.url, new RegExp(`^/api/lessons/${w.now.id}/files/[0-9a-f-]{36}\\?u=acct-student&exp=\\d+&sig=`));
  assert.equal(w.files.size, 1);

  const exe = new Uint8Array(60).fill(0x4d);
  for (const [label, request, expected] of [
    ["a program", upload("tool.png", "image/png", exe), 415],
    ["an exe", upload("tool.exe", "application/octet-stream", exe), 415],
    ["html", upload("page.html", "text/html", new TextEncoder().encode("<script>alert(1)</script>")), 415],
    ["svg", upload("x.svg", "image/svg+xml", new TextEncoder().encode("<svg onload=alert(1)>")), 415],
    ["too big", upload("big.png", "image/png", new Uint8Array(5000).fill(1)), 413],
    ["traversal", upload("../../etc/passwd.png", "image/png"), 400],
    ["windows traversal", upload("..\\..\\boot.png", "image/png"), 400],
    ["absolute", upload("/etc/passwd.png", "image/png"), 400],
    ["no file", new Request("http://x/", { method: "POST", body: (() => { const f = new FormData(); f.set("caption", "only words"); return f; })() }), 400],
  ]) {
    const response = await send(request);
    assert.equal(response.status, expected, label);
  }
  assert.equal(w.files.size, 1, "only the first one is stored");
  assert.equal((await w.repo.listMessages(w.now.id)).length, 1);
});

test("files: people who may not send are refused BEFORE their upload is read or stored (parent, junior tutor, unassigned tutor, another lesson's student)", async () => {
  const w = await world();
  for (const user of [parentU, juniorU, otherTutorU, otherStudentU, adminU]) {
    const response = await handlers.sendMessage(user, w.now.id, upload("a.png", "image/png"), w.deps);
    assert.equal(response.status, 403, user.id);
  }
  for (const lesson of [w.tomorrow, w.past, w.cancelled]) assert.equal((await handlers.sendMessage(studentU, lesson.id, upload("a.png", "image/png"), w.deps)).status, 403);
  assert.equal(w.files.size, 0);
});

test("a file link works once signed and only for its own lesson, its own person and its own time", async () => {
  const w = await world();
  const sent = await body(await handlers.sendMessage(studentU, w.now.id, upload("diagram.png", "image/png"), w.deps));
  const fileId = sent.message.file.id;
  const link = (u) => new URL(`http://localhost:3000${u}`);

  const opened = await handlers.openFile(studentU, w.now.id, fileId, link(sent.message.file.url), w.deps);
  assert.equal(opened.status, 200);
  assert.equal(opened.headers.get("content-type"), "image/png");
  assert.equal(opened.headers.get("x-content-type-options"), "nosniff");
  assert.match(opened.headers.get("content-security-policy"), /sandbox/);
  assert.equal(opened.headers.get("cache-control"), "private, no-store");
  assert.match(opened.headers.get("content-disposition"), /^inline; filename="lesson-file\.png"/);
  assert.deepEqual(new Uint8Array(await opened.arrayBuffer()).slice(0, 4), PNG.slice(0, 4));

  // The tutor asks for a link of their own, in a list.
  const tutorList = await body(await handlers.listMessages(tutorU, w.now.id, w.deps));
  assert.equal((await handlers.openFile(tutorU, w.now.id, fileId, link(tutorList.messages[0].file.url), w.deps)).status, 200);
  // The student's link in the tutor's hands, another lesson's address, an unsigned address, and someone else all fail.
  assert.equal((await handlers.openFile(tutorU, w.now.id, fileId, link(sent.message.file.url), w.deps)).status, 403, "made for the student");
  assert.equal((await handlers.openFile(studentU, w.past.id, fileId, link(sent.message.file.url), w.deps)).status, 403, "another lesson's address");
  assert.equal((await handlers.openFile(studentU, w.now.id, fileId, new URL("http://x/"), w.deps)).status, 403, "no signature");
  assert.equal((await handlers.openFile(otherStudentU, w.now.id, fileId, link(sent.message.file.url), w.deps)).status, 403);
  assert.equal((await handlers.openFile(otherParentU, w.now.id, fileId, link(sent.message.file.url), w.deps)).status, 403);
});

test("fetching a file through ANOTHER lesson fails, even with a valid link for that lesson and the same person", async () => {
  const w = await world();
  const sent = await body(await handlers.sendMessage(studentU, w.now.id, upload("diagram.png", "image/png"), w.deps));
  const fileId = sent.message.file.id;
  // A second lesson the same student is also on, that has its own chat (and its own valid link for ITS files).
  const second = await w.data.lessons.create({ assignmentId: w.now.assignmentId, tutorId: "T1", studentIds: ["S1"], clientIds: ["C1"], title: "Second", subject: "Maths", startAt: new Date(Date.now() - 5 * MIN).toISOString(), durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status: "PLANNED" });
  const other = await body(await handlers.sendMessage(studentU, second.id, upload("other.png", "image/png"), w.deps));
  // The link for the second lesson's file, with the FIRST lesson's file id swapped in: the signature no longer matches.
  const swapped = new URL(`http://localhost:3000${other.message.file.url}`);
  assert.equal((await handlers.openFile(studentU, second.id, fileId, swapped, w.deps)).status, 403);
  assert.equal((await handlers.openFile(studentU, w.now.id, other.message.file.id, swapped, w.deps)).status, 403);
  assert.equal((await handlers.openFile(studentU, second.id, other.message.file.id, swapped, w.deps)).status, 200, "its own file, its own lesson");
});

// ---- reading, audit, removal --------------------------------------------------------------------------------------------------------------

test("reading: participants any time; a parent only after the lesson; another child's parent never; administrators and the lead are audited", async () => {
  const w = await world();
  await handlers.sendMessage(tutorU, w.now.id, json({ text: "Question 3?" }), w.deps);
  await handlers.sendMessage(studentU, w.now.id, json({ text: "Done." }), w.deps);
  const list = (user, lesson = w.now) => handlers.listMessages(user, lesson.id, w.deps);
  for (const user of [tutorU, studentU, juniorU]) assert.equal((await body(await list(user))).messages.length, 2, user.id);
  assert.equal((await list(parentU)).status, 403, "not while the lesson is on");
  assert.equal((await body(await list(parentU))).code, "NOT_YET");
  for (const user of [otherParentU, otherStudentU, otherTutorU]) assert.equal((await list(user)).status, 403, user.id);
  assert.deepEqual(await w.repo.listAccess(), [], "no audit rows for participants or refused reads");

  assert.equal((await list(adminU)).status, 200);
  assert.equal((await list(leadU)).status, 200, "the safeguarding lead, by their linked email (any case)");
  assert.deepEqual((await w.repo.listAccess(w.now.id)).map((a) => [a.actorKind, a.actorAccountId, a.action]), [["admin", "acct-admin", "read_messages"], ["safeguarding_lead", "acct-lead", "read_messages"]]);
  // A parent after the lesson: read-only, and recorded.
  const afterwards = await w.data.lessons.create({ assignmentId: w.now.assignmentId, tutorId: "T1", studentIds: ["S1"], clientIds: ["C1"], title: "Done", subject: "Maths", startAt: new Date(Date.now() - 300 * MIN).toISOString(), durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status: "COMPLETED" });
  const parentView = await body(await list(parentU, afterwards));
  assert.equal(parentView.canSend, false);
  assert.equal((await w.repo.listAccess(afterwards.id)).at(-1).actorKind, "parent");
  assert.equal((await handlers.sendMessage(parentU, afterwards.id, json({ text: "hi" }), w.deps)).status, 403);
});

test("removal: administrators only, marked not deleted, audited; everyone else is 403 and the message stays", async () => {
  const w = await world();
  const sent = await body(await handlers.sendMessage(studentU, w.now.id, json({ text: "remove me" }), w.deps));
  const id = sent.message.id;
  const remove = (user, reason = "Not appropriate", lesson = w.now) => handlers.removeMessage(user, lesson.id, id, new Request("http://localhost:3000/x", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }), w.deps);
  for (const user of [tutorU, studentU, parentU, juniorU, leadU, otherTutorU]) assert.equal((await remove(user)).status, 403, user.id);
  assert.equal((await remove(adminU, "")).status, 400, "a reason is required");
  assert.equal((await remove(adminU, "x", w.past)).status, 404, "the message must be in the lesson named");
  assert.equal((await remove(adminU)).status, 200);
  assert.equal((await remove(adminU)).status, 409);
  assert.equal((await w.repo.getMessage(id)).text, "remove me", "never deleted");
  assert.deepEqual((await w.repo.listAccess(w.now.id)).map((a) => [a.action, a.actorAccountId]), [["remove_message", "acct-admin"]]);
  const studentView = (await body(await handlers.listMessages(studentU, w.now.id, w.deps))).messages[0];
  assert.deepEqual([studentView.text, studentView.removed.reason], ["", undefined], "hidden from the lesson's own people");
  const adminView = (await body(await handlers.listMessages(adminU, w.now.id, w.deps))).messages[0];
  assert.deepEqual([adminView.text, adminView.removed.reason], ["remove me", "Not appropriate"]);
});

// ---- the classroom's Socket.IO relay ------------------------------------------------------------------------------------------------------

const relay = (w, payload, over = {}) => {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const ts = over.ts ?? Date.now();
  const sig = over.sig ?? signServiceRequest(over.signedBody ?? raw, ts);
  return new Request("http://localhost:3000/api/internal/lesson-chat", { method: "POST", headers: { "content-type": "application/json", [SERVICE_TIMESTAMP_HEADER]: String(ts), [SERVICE_SIGNATURE_HEADER]: sig }, body: raw });
};
const users = { "acct-tutor": tutorU, "acct-student": studentU, "acct-junior": juniorU, "acct-parent": parentU, "acct-tutor-2": otherTutorU };
const resolve = async (id) => users[id] ?? null;

test("relay: a signed request from the classroom goes through the SAME service and rules as an HTTP send", async () => {
  const w = await world();
  const send = (userId, lessonId, text = "hello", over) => handlers.relayedSend(relay(w, { lessonId, userId, text }, over), w.deps, resolve);
  const ok = await send("acct-tutor", w.now.id);
  assert.equal(ok.status, 200);
  const message = (await body(ok)).message;
  assert.deepEqual(Object.keys(message).sort(), ["createdAt", "id", "name", "text"]);
  assert.equal(message.name, "Tutor One");
  assert.equal((await w.repo.getMessage(message.id)).lessonId, w.now.id, "stored: the classroom chat is no longer unsaved");
  assert.equal((await send("acct-student", w.now.id, "reply")).status, 200);

  // The same refusals as HTTP, for the same reasons.
  for (const [userId, lesson, code] of [["acct-tutor", w.tomorrow, "TOO_EARLY"], ["acct-student", w.past, "TOO_LATE"], ["acct-tutor", w.cancelled, "LESSON_CANCELLED"], ["acct-tutor-2", w.now, "NOT_PARTICIPANT"], ["acct-parent", w.now, "NOT_PARTICIPANT"], ["acct-junior", w.now, "JUNIOR_TUTOR_CANNOT_SEND"]]) {
    const response = await send(userId, lesson.id);
    assert.equal(response.status, 403, `${userId} ${code}`);
    assert.equal((await body(response)).code, code);
  }
  assert.equal((await send("acct-nobody", w.now.id)).status, 403, "an unknown account");
  assert.equal((await send("acct-tutor", "no-such-lesson")).status, 404);
  assert.equal((await w.repo.listMessages(w.now.id)).length, 2);
});

test("relay: unsigned, wrongly signed, tampered, stale and malformed requests are refused and nothing is stored", async () => {
  const w = await world();
  const good = { lessonId: w.now.id, userId: "acct-tutor", text: "hello" };
  const run = (request) => handlers.relayedSend(request, w.deps, resolve);
  assert.equal((await run(new Request("http://x/", { method: "POST", body: JSON.stringify(good) }))).status, 401, "no signature");
  assert.equal((await run(relay(w, good, { sig: "AAAA" }))).status, 401, "wrong signature");
  assert.equal((await run(relay(w, { ...good, userId: "acct-student" }, { signedBody: JSON.stringify(good) }))).status, 401, "signed for one body, sent another");
  assert.equal((await run(relay(w, good, { ts: Date.now() - 5 * MIN }))).status, 401, "stale");
  assert.equal((await run(relay(w, good, { ts: Date.now() + 5 * MIN }))).status, 401, "from the future");
  assert.equal((await run(relay(w, "{not json"))).status, 400);
  for (const bad of [{}, { lessonId: 1, userId: "a", text: "t" }, { lessonId: "l", userId: 5, text: "t" }, { lessonId: "l", userId: "a" }]) assert.equal((await run(relay(w, bad))).status, 400, JSON.stringify(bad));
  assert.equal((await handlers.relayedSend(relay(w, good), { chat: { open: false, reason: "closed" }, leads: LEADS }, resolve)).status, 503);
  assert.equal((await w.repo.listMessages(w.now.id)).length, 0);
});

test("relay: roles and records are looked up fresh by account id, never taken from the request (a forged role or lesson in the body changes nothing)", async () => {
  const w = await world();
  const forged = { lessonId: w.tomorrow.id, userId: "acct-student", text: "hi", role: "tutor", senderParty: "tutor", tutorId: "T1", lessonOverride: w.now.id };
  const response = await handlers.relayedSend(relay(w, forged), w.deps, resolve);
  assert.equal(response.status, 403, "judged on the lesson it names, as the person it names");
  assert.equal((await body(response)).code, "TOO_EARLY");
});

test("the join token carries the account (uid) and an old token without one still verifies", () => {
  const exp = Date.now() + 60_000;
  const withUid = verifyClassroomJoinToken(signClassroomJoinToken({ roomId: "room-one", lessonId: "l1", name: "N", role: "tutor", exp, uid: "acct-1" }));
  assert.equal(withUid?.uid, "acct-1");
  assert.equal(verifyClassroomJoinToken(signClassroomJoinToken({ roomId: "room-one", lessonId: "l1", name: "N", role: "tutor", exp }))?.uid, undefined);
  assert.equal(verifyClassroomJoinToken(signClassroomJoinToken({ roomId: "room-one", lessonId: "l1", name: "N", role: "tutor", exp, uid: 5 })), null, "a non-string uid is not a token");
  assert.match(readFileSync(join(import.meta.dirname, "..", "src", "lib", "actions", "classroom.ts"), "utf8"), /uid: user\.id/, "the join action names the signed-in person in the token");
});

// ---- availability and wiring --------------------------------------------------------------------------------------------------------------

test("every place that signs a lesson join token names the signed-in person (uid), or the classroom refuses their chat", () => {
  for (const file of [["app", "(classroom)", "dashboard", "lessons", "[id]", "classroom", "page.tsx"], ["lib", "actions", "classroom.ts"], ["lib", "classroom", "lessonEntry.ts"]]) {
    const source = readFileSync(join(import.meta.dirname, "..", "src", ...file), "utf8");
    assert.match(source, /uid: user\.id/, file.join("/"));
  }
});

test("in production the chat is open when the database is set up, switched off by LESSON_CHAT_ENABLED=false, and in development it is open", () => {
  const prod = { NODE_ENV: "production" };
  const db = { ...prod, SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "k", DATABASE_URL: "postgres://x" };
  assert.deepEqual(runtime.chatAvailability({ NODE_ENV: "development" }), { open: true });
  assert.deepEqual(runtime.chatAvailability({ NODE_ENV: "test" }), { open: true });
  assert.equal(runtime.chatAvailability(prod).open, false, "no database: closed, never in memory in production");
  assert.equal(runtime.chatAvailability({ ...prod, LESSON_CHAT_ENABLED: "true" }).open, false, "still no database");
  assert.equal(runtime.chatAvailability(db).open, true, "database set: open by default");
  assert.equal(runtime.chatAvailability({ ...db, LESSON_CHAT_ENABLED: "false" }).open, false, "the explicit off-switch");
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "dist"].includes(name) || name.startsWith(".next-")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

test("the routes do nothing but call the handlers; no client code reaches the chat's server code; and nothing else sends a chat message", () => {
  const src = join(import.meta.dirname, "..", "src");
  const route = (path) => readFileSync(join(src, "app", "api", ...path.split("/"), "route.ts"), "utf8");
  for (const [path, methods] of [["lessons/[id]/messages", ["GET", "POST"]], ["lessons/[id]/messages/[messageId]", ["DELETE"]], ["lessons/[id]/files/[fileId]", ["GET"]], ["internal/lesson-chat", ["POST"]]]) {
    const text = route(path);
    assert.deepEqual([...text.matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort(), methods.sort(), path);
    assert.match(text, /from "@\/lib\/lessonChat\/handlers"/, path);
    assert.match(text, /dynamic = "force-dynamic"/, path);
    assert.doesNotMatch(text, /sendText|sendFile|\.service\./, `${path} calls the service only through the handlers`);
  }
  assert.match(readFileSync(join(src, "proxy.ts"), "utf8"), /"\/api\/internal\/:path\*"/);
  const importers = [];
  for (const file of walk(src)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(src, file).replaceAll("\\", "/");
    if (/\bcreateLessonChatService\b|\.sendText\(|\.sendFile\(/.test(text) && !rel.startsWith("lib/lessonChat/")) importers.push(rel);
    if (/^\s*["']use client["']/m.test(text.slice(0, 400)) || /^(components|features|hooks)\//.test(rel)) {
      assert.doesNotMatch(text, /@\/lib\/lessonChat\/(runtime|handlers|actor)|@learnthrive\/data\/lessonChat/, `${rel} is browser-side code`);
    }
  }
  assert.deepEqual(importers, [], "only lib/lessonChat builds or calls the service");
});
