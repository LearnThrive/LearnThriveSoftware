import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment, quiet } from "./_routeHelpers.mjs";

// Phase D: the files a Library resource may be, the watermark, private storage, and the download route's order of checks.

const files = loadTsFrom(import.meta.url, "../src/lib/library/files.ts");
const mark = loadTsFrom(import.meta.url, "../src/lib/library/watermark.ts");
const storage = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const dl = loadTsFrom(import.meta.url, "../src/lib/library/download.ts");
const cfg = loadTsFrom(import.meta.url, "../src/lib/library-config.ts");
const { MemoryAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/memoryAuth.ts");
const { SignInLockout } = loadTsFrom(import.meta.url, "../src/lib/account/lockout.ts");
const session = loadTsFrom(import.meta.url, "../src/lib/account/session.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

async function makePdf(pages = 2) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([595, 842]).drawText(`Page ${i + 1} of a worksheet`, { x: 50, y: 700 });
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const text = (bytes) => Buffer.from(bytes).toString("latin1");
/** Everything drawn on the pages: pdf-lib compresses content streams, so inflate them first. */
async function drawn(bytes) {
  const doc = await PDFDocument.load(bytes);
  let out = "";
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream) out += Buffer.from(decodePDFRawStream(object).decode()).toString("latin1");
  }
  return out;
}
const hex = (s) => Buffer.from(s, "latin1").toString("hex").toUpperCase();

