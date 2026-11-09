#!/usr/bin/env node
/**
 * One end-to-end smoke test of the real code against a real Supabase project (plan20 section 5), then it cleans up after itself.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL=... \
 *     node --import tsx scripts/supabase-smoke.mjs --host <the project's API host>
 *
 * It runs the SITE's own code (not a copy), the way a real person is set up now that nobody signs up (docs/AUTHENTICATION.md): that public
 * sign-up is refused, a login made through the Auth Admin API, bound to its username and family, sign-in with that username, the
 * temporary password shutting every door but choosing a new one, a one-time reset link, the family account, an import of one tiny
 * generated PDF into the private bucket, and a download through a real signed URL, stamped with the account's name. Every step prints
 * PASS or FAIL; nothing prints a key, a password or a connection string.
 *
 * What it writes, all named by this run's id and removed afterwards: ONE auth user (smoke-<id> on the internal domain: no mailbox is
 * involved and nothing is sent), its profile and family account (they go with the user), ONE resource row (slug smoke-<id>) with its
 * file row, ONE object in the private `library` bucket, and ONE download audit row. Cleanup deletes exactly those by their ids and paths;
 * it never deletes by a pattern. If a cleanup step fails it says what remains.
 *
 * A project that is not on this machine needs --host (its API host, exactly) and the host typed again at a real terminal before
 * anything is written.
 */
import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { SqlLibraryStore, InMemoryLibraryStore } from "@learnthrive/data/library";
import { SupabaseAccountAdmin } from "../src/lib/account/supabaseAdmin.ts";
import { SupabaseAccountAuth } from "../src/lib/account/supabaseAuth.ts";
import { SignInLockout } from "../src/lib/account/lockout.ts";
import { ACCESS_COOKIE, forgetAccessToken, renewSession, setSessionCookies } from "../src/lib/account/session.ts";
import { internalEmailFor } from "../src/lib/account/username.ts";
import { createExecutor } from "../src/lib/db.ts";
import { handleDownload } from "../src/lib/library/download.ts";
import { applyImport, planImport } from "../src/lib/library/import.ts";
import { SupabaseLibraryStorage } from "../src/lib/library/storage.ts";
import { supabaseKeyHeaders } from "../src/lib/supabaseKeys.ts";
import { confirmHosted, describeTarget, option } from "./_target.mjs";

void InMemoryLibraryStore;
const args = process.argv.slice(2);
const env = process.env;
const die = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};

for (const name of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"]) if (!env[name]?.trim()) die(`${name} is required in the environment.`);
const apiUrl = env.SUPABASE_URL.trim().replace(/\/+$/, "");
const anonKey = env.SUPABASE_ANON_KEY.trim();
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY.trim();
const databaseUrl = env.DATABASE_URL.trim();

const api = describeTarget(apiUrl);
const db = describeTarget(databaseUrl);
if (api.local !== db.local) die("SUPABASE_URL and DATABASE_URL must both be local or both be hosted. Nothing was done.", 3);
if (!api.local) {
  // The API and the database must be the SAME project: the project reference is in both the API host and the pooler's user name.
  const ref = api.host.split(".")[0];
  if (!`${db.user}.${db.host}`.includes(ref)) die("DATABASE_URL does not belong to the same project as SUPABASE_URL. Nothing was done.", 3);
  if (option(args, "--host")?.toLowerCase() !== api.host) die(`This writes to ${api.host}, which is not this machine.\nPass --host ${api.host} to say that is what you mean.`, 3);
  await confirmHosted({ url: apiUrl, args, action: "create a test account, a test resource and a test file, and remove them afterwards," });
}

const run = randomBytes(5).toString("hex");
const slug = `smoke-${run}`;
const username = slug;
const address = internalEmailFor(username);
const results = [];
const step = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ""}`);
    return true;
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}  (${String(error?.message ?? error).split(apiUrl).join("<project>").slice(0, 200)})`);
    return false;
  }
};

