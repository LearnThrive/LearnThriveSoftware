import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment, quiet } from "./_routeHelpers.mjs";

const own = (clientId, studentId = null) => ({ clientId, studentId });

// Phase F: the LearnThrive AI routes (gates, streaming, uploads, deletion, export, status) and the retention job.

const h = loadTsFrom(import.meta.url, "../src/lib/assistant/handlers.ts");
const cfgLib = loadTsFrom(import.meta.url, "../src/lib/assistant/config.ts");
const rt = loadTsFrom(import.meta.url, "../src/lib/assistant/runtime.ts");
const { handleFile } = loadTsFrom(import.meta.url, "../src/lib/paper/handlers.ts");
const retention = loadTsFrom(import.meta.url, "../src/lib/assistant/retention.ts");
const prompt = loadTsFrom(import.meta.url, "../src/lib/assistant/prompt.ts");
const activityLib = loadTsFrom(import.meta.url, "../src/lib/assistant/activity.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { MemoryAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/memoryAuth.ts");
const { SignInLockout } = loadTsFrom(import.meta.url, "../src/lib/account/lockout.ts");
const session = loadTsFrom(import.meta.url, "../src/lib/account/session.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

const TINY_JPEG = new Uint8Array(readFileSync(new URL("./fixtures/assistant/tiny.jpg", import.meta.url)));
const ENV = { NODE_ENV: "development", ASSISTANT_PROVIDER: "mock" };
const NOW = new Date("2026-10-21T10:30:00Z");

async function world(t, { env = ENV, member = "enrolled" } = {}) {
  environment(t, {});
  const lines = quiet(t);
  session.resetSessionCache();
  const store = new InMemoryLibraryStore();
  const auth = new MemoryAccountAuth({ onUserCreated: (u) => store.seedProfile({ id: u.id, displayName: u.displayName, email: u.email }) });
  const account = { backend: "memory", auth, store, lockout: new SignInLockout(), outbox: auth.outbox, memory: store };
  const config = cfgLib.assistantConfig(env);
  const uploads = new MemoryLibraryStorage();
  const flags = [];
  const assistant = { config, provider: new MockProvider({ delayMs: 0 }), queue: new GenerationQueue(1, 4), uploads, hosted: false, flag: async (f) => void flags.push(f) };

  async function person(kind = member) {
    const email = `p${Math.random().toString(36).slice(2)}@example.com`;
    await auth.signUp({ email, password: "correct horse battery staple", displayName: "Pat", adultConfirmed: true });
    const map = new Map();
    const jar = { get: (n) => map.get(n), set: (n, v) => map.set(n, v), delete: (n) => map.delete(n) };
    const opened = await auth.verifyEmailLink(auth.outbox.findLast((m) => m.to === email).tokenHash, "signup");
    session.setSessionCookies(jar, opened.tokens, {});
    const clientId = await store.accounts.ensureClient(opened.user.id);
    if (kind === "enrolled") store.seedAssignment(store.seedStudent(opened.user.id), "ACTIVE");
    if (kind === "subscription") store.seedEntitlement(opened.user.id, "subscription", new Date(NOW.getTime() - 3600_000), null);
    if (kind === "grant") store.seedEntitlement(opened.user.id, "admin_grant", new Date(NOW.getTime() - 3600_000), null);
    return { jar, userId: opened.user.id, clientId, email };
  }
  const deps = (jar, over = {}) => ({ rt: account, jar, assistant, env, now: () => NOW, ...over });
  const post = (path, body, init = {}) => new Request(`http://localhost:3100${path}`, { method: "POST", headers: { "content-type": "application/json", ...(init.headers ?? {}) }, body: JSON.stringify(body) });
  const chat = async (p, body, over) => {
    const response = await h.handleChat(post("/api/assistant/chat", body), deps(p.jar, over));
    const text = await response.text();
    return { response, events: response.status === 200 ? text.trim().split("\n").map((l) => JSON.parse(l)) : [], text };
  };
  return { store, account, assistant, deps, person, chat, post, lines, flags, uploads, config };
}

test("gates: closed unless the assistant is on, the caller is signed in, an adult, and holds Library access; a cross-site post is refused first", async (t) => {
  const w = await world(t);
  const p = await w.person();
  const body = { text: "hello", adultAck: true };
  assert.equal((await w.chat(p, body)).response.status, 200);

  const signedOut = { get: () => undefined, set() {}, delete() {} };
  assert.equal((await w.chat({ jar: signedOut }, body)).response.status, 401);
  const free = await w.person("none");
  const denied = await w.chat(free, body);
  assert.equal(denied.response.status, 403);
  assert.equal(JSON.parse(denied.text).code, "no_access");
  for (const kind of ["subscription", "grant"]) assert.equal((await w.chat(await w.person(kind), body)).response.status, 200, kind);

  const off = await w.chat(p, body, { env: { ...ENV, ASSISTANT_ENABLED: "false" } });
  assert.equal(off.response.status, 503, "the kill switch");
  assert.equal(JSON.parse(off.text).code, "unavailable");
  const prod = await w.chat(p, body, { env: { NODE_ENV: "production", ASSISTANT_ENABLED: "true", ASSISTANT_PROVIDER: "mock" } });
  assert.equal(prod.response.status, 503, "production without approval and a custom provider");
  assert.equal((await w.chat(p, body, { assistant: null })).response.status, 503);
  assert.equal((await w.chat(p, body, { rt: null })).response.status, 503);

  const evil = await h.handleChat(w.post("/api/assistant/chat", body, { headers: { origin: "https://evil.example" } }), w.deps(p.jar));
  assert.equal(evil.status, 403);
  w.store.seedProfile({ id: p.userId, displayName: "Pat", adultConfirmed: false, email: p.email });
  assert.equal(JSON.parse((await w.chat(p, body)).text).code, "adult_required");
});

test("chat: a new chat needs the adult's confirmation (recorded), a follow-up does not, and the answer streams as events", async (t) => {
  const w = await world(t);
  const p = await w.person();
  const unticked = await w.chat(p, { text: "hello" });
  assert.equal(unticked.response.status, 422);
  assert.equal(JSON.parse(unticked.text).code, "adult_confirmation");
  assert.equal(w.store.consents().length, 0);

  const first = await w.chat(p, { text: "What is 6 x 7?", adultAck: true });
  assert.equal(first.response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  assert.equal(first.response.headers.get("cache-control"), "no-store");
  assert.deepEqual(first.events.map((e) => e.type).filter((x, i, a) => a.indexOf(x) === i), ["session", "activity", "delta", "done"]);
  const consent = w.store.consents();
  assert.equal(consent.length, 1);
  assert.equal(consent[0].kind, "assistant_adult_use");
  assert.equal(consent[0].textSha256.length, 64);
  assert.match(prompt.ADULT_ACKNOWLEDGEMENT, /18 or over/);

  const sessionId = first.events[0].sessionId;
  const second = await w.chat(p, { text: "and x 2?", sessionId });
  assert.equal(second.events.at(-1).type, "done", "no confirmation needed inside a chat");
  assert.equal(w.store.consents().length, 1);
  assert.equal((await w.chat(p, { text: "x", sessionId: "not-a-uuid" })).response.status, 400);
  assert.equal((await h.handleChat(new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: "nope" }), w.deps(p.jar))).status, 400);
  assert.equal((await h.handleChat(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ text: "x".repeat(40_000) }) }), w.deps(p.jar))).status, 413);

  const approved = await world(t, { env: { ...ENV, ASSISTANT_MINORS_APPROVED: "true" } });
  const q = await approved.person();
  assert.equal((await approved.chat(q, { text: "hello" })).response.status, 200, "approved by the safeguarding lead: no adult-only confirmation");
});