test("library files: only real, plain PDFs of a sensible size", async () => {
  const good = await makePdf();
  const ok = files.inspectLibraryFile("Quadratics Worksheet.PDF", good);
  assert.equal(ok.ok, true);
  assert.equal(ok.bytes, good.length);
  assert.equal(ok.sha256, sha(good));
  assert.ok(!/[ .]PDF$/.test(ok.name) || ok.name.endsWith(".pdf"), "the name is cleaned");

  const bad = (name, bytes) => files.inspectLibraryFile(name, bytes);
  assert.equal(bad("a.docx", good).problem.code, "type");
  assert.equal(bad("a.pdf", new Uint8Array(0)).problem.code, "empty");
  assert.equal(bad("a.pdf", new Uint8Array(files.LIBRARY_FILE_MAX_BYTES + 1)).problem.code, "too-big");
  assert.equal(bad("a.pdf", Buffer.from("MZ not a pdf at all")).problem.code, "content", "an .exe renamed .pdf");
  assert.equal(bad("a.pdf", Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF")).problem.code, "script");
  assert.equal(bad("a.pdf", Buffer.from("%PDF-1.4\n1 0 obj << /Encrypt 2 0 R >> endobj\n%%EOF")).problem.code, "encrypted");
  assert.equal(bad("a.pdf", Buffer.from("%PDF-1.4\n1 0 obj << /Type /Filespec /EmbeddedFile 3 0 R >> endobj\n%%EOF")).problem.code, "embedded");
  assert.equal(files.storagePathFor("quadratics", 2, "q.pdf"), "quadratics/v2/q.pdf");
});

test("watermark: both marks on every page, the metadata too, and a hostile name cannot break it", async () => {
  const original = await makePdf(3);
  const at = new Date("2026-10-20T14:35:59Z");
  const out = await mark.watermarkPdf(original, { holder: "Pat Example", at });
  assert.notDeepEqual(Buffer.from(out), Buffer.from(original));
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 3);
  assert.match(doc.getSubject(), /^Licensed to Pat Example on 2026-10-20 14:35 UTC\./);
  const raw = await drawn(out);
  assert.ok(raw.includes(hex("Licensed to Pat Example")), "the visible text is in the content streams");
  assert.equal(raw.split(hex("Licensed to Pat Example on 2026-10-20 14:35 UTC")).length - 1 >= 6, true, "two marks on each of three pages");

  assert.equal(mark.pdfSafe("Zoë <b>漢字</b>‮\n"), "Zoë <b>??</b>");
  assert.equal(mark.pdfSafe("x".repeat(200)).length, 80);
  assert.equal(mark.pdfSafe(""), "");
  assert.match(mark.stampText({ holder: "", at }), /Licensed to a LearnThrive account on/);
  const hostile = await mark.watermarkPdf(original, { holder: "漢字\u0000‮'); drop--" + "y".repeat(500), at });
  assert.equal((await PDFDocument.load(hostile)).getPageCount(), 3);
  const tiny = await PDFDocument.create();
  tiny.addPage([100, 60]);
  assert.equal((await PDFDocument.load(await mark.watermarkPdf(new Uint8Array(await tiny.save()), { holder: "Long Name ".repeat(8), at }))).getPageCount(), 1, "a narrow page shrinks the text rather than failing");
});

test("storage: path safety, disk containment, and the Supabase signed-URL dance", async (t) => {
  for (const bad of ["", "/abs", "../up", "a/../b", "a\\b", "a\u0000b", "x".repeat(401)]) assert.equal(storage.safeStoragePath(bad), false, JSON.stringify(bad));
  assert.equal(storage.safeStoragePath("quadratics/v1/q.pdf"), true);

  const mem = new storage.MemoryLibraryStorage();
  await mem.put("a/v1/a.pdf", new Uint8Array([1, 2]));
  assert.deepEqual([...(await mem.read("a/v1/a.pdf"))], [1, 2]);
  assert.equal(await mem.read("nope"), null);
  assert.equal(await mem.read("../x"), null);
  await assert.rejects(() => mem.put("../x", new Uint8Array([1])));

  const dir = mkdtempSync(join(tmpdir(), "lt-lib-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const disk = new storage.DiskLibraryStorage(dir);
  await disk.put("s/v1/f.pdf", new Uint8Array([9]));
  assert.deepEqual([...(await disk.read("s/v1/f.pdf"))], [9]);
  assert.equal(await disk.read("s/v1/missing.pdf"), null);
  assert.equal(await disk.read("../outside"), null);
  await assert.rejects(() => disk.put("../outside", new Uint8Array([1])));

  const calls = [];
  const fake = (handler) => async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", headers: init?.headers, body: init?.body });
    const out = handler(String(url));
    return out instanceof Response ? out : new Response(JSON.stringify(out.body ?? {}), { status: out.status ?? 200 });
  };
  const sb = new storage.SupabaseLibraryStorage({ url: "https://p.supabase.co/", serviceRoleKey: "svc-key", fetch: fake((url) => (url.includes("/object/sign/") && !url.includes("token=") ? { body: { signedURL: "/object/sign/library/a/v1/q%20x.pdf?token=t" } } : new Response(new Uint8Array([7, 7])))) });
  assert.deepEqual([...(await sb.read("a/v1/q x.pdf"))], [7, 7]);
  assert.equal(calls[0].url, "https://p.supabase.co/storage/v1/object/sign/library/a/v1/q%20x.pdf");
  assert.equal(JSON.parse(calls[0].body).expiresIn, 60, "a 60 second signed URL");
  assert.equal(calls[0].headers.Authorization, "Bearer svc-key");
  assert.equal(calls[1].url, "https://p.supabase.co/storage/v1/object/sign/library/a/v1/q%20x.pdf?token=t");
  assert.ok(!calls[1].headers, "no key is sent with the signed URL itself");
  await sb.put("a/v1/q x.pdf", new Uint8Array([1]), "application/pdf");
  assert.equal(calls.at(-1).url, "https://p.supabase.co/storage/v1/object/library/a/v1/q%20x.pdf");
  assert.equal(await sb.read("../x"), null);

  const evil = new storage.SupabaseLibraryStorage({ url: "https://p.supabase.co", serviceRoleKey: "k", fetch: fake(() => ({ body: { signedURL: "https://evil.example/steal" } })) });
  assert.equal(await evil.read("a/v1/a.pdf"), null, "a signed URL that points anywhere else is not followed");
  const down = new storage.SupabaseLibraryStorage({ url: "https://p.supabase.co", serviceRoleKey: "k", fetch: async () => { throw new Error("offline"); } });
  assert.equal(await down.read("a/v1/a.pdf"), null);
  const rejected = new storage.SupabaseLibraryStorage({ url: "https://p.supabase.co", serviceRoleKey: "k", fetch: fake(() => ({ status: 500 })) });
  await assert.rejects(() => rejected.put("a/v1/a.pdf", new Uint8Array([1]), "application/pdf"));
  assert.equal(storage.libraryStorage({ NODE_ENV: "production" }), null, "production without settings has no storage");
});

test("the hourly cap is a whole number from 1 to 1000, default 60", () => {
  assert.equal(cfg.downloadsPerHour({}), 60);
  assert.equal(cfg.downloadsPerHour({ LIBRARY_DOWNLOADS_PER_HOUR: "5" }), 5);
  for (const bad of ["0", "-1", "1001", "2.5", "many", ""]) assert.equal(cfg.downloadsPerHour({ LIBRARY_DOWNLOADS_PER_HOUR: bad }), 60, bad);
});

// ---- the route -----------------------------------------------------------------------------------------------

const NOW = new Date("2026-10-20T12:00:00Z");
const HOUR = 3_600_000;

async function world(t, { env = {} } = {}) {
  environment(t, {});
  const lines = quiet(t);
  session.resetSessionCache();
  const store = new InMemoryLibraryStore();
  const auth = new MemoryAccountAuth({ onUserCreated: (u) => store.seedProfile({ id: u.id, displayName: u.displayName }) });
  const rt = { backend: "memory", auth, store, lockout: new SignInLockout(), outbox: auth.outbox, memory: store };
  const bytes = await makePdf();
  const blobs = new storage.MemoryLibraryStorage();

  async function resource(slug, overrides = {}, withFile = true) {
    const r = await store.resources.upsert({
      slug, title: `Title ${slug}`, description: "d", subject: "Maths", level: "GCSE", examBoard: null, topic: "Algebra", resourceType: "worksheet",
      yearGroup: null, tags: [], accessTier: "members", authorship: "LearnThrive Tuition", publishedAt: new Date(NOW.getTime() - HOUR), ...overrides,
    });
    if (withFile) {
      await blobs.put(`${slug}/v1/${slug}.pdf`, bytes, "application/pdf");
      await store.resources.setFiles(r.id, [{ storagePath: `${slug}/v1/${slug}.pdf`, bytes: bytes.length, contentType: "application/pdf", checksumSha256: sha(bytes) }]);
    }
    return r;
  }

  async function person(name = "Pat Example", email = `p${Math.random().toString(36).slice(2)}@example.com`) {
    await auth.signUp({ email, password: "correct horse battery staple", displayName: name, adultConfirmed: true });
    const jar = new Map();
    const cookies = { get: (n) => jar.get(n), set: (n, v) => jar.set(n, v), delete: (n) => jar.delete(n) };
    const link = auth.outbox.findLast((m) => m.to === email);
    const opened = await auth.verifyEmailLink(link.tokenHash, "signup");
    session.setSessionCookies(cookies, opened.tokens, {});
    return { email, jar: cookies, userId: opened.user.id };
  }

  const call = (slug, jar, { origin, accept, query = "", now = NOW, extraEnv = {} } = {}) =>
    dl.handleDownload(
      new Request(`http://localhost:3100/api/library/download/${slug}${query}`, { method: "POST", headers: { ...(origin ? { origin } : {}), ...(accept ? { accept } : {}) } }),
      slug,
      { rt, jar, storage: blobs, now: () => now, env: { ...env, ...extraEnv } },
    );

  return { store, auth, rt, bytes, blobs, resource, person, call, lines };
}

test("download: a free sample is stamped with the holder's name and time, and the audit row is counters only", async (t) => {
  const w = await world(t);
  await w.resource("free-one", { accessTier: "free_sample" });
  const pat = await w.person("Pat Example", "pat@example.com");
  const response = await w.call("free-one", pat.jar);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-disposition"), /^attachment; filename="free-one-v1\.pdf"$/);
  const out = new Uint8Array(await response.arrayBuffer());
  assert.notEqual(sha(out), sha(w.bytes), "never the unstamped original");
  assert.ok((await drawn(out)).includes(hex("Licensed to Pat Example on 2026-10-20 12:00 UTC")));
  const events = w.store.downloadEvents();
  assert.equal(events.length, 1);
  assert.deepEqual(Object.keys(events[0]).sort(), ["at", "clientId", "flags", "resourceId"]);
  const log = w.lines.join("\n");
  assert.ok(!log.includes("Pat") && !log.includes("pat@example.com") && !log.includes("free-one"), "no name, address or title in the log");
});

test("download: members content needs enrolment, an open subscription or a grant", async (t) => {
  const w = await world(t);
  await w.resource("members-one");
  const none = await w.person("None");
  const denied = await w.call("members-one", none.jar);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "no_access");
  assert.equal(w.store.downloadEvents().length, 0, "a refusal records nothing");

  const enrolled = await w.person("Enrolled");
  w.store.seedAssignment(w.store.seedStudent(enrolled.userId), "ACTIVE");
  assert.equal((await w.call("members-one", enrolled.jar)).status, 200);

  const paused = await w.person("Paused");
  w.store.seedAssignment(w.store.seedStudent(paused.userId), "PAUSED");
  assert.equal((await w.call("members-one", paused.jar)).status, 403);

  const subscriber = await w.person("Subscriber");
  w.store.seedEntitlement(subscriber.userId, "subscription", new Date(NOW.getTime() - HOUR), new Date(NOW.getTime() + HOUR));
  assert.equal((await w.call("members-one", subscriber.jar)).status, 200);

  const lapsed = await w.person("Lapsed");
  w.store.seedEntitlement(lapsed.userId, "subscription", new Date(NOW.getTime() - 3 * HOUR), new Date(NOW.getTime() - HOUR));
  assert.equal((await w.call("members-one", lapsed.jar)).status, 403, "an expired subscription");

  const granted = await w.person("Granted");
  w.store.seedEntitlement(granted.userId, "admin_grant", new Date(NOW.getTime() - HOUR), null);
  assert.equal((await w.call("members-one", granted.jar)).status, 200);
});

test("download: drafts and unknown resources are 404, a signed-out caller is 401, a script gets JSON and a form gets a redirect", async (t) => {
  const w = await world(t);
  await w.resource("draft-one", { accessTier: "free_sample", publishedAt: null });
  await w.resource("later-one", { accessTier: "free_sample", publishedAt: new Date(NOW.getTime() + HOUR) });
  await w.resource("nofile-one", { accessTier: "free_sample" }, false);
  await w.resource("free-two", { accessTier: "free_sample" });
  const pat = await w.person();
  for (const slug of ["draft-one", "later-one", "missing-one"]) assert.equal((await w.call(slug, pat.jar)).status, 404, slug);
  assert.equal((await w.call("nofile-one", pat.jar)).status, 404);
  assert.equal((await w.call("Not A Slug!", pat.jar)).status, 404);

  const signedOut = { get: () => undefined, set() {}, delete() {} };
  const out = await w.call("free-two", signedOut);
  assert.equal(out.status, 401);
  assert.equal((await out.json()).code, "signed_out");
  const form = await w.call("free-two", signedOut, { accept: "text/html,application/xhtml+xml" });
  assert.equal(form.status, 303);
  assert.equal(form.headers.get("location"), "/account/sign-in?next=%2Flibrary%2Ffree-two");
  const refused = await w.call("later-one", pat.jar, { accept: "text/html" });
  assert.equal(refused.headers.get("location"), "/library/later-one?download=not_found");
});

test("download: an hourly cap with a retry hint, anomaly flags, and a window that moves", async (t) => {
  const w = await world(t);
  await w.resource("cap-one", { accessTier: "free_sample" });
  const pat = await w.person();
  const env = { LIBRARY_DOWNLOADS_PER_HOUR: "5" };
  const statuses = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await w.call("cap-one", pat.jar, { extraEnv: env })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  const limited = await w.call("cap-one", pat.jar, { extraEnv: env });
  assert.equal(limited.headers.get("retry-after"), "900");
  assert.equal((await limited.json()).code, "rate_limited");
  const events = w.store.downloadEvents();
  assert.equal(events.length, 5, "a refused request is not counted");
  assert.deepEqual(events[0].flags, []);
  assert.deepEqual(events[1].flags, ["repeat_5m"], "the same file again within five minutes");
  assert.deepEqual(events[3].flags, ["near_limit", "repeat_5m"], "80% of the cap used");
  assert.equal((await w.call("cap-one", pat.jar, { extraEnv: env, now: new Date(NOW.getTime() + HOUR + 1000) })).status, 200, "an hour later the allowance is back");
  const other = await w.person("Other");
  assert.equal((await w.call("cap-one", other.jar, { extraEnv: env })).status, 200, "the cap is per account");
});

test("download: bad origin, a minor's account, a changed file and a failing stamp are all refused, and nothing is recorded", async (t) => {
  const w = await world(t);
  await w.resource("safe-one", { accessTier: "free_sample" });
  const pat = await w.person();
  assert.equal((await w.call("safe-one", pat.jar, { origin: "https://evil.example" })).status, 403);

  const minor = await w.person("Minor");
  w.store.seedProfile({ id: minor.userId, displayName: "Minor", adultConfirmed: false });
  const refusedMinor = await w.call("safe-one", minor.jar);
  assert.equal(refusedMinor.status, 403);
  assert.equal((await refusedMinor.json()).code, "adult_required");

  await w.blobs.put("safe-one/v1/safe-one.pdf", new Uint8Array([...w.bytes, 32]), "application/pdf");
  const changed = await w.call("safe-one", pat.jar);
  assert.equal(changed.status, 503, "the stored file is not the one that was imported");

  const garbage = Buffer.from("%PDF-1.4 this is not really a pdf");
  await w.blobs.put("safe-one/v1/safe-one.pdf", garbage, "application/pdf");
  const r = await w.store.resources.getBySlug("safe-one", NOW);
  await w.store.resources.setFiles(r.id, [{ storagePath: "safe-one/v1/safe-one.pdf", bytes: garbage.length, contentType: "application/pdf", checksumSha256: sha(garbage) }]);
  assert.equal((await w.call("safe-one", pat.jar)).status, 503, "if the stamp cannot be made, nothing is sent");

  await w.blobs.objects.delete("safe-one/v1/safe-one.pdf");
  assert.equal((await w.call("safe-one", pat.jar)).status, 503, "missing from storage");
  assert.equal(w.store.downloadEvents().length, 0);

  const closed = await dl.handleDownload(new Request("http://localhost:3100/x", { method: "POST" }), "safe-one", { rt: null, jar: pat.jar, storage: w.blobs, env: {} });
  assert.equal(closed.status, 503);
  const noStorage = await dl.handleDownload(new Request("http://localhost:3100/x", { method: "POST" }), "safe-one", { rt: w.rt, jar: pat.jar, storage: null, env: {} });
  assert.equal(noStorage.status, 503);
});

test("download: a family account is created on first need, and a file can be chosen by id", async (t) => {
  const w = await world(t);
  const r = await w.resource("two-files", { accessTier: "free_sample" });
  const second = new Uint8Array(await (async () => { const d = await PDFDocument.create(); d.addPage([200, 200]); return d.save({ useObjectStreams: false }); })());
  await w.blobs.put("two-files/v1/key.pdf", second, "application/pdf");
  const [, key] = await w.store.resources.setFiles(r.id, [
    { storagePath: "two-files/v1/two-files.pdf", bytes: w.bytes.length, contentType: "application/pdf", checksumSha256: sha(w.bytes) },
    { storagePath: "two-files/v1/key.pdf", bytes: second.length, contentType: "application/pdf", checksumSha256: sha(second) },
  ]);
  const pat = await w.person();
  assert.equal((await w.store.accounts.getAccount(pat.userId)).clientId, null);
  const response = await w.call("two-files", pat.jar, { query: `?file=${key.id}` });
  assert.equal(response.status, 200);
  assert.equal((await PDFDocument.load(new Uint8Array(await response.arrayBuffer()))).getPageCount(), 1, "the second file, one page");
  assert.ok((await w.store.accounts.getAccount(pat.userId)).clientId);
  assert.equal((await w.call("two-files", pat.jar, { query: "?file=not-a-file" })).status, 404);
});