// A rejection nobody awaits must not end the run before the cleanup below: Node would exit there and then, and whatever this
// run had made would stay. On the hosted project (9 Nov 2026), straight after the role script re-saved the password, the
// pooler refused the narrow role ("Authentication credentials are invalid ... reconnect with fresh credentials"); the step
// that asked reported it, but a second copy of that error escaped from inside the driver as an unhandled rejection, Node
// stopped, and the test login stayed behind. Now it counts as a failure and the run carries on to its cleanup.
process.on("unhandledRejection", (error) => {
  results.push({ name: "an error outside any step", ok: false });
  console.log(`FAIL  an error outside any step  (${String(error?.message ?? error).split(apiUrl).join("<project>").slice(0, 200)})`);
});

const connection = await createExecutor(databaseUrl);
const store = new SqlLibraryStore(connection.executor);
const auth = new SupabaseAccountAuth({ url: apiUrl, anonKey });
const admin = new SupabaseAccountAdmin({ url: apiUrl, serviceKey });
const storage = new SupabaseLibraryStorage({ url: apiUrl, serviceRoleKey: serviceKey });
const rt = { backend: "supabase", auth, admin, store, lockout: new SignInLockout(), outbox: null, memory: null };
const jar = (() => {
  const values = new Map();
  return { get: (n) => values.get(n), set: (n, v) => values.set(n, v), delete: (n) => values.delete(n) };
})();
const made = { userId: null, strayUserId: null, resourceId: null, paths: [] };
const password = randomBytes(24).toString("base64url"); // used for this account only; the account is deleted at the end
const newPassword = randomBytes(24).toString("base64url");