test("chat: events carry fixed replies for blocked and safeguarding input, and a rate-limit event with a wait", async (t) => {
  const w = await world(t, { env: { ...ENV, ASSISTANT_PER_MINUTE: "1" } });
  const p = await w.person();
  const sg = await w.chat(p, { text: "I want to die", adultAck: true });
  assert.equal(sg.events.filter((e) => e.type === "delta").map((e) => e.text).join(""), prompt.SAFEGUARDING_REPLY);
  assert.equal(w.flags.length, 1);
  const limited = await w.chat(p, { text: "again", adultAck: true });
  assert.equal(limited.events.at(-1).code, "rate_limited_minute");
  assert.ok(limited.events.at(-1).retryAfterSeconds > 0);
});

function multipart(file, fields = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set("file", file);
  return new Request("http://localhost:3100/api/assistant/files", { method: "POST", body: form });
}

test("uploads: taking a file out of the box removes it, so it stops counting toward the three; only its owner can, and never once it was sent", async (t) => {
  const w = await world(t);
  const p = await w.person();
  const jpeg = () => new File([TINY_JPEG], "work.jpg", { type: "image/jpeg" });
  const first = await (await h.handleUpload(multipart(jpeg()), w.deps(p.jar))).json();
  const ids = [first.fileId];
  for (let i = 0; i < 2; i += 1) ids.push((await (await h.handleUpload(multipart(jpeg(), { sessionId: first.sessionId }), w.deps(p.jar))).json()).fileId);
  assert.equal((await h.handleUpload(multipart(jpeg(), { sessionId: first.sessionId }), w.deps(p.jar))).status, 422, "three are waiting");
  const del = (id, jar, headers = {}) => handleFile(new Request(`http://localhost:3100/api/assistant/files/${id}`, { method: "DELETE", headers }), w.deps(jar), id);

  const other = await w.person();
  assert.equal((await del(ids[0], other.jar)).status, 404, "not another family's");
  assert.equal((await del(ids[0], p.jar, { origin: "https://evil.example" })).status, 403, "not from another site");
  assert.equal(w.uploads.objects.size, 3);
  assert.equal((await del(ids[0], p.jar)).status, 200);
  assert.equal(w.uploads.objects.size, 2, "its stored copy goes too");
  assert.equal((await del(ids[0], p.jar)).status, 404, "once");
  assert.equal((await h.handleUpload(multipart(jpeg(), { sessionId: first.sessionId }), w.deps(p.jar))).status, 200, "there is room again");

  const used = await w.chat(p, { text: "Check this", sessionId: first.sessionId, fileIds: [ids[1]] });
  assert.equal(used.events.at(-1).type, "done");
  assert.equal((await del(ids[1], p.jar)).status, 404, "a file already used in a message stays with it");
});

