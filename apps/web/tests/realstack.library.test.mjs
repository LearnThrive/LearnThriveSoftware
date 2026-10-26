import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment } from "./_routeHelpers.mjs";

// The Library and LearnThrive AI server paths against the REAL local Supabase stack (plan20): the import tool run as a real child
// process (dry run, apply, re-apply, a new version, with BOTH key formats and through the pooler), the signed-in download route
// with a real signed URL read from real Storage, the entitlement sync, and the retention job removing rows and storage objects.
// Skipped unless SUPABASE_LOCAL=1 with the stack running:   SUPABASE_LOCAL=1 node --test tests/realstack.library.test.mjs

const ENABLED = process.env.SUPABASE_LOCAL === "1";
const WEB = fileURLToPath(new URL("..", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));

describe("the Library on the real local stack", { skip: ENABLED ? false : "set SUPABASE_LOCAL=1 with the local stack running (npm run supabase:start)" }, () => {
  const h = loadTsFrom(import.meta.url, "../src/lib/library/download.ts");
  const session = loadTsFrom(import.meta.url, "../src/lib/account/session.ts");
  const { SupabaseAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/supabaseAuth.ts");
  const { SignInLockout } = loadTsFrom(import.meta.url, "../src/lib/account/lockout.ts");
  const { createExecutor } = loadTsFrom(import.meta.url, "../src/lib/db.ts");
  const { SupabaseLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
  const { runRetention } = loadTsFrom(import.meta.url, "../src/lib/assistant/retention.ts");
  const { SqlLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/sql.ts");

  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
  const slug = (name) => `rl-${run}-${name}`;
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const FIXTURES = join(WEB, "tests", "fixtures", "documents");
  let stack;
  let sql; // direct SQL for checks, as the stack's own postgres role
  let rt;
  let close;
  let libraryStorage;
  let chatStorage;
  const dirs = [];
  const created = [];
  const poolerUrl = () => stack.DB_URL.replace("postgres:postgres@", "postgres.pooler-dev:postgres@").replace(":54322", ":54329");
  const admin = (path, init = {}) => fetch(`${stack.API_URL}/auth/v1/admin${path}`, { ...init, headers: { apikey: stack.SECRET_KEY, "Content-Type": "application/json" } });
  const one = async (text, params = []) => (await sql.query(text, params))[0];

  before(async () => {
    const status = spawnSync("npx", ["supabase", "status", "--output", "json"], { cwd: REPO, encoding: "utf8", shell: true });
    stack = JSON.parse(status.stdout);
    for (const url of [stack.API_URL, stack.DB_URL]) assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "local stack only");
    const db = await createExecutor(stack.DB_URL);
    sql = { query: (text, params) => db.executor.query(text, params) };
    close = db.close;
    rt = { backend: "supabase", auth: new SupabaseAccountAuth({ url: stack.API_URL, anonKey: stack.PUBLISHABLE_KEY }), store: new SqlLibraryStore(db.executor), lockout: new SignInLockout(), outbox: null, memory: null };
    libraryStorage = new SupabaseLibraryStorage({ url: stack.API_URL, serviceRoleKey: stack.SECRET_KEY });
    chatStorage = new SupabaseLibraryStorage({ url: stack.API_URL, serviceRoleKey: stack.SECRET_KEY, bucket: "chat-uploads" });
  });

  after(async () => {
    await sql.query("delete from public.resources where slug like $1", [`rl-${run}-%`]);
    for (const id of created) await admin(`/users/${id}`, { method: "DELETE" });
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    await close?.();
  });

  // ------------------------------------------------------------------------------------------------------- the import tool

  /** Runs the real script as a child process, as an operator would; returns its output and status. Keys only via the environment. */
  function importer(dir, { apply = false, key = stack.SECRET_KEY, url = poolerUrl() } = {}) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/library-import.mjs", "--dir", dir, ...(apply ? ["--apply"] : [])], {
      cwd: WEB,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: url, SUPABASE_URL: stack.API_URL, SUPABASE_SERVICE_ROLE_KEY: key },
    });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  }
  function folder(entries) {
    const dir = mkdtempSync(join(tmpdir(), "lt-import-"));
    dirs.push(dir);
    const resources = entries.map((e) => ({ file: e.file, title: e.title, description: "Real-stack import test.", subject: "Maths", level: "GCSE", topic: "Algebra", type: "worksheet", tags: ["rs"], accessTier: e.tier ?? "members", authorship: "LearnThrive Tuition", publishedAt: "2026-01-01", slug: e.slug }));
    writeFileSync(join(dir, "library.json"), JSON.stringify({ resources }));
    for (const e of entries) {
      if (e.bytes) writeFileSync(join(dir, e.file), e.bytes);
      else copyFileSync(join(FIXTURES, e.source), join(dir, e.file));
    }
    return dir;
  }
  const objectNames = async (prefix) => {
    const r = await fetch(`${stack.API_URL}/storage/v1/object/list/library`, { method: "POST", headers: { apikey: stack.SECRET_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ prefix, limit: 100 }) });
    return (await r.json()).map((o) => o.name);
  };

  test("a dry run checks everything and writes nothing: no rows, no objects, and no key in its output", async () => {
    const dir = folder([
      { file: "worksheet.pdf", title: "Worksheet", slug: slug("a"), source: "text-native.pdf" },
      { file: "paper.pdf", title: "Paper", slug: slug("b"), source: "gcse-multipage.pdf", tier: "free_sample" },
    ]);
    const r = importer(dir);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /Dry run: 2 resource\(s\) checked, nothing written/);
    assert.match(r.out, /create\s+rl-.*-a\s+v1/);
    assert.equal((await sql.query("select count(*)::int as n from public.resources where slug like $1", [`rl-${run}-%`]))[0].n, 0);
    assert.deepEqual(await objectNames(`rl-${run}-a`), []);
    assert.ok(!r.out.includes(stack.SECRET_KEY) && !r.out.includes("postgres:postgres"), "no secret in the output");
    // A problem anywhere stops the whole run: nothing half imported.
    const broken = folder([{ file: "ok.pdf", title: "Ok", slug: slug("c"), source: "text-native.pdf" }, { file: "bad.pdf", title: "Bad", slug: slug("d"), bytes: Buffer.from("MZ not a pdf") }]);
    const bad = importer(broken, { apply: true });
    assert.equal(bad.status, 1, bad.out);
    assert.match(bad.out, /does not look like a PDF/);
    assert.equal((await sql.query("select count(*)::int as n from public.resources where slug in ($1,$2)", [slug("c"), slug("d")]))[0].n, 0, "nothing imported");
  });

  test("apply uploads to the private bucket and writes the rows, through the pooler, with the new sb_secret_ key; re-applying changes nothing; a changed file is version 2", async () => {
    const dir = folder([
      { file: "worksheet.pdf", title: "Worksheet", slug: slug("a"), source: "text-native.pdf" },
      { file: "paper.pdf", title: "Paper", slug: slug("b"), source: "gcse-multipage.pdf", tier: "free_sample" },
    ]);
    const first = importer(dir, { apply: true });
    assert.equal(first.status, 0, first.out);
    assert.match(first.out, /Done: 2 created, 0 updated, 0 new version\(s\), 2 file\(s\) uploaded/);
    assert.ok(!first.out.includes(stack.SECRET_KEY), "the key is never printed");
    const rows = await sql.query("select r.slug, r.version, r.access_tier, f.storage_path, f.bytes, f.content_type, f.checksum_sha256 from public.resources r join public.resource_files f on f.resource_id = r.id where r.slug like $1 order by r.slug", [`rl-${run}-%`]);
    assert.equal(rows.length, 2);
    const a = rows[0];
    assert.equal(a.storage_path, `${slug("a")}/v1/worksheet.pdf`);
    assert.equal(a.content_type, "application/pdf");
    // The stored object is exactly the file imported: its checksum, its size, and it is only reachable by the server.
    const original = readFileSync(join(FIXTURES, "text-native.pdf"));
    assert.equal(Number(a.bytes), original.length);
    assert.equal(a.checksum_sha256, sha(original));
    assert.deepEqual(await objectNames(`${slug("a")}/v1`), ["worksheet.pdf"]);
    assert.equal(sha(await libraryStorage.read(a.storage_path)), a.checksum_sha256, "read back through a real signed URL");
    assert.equal((await fetch(`${stack.API_URL}/storage/v1/object/public/library/${a.storage_path}`)).status, 400, "no public URL");
    // Re-applying the same folder changes nothing.
    const again = importer(dir, { apply: true });
    assert.equal(again.status, 0, again.out);
    // Unchanged files: the rows are refreshed in place (reported as "updated"), but nothing is created, versioned or uploaded.
    assert.match(again.out, /Done: 0 created, 2 updated, 0 new version\(s\), 0 file\(s\) uploaded/);
    assert.equal((await sql.query("select count(*)::int as n from public.resources where slug like $1", [`rl-${run}-%`]))[0].n, 2, "no duplicate rows");
    // A changed file under the same slug is version 2, with its own object; version 1 is kept.
    const changed = await PDFDocument.create();
    changed.addPage([300, 300]).drawText("changed", { x: 20, y: 200 });
    const next = folder([{ file: "worksheet.pdf", title: "Worksheet", slug: slug("a"), bytes: await changed.save() }]);
    const second = importer(next, { apply: true, key: stack.SERVICE_ROLE_KEY }); // the legacy JWT service key this time
    assert.equal(second.status, 0, second.out);
    assert.match(second.out, /1 new version\(s\), 1 file\(s\) uploaded/);
    assert.equal((await one("select version from public.resources where slug = $1", [slug("a")])).version, 2);
    assert.deepEqual((await objectNames(`${slug("a")}/v2`)), ["worksheet.pdf"]);
    assert.deepEqual((await objectNames(`${slug("a")}/v1`)), ["worksheet.pdf"], "version 1 is still stored");
  });

  // ------------------------------------------------------------------------------------- access, download and the sync

  async function person(name) {
    const email = `rl-${run}-${name.toLowerCase().replace(/\W/g, "")}@example.com`;
    const made = await (await admin("/users", { method: "POST", body: JSON.stringify({ email, password: "correct horse battery staple", email_confirm: true, user_metadata: { display_name: name, adult_confirmed: true } }) })).json();
    created.push(made.id);
    const signed = await rt.auth.signIn(email, "correct horse battery staple");
    assert.equal(signed.ok, true);
    const values = new Map();
    const jar = { get: (n) => values.get(n), set: (n, v) => values.set(n, v), delete: (n) => values.delete(n) };
    session.setSessionCookies(jar, signed.tokens);
    return { id: made.id, email, jar, clientId: await rt.store.accounts.ensureClient(made.id) };
  }
  const download = (jar, name, { origin = "http://localhost:3100" } = {}) =>
    h.handleDownload(new Request(`http://localhost:3100/api/library/download/${name}`, { method: "POST", headers: { origin } }), name, { rt, jar, storage: libraryStorage, env: {} });

  test("the download route: a free sample for any adult, members-only needs an entitlement that the real sync derives from a subscription, and every file is stamped", async (t) => {
    environment(t, {});
    session.resetSessionCache();
    const dir = folder([
      { file: "members.pdf", title: "Members", slug: slug("m"), source: "text-native.pdf" },
      { file: "free.pdf", title: "Free", slug: slug("f"), source: "gcse-multipage.pdf", tier: "free_sample" },
    ]);
    assert.equal(importer(dir, { apply: true }).status, 0);
    const payer = await person("Payer Example");
    const other = await person("Other Example");

    // The free sample, for any signed-in adult, stamped with the holder's name and the time (read from real Storage).
    const free = await download(other.jar, slug("f"));
    assert.equal(free.status, 200, await free.clone().text());
    assert.equal(free.headers.get("content-type"), "application/pdf");
    assert.match(free.headers.get("content-disposition"), new RegExp(`${slug("f")}-v1\\.pdf`));
    const stamped = new Uint8Array(await free.arrayBuffer());
    assert.equal(Buffer.from(stamped.subarray(0, 5)).toString(), "%PDF-");
    assert.notEqual(sha(stamped), sha(readFileSync(join(FIXTURES, "gcse-multipage.pdf"))), "the holder's mark was added");
    assert.match((await PDFDocument.load(stamped)).getSubject(), /^Licensed to Other Example on /);

    // Members-only: refused without an entitlement, signed out, from another origin.
    assert.equal((await download(other.jar, slug("m"))).status, 403);
    assert.equal((await download({ get: () => undefined, set() {}, delete() {} }, slug("m"))).status, 401);
    assert.equal((await download(payer.jar, slug("m"), { origin: "https://evil.example" })).status, 403);

    // A subscription mirrored from Stripe (as the webhook does), synced by the real SQL, opens it; ending it closes it again.
    const future = new Date(Date.now() + 30 * 86_400_000);
    const record = await rt.store.billing.upsertSubscription(payer.clientId, { stripeSubscriptionId: `sub_${run}`, stripePriceId: "price_x", status: "active", planInterval: "month", currentPeriodEnd: future, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null });
    const window = await rt.store.billing.syncEntitlement(record, new Date());
    assert.ok(window, "an entitlement window was derived");
    assert.equal((await sql.query("select count(*)::int as n from public.entitlements where client_id = $1 and source = 'subscription'", [payer.clientId]))[0].n, 1);
    const ok = await download(payer.jar, slug("m"));
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.match((await PDFDocument.load(new Uint8Array(await ok.arrayBuffer()))).getSubject(), /^Licensed to Payer Example on /);
    // The audit row is counters only: no name, address or file in it.
    const audit = await sql.query("select * from public.download_events where client_id = $1", [payer.clientId]);
    assert.equal(audit.length, 1);
    assert.ok(!JSON.stringify(audit).includes("Payer") && !JSON.stringify(audit).includes("@example.com"));
    const ended = await rt.store.billing.upsertSubscription(payer.clientId, { stripeSubscriptionId: `sub_${run}`, stripePriceId: "price_x", status: "canceled", planInterval: "month", currentPeriodEnd: new Date(Date.now() - 86_400_000), cancelAtPeriodEnd: false, canceledAt: new Date(), endedAt: new Date() });
    await rt.store.billing.syncEntitlement(ended, new Date());
    assert.equal((await download(payer.jar, slug("m"))).status, 403, "access ends with the subscription");

    // The stored object is not the one that was imported: never sent (the checksum no longer matches).
    await rt.store.billing.upsertSubscription(payer.clientId, { stripeSubscriptionId: `sub_${run}`, stripePriceId: "price_x", status: "active", planInterval: "month", currentPeriodEnd: future, cancelAtPeriodEnd: false, canceledAt: null, endedAt: null }).then((r) => rt.store.billing.syncEntitlement(r, new Date()));
    const path = (await one("select f.storage_path from public.resource_files f join public.resources r on r.id = f.resource_id where r.slug = $1", [slug("m")])).storage_path;
    await libraryStorage.put(path, new Uint8Array(Buffer.from("%PDF-1.4 tampered")), "application/pdf");
    assert.equal((await download(payer.jar, slug("m"))).status, 503, "a tampered object is never served");
  });

  // ------------------------------------------------------------------------------------------------- the retention job

  test("the retention job removes the storage objects FIRST and then the rows; if storage fails nothing is purged", async () => {
    const owner = await person("Retention Example");
    const when = new Date();
    const chat = rt.store.chat;
    const sessionRow = await chat.createSession(owner.clientId, {}, when);
    const path = `${sessionRow.id}/${run}.png`;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    await chatStorage.put(path, png, "image/png");
    const file = await chat.addFile(owner.clientId, sessionRow.id, { storagePath: path, bytes: png.length, contentType: "image/png" }, when);
    assert.ok(file.id);
    assert.deepEqual([...(await chatStorage.read(path))], [...png], "the object is stored");
    const later = new Date(when.getTime() + 8 * 86_400_000); // uploads are kept 7 days
    // Storage failing: nothing is purged, the row stays for the next run.
    const failing = { read: () => null, put: async () => {}, remove: async () => { throw new Error("storage down"); } };
    const blocked = await runRetention({ store: rt.store, storage: failing, now: () => later });
    assert.equal(blocked.purged, null);
    assert.ok(blocked.failed >= 1);
    assert.equal((await sql.query("select count(*)::int as n from public.chat_files where id = $1", [file.id]))[0].n, 1, "the row is kept while its file lingers");
    assert.ok(await chatStorage.read(path), "and so is the object");
    // Storage working: the object goes, then the row.
    const report = await runRetention({ store: rt.store, storage: chatStorage, now: () => later });
    assert.equal(report.failed, 0);
    assert.ok(report.objectsRemoved >= 1);
    assert.ok(report.purged);
    assert.equal(await chatStorage.read(path), null, "the object is gone from Storage");
    assert.equal((await sql.query("select count(*)::int as n from public.chat_files where id = $1", [file.id]))[0].n, 0, "the row is gone");
    // The chat text stays (30 days) until its own deadline.
    assert.equal((await sql.query("select count(*)::int as n from public.chat_sessions where id = $1", [sessionRow.id]))[0].n, 1);
    const much = new Date(when.getTime() + 31 * 86_400_000);
    await runRetention({ store: rt.store, storage: chatStorage, now: () => much });
    assert.equal((await sql.query("select count(*)::int as n from public.chat_sessions where id = $1", [sessionRow.id]))[0].n, 0, "the chat itself goes after 30 days");
  });
});