try {
  await step("the project answers the publishable key", async () => {
    const r = await fetch(`${apiUrl}/auth/v1/settings`, { headers: supabaseKeyHeaders(anonKey) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  });
  if (!api.local) {
    await step("public sign-up is refused: nobody can make themselves an account", async () => {
      const r = await fetch(`${apiUrl}/auth/v1/signup`, { method: "POST", headers: { ...supabaseKeyHeaders(anonKey), "Content-Type": "application/json" }, body: JSON.stringify({ email: `refused-${run}@example.com`, password }) });
      if (r.ok) {
        const body = await r.json();
        made.strayUserId = body.user?.id ?? body.id ?? null;
        throw new Error("sign-up is open: turn it off in the dashboard (Authentication, Sign In / Providers)");
      }
    });
  }
  await step("the Auth Admin API makes a confirmed login on the internal address", async () => {
    const r = await admin.createUser({ email: address, password, displayName: "Smoke Test", adultConfirmed: true });
    if (!r.ok) throw new Error(r.reason);
    made.userId = r.id;
  });
  await step("the login is bound to its username and a new family, through the narrow server role", async () => {
    const result = await store.accounts.provision({ profileId: made.userId, username, linkedEmail: `${username}@example.com`, displayName: "Smoke Test", role: "CLIENT", actor: null });
    if (result !== "ok") throw new Error(result);
    const account = await store.accounts.findByUsername(username);
    if (!account || account.role !== "CLIENT" || !account.adultConfirmed || !account.clientId || !account.mustChangePassword) throw new Error("the account is not what was asked for");
    if ((await store.accounts.getEmail(made.userId)) !== `${username}@example.com`) throw new Error("the address to write to is not the linked one");
  });
  await step("sign-in with the username works, and a wrong password is refused", async () => {
    if ((await auth.signIn(address, `${password}x`)).ok) throw new Error("a wrong password was accepted");
    const r = await auth.signIn(address, password);
    if (!r.ok) throw new Error(r.reason);
    setSessionCookies(jar, r.tokens);
  });
  await step("a temporary password shuts every door but choosing a new one", async () => {
    const s = await renewSession(jar, rt);
    if (s.status !== "password_change") throw new Error(`expected password_change, got ${s.status}`);
  });
  await step("choosing a new password opens the session", async () => {
    const access = jar.get(ACCESS_COOKIE);
    const r = await auth.updatePassword(access, newPassword);
    if (!r.ok) throw new Error(r.reason);
    await store.accounts.setMustChangePassword(made.userId, false);
    forgetAccessToken(access);
    const s = await renewSession(jar, rt);
    if (s.status !== "ok") throw new Error(`expected ok, got ${s.status}`);
  });
  await step("a reset link is made without sending anything, works once, and opens a session", async () => {
    const link = await admin.recoveryLink(address);
    if (!link) throw new Error("no link came back");
    const opened = await auth.verifyEmailLink(link.tokenHash, "recovery");
    if (!opened.ok) throw new Error(opened.reason);
    if ((await auth.verifyEmailLink(link.tokenHash, "recovery")).ok) throw new Error("the link worked twice");
    setSessionCookies(jar, opened.tokens);
  });
  await step("import one PDF into the private bucket (the import tool's own code)", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]).drawText("LearnThrive smoke test", { x: 30, y: 150 });
    const pdf = new Uint8Array(await doc.save());
    const metadata = JSON.stringify({ resources: [{ file: "smoke.pdf", title: `Smoke test ${run}`, slug, description: "A test resource, removed after the test.", subject: "Maths", level: "GCSE", topic: "Algebra", type: "worksheet", tags: ["smoke"], accessTier: "free_sample", authorship: "LearnThrive Tuition", publishedAt: "2026-01-01" }] });
    const plan = await planImport({ readMetadata: () => metadata, readFile: (name) => (name === "smoke.pdf" ? pdf : null) }, store.resources);
    if (plan.problems.length) throw new Error(plan.problems.join("; "));
    made.paths = plan.items.flatMap((i) => i.files.map((f) => f.storagePath));
    const summary = await applyImport(plan, { resources: store.resources, storage });
    made.resourceId = (await store.resources.findBySlug(slug))?.id ?? null;
    if (summary.created !== 1 || summary.uploaded !== 1 || !made.resourceId) throw new Error("the import did not create one resource and upload one file");
  });
  await step("a download through a real signed URL is a PDF stamped with the account's name", async () => {
    const response = await handleDownload(new Request(`http://localhost:3100/api/library/download/${slug}`, { method: "POST", headers: { origin: "http://localhost:3100" } }), slug, { rt, jar, storage, env: {} });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") throw new Error("not a PDF");
    if (!/^Licensed to Smoke Test on /.test((await PDFDocument.load(bytes)).getSubject() ?? "")) throw new Error("the holder's stamp is missing");
  });
  await step("the file cannot be fetched without a signature (no public URL)", async () => {
    const r = await fetch(`${apiUrl}/storage/v1/object/public/library/${made.paths[0]}`);
    if (r.status === 200) throw new Error("the object is publicly readable");
  });
} finally {
  // Cleanup: exactly what this run made, by id and path.
  if (made.userId || made.strayUserId || made.resourceId || made.paths.length) console.log("\nCleaning up what this run made:");
  const clean = async (name, fn) => {
    try {
      await fn();
      console.log(`  removed  ${name}`);
    } catch (error) {
      results.push({ name: `cleanup: ${name}`, ok: false });
      console.log(`  FAILED   ${name}  (${String(error?.message ?? error).slice(0, 160)}) - REMOVE IT BY HAND`);
    }
  };
  if (made.resourceId) {
    await clean("the download audit row", () => connection.executor.query("delete from public.download_events where resource_id = $1", [made.resourceId]));
    await clean("the test resource and its file row", () => connection.executor.query("delete from public.resources where id = $1", [made.resourceId]));
  }
  for (const path of made.paths) await clean("the test file in the private bucket", () => storage.remove(path));
  for (const id of [made.userId, made.strayUserId].filter(Boolean)) {
    await clean("the test account, its profile and its family account", async () => {
      const r = await fetch(`${apiUrl}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: supabaseKeyHeaders(serviceKey) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    });
  }
  await connection.close();
}

const failed = results.filter((r) => !r.ok).length;
if (results.length) console.log(`\n${results.length - failed} of ${results.length} steps passed${failed ? `, ${failed} FAILED` : ""}.`);
if (failed || process.exitCode) process.exit(process.exitCode || 1);