test("uploads: a photo is cleaned and stored privately, files attach to the chat, three at most, and refusals say why", async (t) => {
  const w = await world(t);
  const p = await w.person();
  const jpeg = () => new File([TINY_JPEG], "work.jpg", { type: "image/jpeg" });
  const first = await h.handleUpload(multipart(jpeg()), w.deps(p.jar));
  assert.equal(first.status, 200);
  const body = await first.json();
  assert.equal(body.kind, "image");
  assert.ok(body.sessionId && body.fileId);
  assert.equal(w.uploads.objects.size, 1);
  const [path] = [...w.uploads.objects.keys()];
  assert.match(path, new RegExp(`^${body.sessionId}/[0-9a-f-]{36}\\.jpg$`));
  assert.equal((await w.store.chat.listFiles(own(p.clientId), body.sessionId)).length, 1);

  for (let i = 0; i < 2; i += 1) assert.equal((await h.handleUpload(multipart(jpeg(), { sessionId: body.sessionId }), w.deps(p.jar))).status, 200);
  const fourth = await h.handleUpload(multipart(jpeg(), { sessionId: body.sessionId }), w.deps(p.jar));
  assert.equal(fourth.status, 422);
  assert.equal((await fourth.json()).code, "too_many_files");

  const bad = await h.handleUpload(multipart(new File(["MZ not an image"], "run.exe")), w.deps(p.jar));
  assert.equal(bad.status, 422);
  const refused = await bad.json();
  assert.equal(refused.code, "refused");
  assert.match(refused.error, /JPEG or PNG photo, or a PDF/);
  assert.equal(w.uploads.objects.size, 3, "a refused file is not stored");
  assert.equal((await h.handleUpload(multipart(null, { sessionId: body.sessionId }), w.deps(p.jar))).status, 400);
  assert.equal((await h.handleUpload(multipart(jpeg(), { sessionId: "00000000-0000-4000-8000-000000000000" }), w.deps(p.jar))).status, 404);
  assert.equal((await h.handleUpload(multipart(jpeg(), { sessionId: "nope" }), w.deps(p.jar))).status, 400);
  const other = await w.person();
  assert.equal((await h.handleUpload(multipart(jpeg(), { sessionId: body.sessionId }), w.deps(other.jar))).status, 404, "not into another family's chat");
  const free = await w.person("none");
  assert.equal((await h.handleUpload(multipart(jpeg()), w.deps(free.jar))).status, 403);
  const evil = new Request("http://localhost:3100/x", { method: "POST", headers: { origin: "https://evil.example" }, body: new FormData() });
  assert.equal((await h.handleUpload(evil, w.deps(p.jar))).status, 403);

  // The chat then uses them, once.
  const used = await w.chat(p, { text: "Check this", sessionId: body.sessionId, fileIds: [body.fileId] });
  assert.equal(used.events.at(-1).type, "done");
  assert.equal(w.assistant.provider.requests.at(-1).at(-1).images.length, 1);

  // A reopened chat knows what each message carried, so the page can show it again; only the family's own chat says so.
  const read = (jar) => h.handleSession(new Request(`http://localhost:3100/api/assistant/sessions/${body.sessionId}`), w.deps(jar), body.sessionId);
  const reopened = await (await read(p.jar)).json();
  const mine = reopened.messages.find((m) => m.role === "user");
  assert.deepEqual(mine.files.map((f) => f.id), [body.fileId]);
  assert.equal(mine.files[0].contentType, "image/jpeg");
  assert.equal(reopened.messages.find((m) => m.role === "assistant").files, undefined);
  assert.equal((await read(other.jar)).status, 404);
});

test("uploads are rate limited per family per hour", async (t) => {
  const w = await world(t);
  const p = await w.person();
  await w.store.chat.incrementUsage(p.clientId, "assistant_upload_hour", new Date("2026-10-21T10:00:00Z"), 30);
  const limited = await h.handleUpload(multipart(new File([TINY_JPEG], "a.jpg")), w.deps(p.jar));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "600");
});

test("rename: the owner renames a chat; other families, personal details, empty and long titles and cross-site requests are refused", async (t) => {
  const w = await world(t);
  const p = await w.person();
  const id = (await w.chat(p, { text: "first question", adultAck: true })).events[0].sessionId;
  const patch = (title, init = {}) => new Request(`http://localhost:3100/api/assistant/sessions/${id}`, { method: "PATCH", headers: { "content-type": "application/json", ...(init.headers ?? {}) }, body: typeof title === "string" ? JSON.stringify({ title }) : JSON.stringify(title) });
  const ok = await h.handleSession(patch("  Fractions   homework "), w.deps(p.jar), id);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { success: true, title: "Fractions homework" });
  const list = await (await h.handleSessions(new Request("http://localhost:3100/api/assistant/sessions"), w.deps(p.jar))).json();
  assert.equal(list.sessions[0].title, "Fractions homework");

  const other = await w.person();
  assert.equal((await h.handleSession(patch("Mine now"), w.deps(other.jar), id)).status, 404, "another family cannot rename it");
  const personal = await h.handleSession(patch("Call me on 07700 900123"), w.deps(p.jar), id);
  assert.equal(personal.status, 422);
  assert.equal((await personal.json()).code, "title_refused");
  for (const bad of ["", "   ", "x".repeat(121), { nope: 1 }]) assert.equal((await h.handleSession(patch(bad), w.deps(p.jar), id)).status, 400, JSON.stringify(bad).slice(0, 20));
  assert.equal((await h.handleSession(patch("Nice", { headers: { origin: "https://evil.example" } }), w.deps(p.jar), id)).status, 403);
  const after = await (await h.handleSessions(new Request("http://localhost:3100/api/assistant/sessions"), w.deps(p.jar))).json();
  assert.equal(after.sessions[0].title, "Fractions homework", "nothing refused changed it");
});

test("sessions: listed, read, deleted at once (one or all), never across families, and exported without storage paths", async (t) => {
  const w = await world(t);
  const p = await w.person();
  const a = (await w.chat(p, { text: "first question", adultAck: true })).events[0].sessionId;
  const b = (await w.chat(p, { text: "second question", adultAck: true })).events[0].sessionId;
  const get = (path, jar, init) => new Request(`http://localhost:3100${path}`, init);
  const list = await (await h.handleSessions(get("/api/assistant/sessions"), w.deps(p.jar))).json();
  assert.deepEqual(list.sessions.map((s) => s.title).sort(), ["first question", "second question"]);
  const one = await (await h.handleSession(get(`/api/assistant/sessions/${a}`), w.deps(p.jar), a)).json();
  assert.deepEqual(one.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(one.messages[0].content, "first question");

  const other = await w.person();
  assert.equal((await h.handleSession(get(`/api/assistant/sessions/${a}`), w.deps(other.jar), a)).status, 404);
  assert.equal((await h.handleSession(get(`/api/assistant/sessions/${a}`, null, { method: "DELETE" }), w.deps(other.jar), a)).status, 404);
  assert.equal((await h.handleSession(get("/x"), w.deps(p.jar), "not-a-uuid")).status, 404);

  const del = await h.handleSession(get(`/api/assistant/sessions/${a}`, null, { method: "DELETE" }), w.deps(p.jar), a);
  assert.equal(del.status, 200);
  assert.equal((await h.handleSession(get(`/api/assistant/sessions/${a}`), w.deps(p.jar), a)).status, 404, "gone at once");
  assert.equal((await h.handleSession(get(`/api/assistant/sessions/${a}`, null, { method: "DELETE" }), w.deps(p.jar), a)).status, 404, "once");
  const evil = get(`/api/assistant/sessions/${b}`, null, { method: "DELETE", headers: { origin: "https://evil.example" } });
  assert.equal((await h.handleSession(evil, w.deps(p.jar), b)).status, 403);

  const exported = await h.handleExport(get("/api/assistant/export"), w.deps(p.jar));
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-disposition"), /attachment; filename="study-buddy-export\.json"/);
  const data = JSON.parse(await exported.text());
  assert.deepEqual(data.sessions.map((s) => s.title), ["second question"], "the deleted chat is not in it");
  assert.ok(!JSON.stringify(data).includes("storage"));

  const all = await (await h.handleDeleteAll(get("/api/assistant/sessions", null, { method: "DELETE" }), w.deps(p.jar))).json();
  assert.deepEqual(all, { success: true, deleted: 1 });
  assert.deepEqual((await (await h.handleSessions(get("/x"), w.deps(p.jar))).json()).sessions, []);
  assert.equal((await h.handleSessions(get("/x"), w.deps(other.jar))).status, 200);
});

test("status: says whether LearnThrive AI is open and why not, without needing a family", async (t) => {
  const w = await world(t);
  const p = await w.person();
  const status = await (await h.handleStatus(new Request("http://localhost/x"), w.deps(p.jar))).json();
  assert.equal(status.open, true);
  assert.equal(status.minorsApproved, false);
  assert.equal(status.limits.files, 3);
  const off = await (await h.handleStatus(new Request("http://localhost/x"), w.deps({ get: () => undefined }, { env: { ...ENV, ASSISTANT_ENABLED: "false" } }))).json();
  assert.deepEqual(off, { open: false, reason: "disabled" });
  const prod = await (await h.handleStatus(new Request("http://localhost/x"), w.deps({ get: () => undefined }, { env: { NODE_ENV: "production" } }))).json();
  assert.deepEqual(prod, { open: false, reason: "disabled" }, "production is off by default");
  const sick = await (await h.handleStatus(new Request("http://localhost/x"), w.deps(p.jar, { assistant: { ...w.assistant, provider: { health: async () => ({ ok: false, detail: "unreachable" }) } } }))).json();
  assert.deepEqual([sick.open, sick.reason], [false, "unreachable"]);
  // There is no model picker and no local helper to report: the page is told whether the assistant is open and that interfaces are on.
  assert.equal(status.interactive, true);
  for (const gone of ["models", "retrieval", "decision"]) assert.equal(gone in status, false, gone);
});

test("the safeguarding email carries a reference, the kind and a short excerpt and nothing that names a family", () => {
  const mail = rt.safeguardingEmail({ reference: "SG-0123456789", kind: "unsafe", excerpt: "I am not <b>safe</b> at home", at: new Date("2026-10-21T10:30:00Z") });
  assert.match(mail.subject, /SG-0123456789/);
  assert.match(mail.text, /unsafe/);
  assert.match(mail.text, /2026-10-21 10:30 UTC/);
  assert.ok(!mail.html.includes("<b>safe</b>"), "the excerpt is escaped");
  assert.ok(mail.html.includes("&lt;b&gt;safe&lt;/b&gt;"));
  assert.equal(rt.assistantClosed({ NODE_ENV: "production" }), "disabled");
  assert.equal(rt.assistantClosed({ ASSISTANT_PROVIDER: "mock" }), null);
  assert.equal(rt.assistantClosed({ ASSISTANT_PROVIDER: "mock" }, false), "no_backend");
  assert.equal(rt.assistantClosed({ ASSISTANT_PROVIDER: "ollama_cloud" }), "no_provider", "Ollama Cloud without a key");
  assert.equal(rt.assistantClosed({ ASSISTANT_PROVIDER: "nim" }), "no_provider", "a retired provider");
});

test("retention: storage first, then rows; a storage failure keeps the rows for the next run", async () => {
  const store = new InMemoryLibraryStore();
  const client = await store.accounts.ensureClient(store.seedProfile({}));
  const storage = new MemoryLibraryStorage();
  const t0 = new Date("2026-10-01T00:00:00Z");
  const s = await store.chat.createSession(own(client), {}, t0);
  await store.chat.appendMessage(own(client), s.id, "user", "old", t0);
  await storage.put(`${s.id}/a.png`, new Uint8Array([1]), "image/png");
  await store.chat.addFile(own(client), s.id, { storagePath: `${s.id}/a.png`, bytes: 1, contentType: "image/png" }, t0);
  const later = new Date("2026-12-01T00:00:00Z");

  const flaky = { read: storage.read.bind(storage), put: storage.put.bind(storage), remove: async () => { throw new Error("storage down"); } };
  const failed = await retention.runRetention({ store, storage: flaky, now: () => later });
  assert.deepEqual(failed, { objectsRemoved: 0, failed: 1, purged: null });
  assert.equal((await store.chat.dueStoragePaths(later)).length, 1, "the row is still there to try again");

  const done = await retention.runRetention({ store, storage, now: () => later });
  assert.deepEqual(done, { objectsRemoved: 1, failed: 0, purged: { sessions: 1, messages: 1, files: 1 }, paperJobs: 0 });
  assert.equal(storage.objects.size, 0);
  assert.deepEqual(await retention.runRetention({ store, storage, now: () => later }), { objectsRemoved: 0, failed: 0, purged: { sessions: 0, messages: 0, files: 0 }, paperJobs: 0 });
});

test("a reopened chat says how a turn ended only when it did not complete, so the panel never calls a stopped or failed turn completed", async (t) => {
  const w = await world(t);
  const p = await w.person();
  const owner = { clientId: p.clientId, studentId: null };
  const session = await w.store.chat.createSession(owner, { title: "Photosynthesis" }, NOW);
  const steps = [{ id: "read-1", kind: "read", state: "done", label: "Read bbc.co.uk" }, { id: "verify-2", kind: "verify", state: "failed", label: "Checking", detail: "x" }];
  await w.store.chat.appendMessage(owner, session.id, "user", "q", NOW);
  await w.store.chat.appendMessage(owner, session.id, "assistant", "completed answer", NOW, { activity: activityLib.serializeActivity(steps, "done") });
  await w.store.chat.appendMessage(owner, session.id, "assistant", "stopped answer", NOW, { activity: activityLib.serializeActivity(steps, "stopped") });
  await w.store.chat.appendMessage(owner, session.id, "assistant", "failed answer", NOW, { activity: activityLib.serializeActivity(steps, "failed") });
  await w.store.chat.appendMessage(owner, session.id, "assistant", "no activity", NOW);
  const body = await (await h.handleSession(new Request(`http://localhost:3100/api/assistant/sessions/${session.id}`), w.deps(p.jar), session.id)).json();
  const by = Object.fromEntries(body.messages.filter((m) => m.role === "assistant").map((m) => [m.content, m]));
  assert.equal(by["completed answer"].activity.length, 2);
  assert.equal(by["completed answer"].activityOutcome, undefined, "a completed turn sends no outcome");
  assert.equal(by["stopped answer"].activityOutcome, "stopped");
  assert.equal(by["failed answer"].activityOutcome, "failed");
  assert.equal(by["no activity"].activity, undefined);
  assert.equal(by["no activity"].activityOutcome, undefined);
});
