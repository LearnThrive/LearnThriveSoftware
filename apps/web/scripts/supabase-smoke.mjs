#!/usr/bin/env node
/**
 * One end-to-end smoke test of the real code against a real Supabase project (plan20 section 5), then it cleans up after itself.
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL=... SMOKE_EMAIL=you+smoke@your-domain \
 *     node --import tsx scripts/supabase-smoke.mjs --host <the project's API host> [--mailbox prompt | <mail catcher URL>]
 *
 * It runs the SITE's own code (not a copy): real sign-up, the emailed confirmation link, sign-in, a session, the profile the trigger
 * makes, the family account, an import of one tiny generated PDF into the private bucket, and a download through a real signed URL,
 * stamped with the account's name. Every step prints PASS or FAIL; nothing prints a key, a password or a connection string.
 *
 * What it writes, all named by this run's id and removed afterwards: ONE auth user (SMOKE_EMAIL: an address you control, that must NOT
 * already have an account: an existing account is never touched), its profile and family account (they go with the user), ONE
 * resource row (slug smoke-<id>) with its file row, ONE object in the private `library` bucket, and ONE download audit row. Cleanup
 * deletes exactly those by their ids and paths; it never deletes by a pattern. If a cleanup step fails it says what remains.
 *
 * A project that is not on this machine needs --host (its API host, exactly) and the host typed again at a real terminal before
 * anything is written. The confirmation email for a hosted project arrives in YOUR inbox: use `--mailbox prompt`, open it and paste the
 * link when asked. For the local stack pass the mail catcher's URL (http://127.0.0.1:54324) and it reads the message itself.
 */
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { PDFDocument } from "pdf-lib";
import { SqlLibraryStore, InMemoryLibraryStore } from "@learnthrive/data/library";
import { SupabaseAccountAuth } from "../src/lib/account/supabaseAuth.ts";
import { SignInLockout } from "../src/lib/account/lockout.ts";
import { renewSession, setSessionCookies } from "../src/lib/account/session.ts";
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

for (const name of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "SMOKE_EMAIL"]) if (!env[name]?.trim()) die(`${name} is required in the environment.`);
const apiUrl = env.SUPABASE_URL.trim().replace(/\/+$/, "");
const anonKey = env.SUPABASE_ANON_KEY.trim();
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY.trim();
const databaseUrl = env.DATABASE_URL.trim();
const email = env.SMOKE_EMAIL.trim().toLowerCase();
if (!/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email)) die("SMOKE_EMAIL is not a single email address.");
const mailbox = option(args, "--mailbox") ?? "prompt";

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

const connection = await createExecutor(databaseUrl);
const store = new SqlLibraryStore(connection.executor);
const auth = new SupabaseAccountAuth({ url: apiUrl, anonKey });
const storage = new SupabaseLibraryStorage({ url: apiUrl, serviceRoleKey: serviceKey });
const rt = { backend: "supabase", auth, store, lockout: new SignInLockout(), outbox: null, memory: null };
const jar = (() => {
  const values = new Map();
  return { get: (n) => values.get(n), set: (n, v) => values.set(n, v), delete: (n) => values.delete(n) };
})();
const made = { userId: null, resourceId: null, paths: [] };
const password = randomBytes(24).toString("base64url"); // used for this account only; the account is deleted at the end

async function confirmationLink() {
  if (mailbox !== "prompt") {
    for (let i = 0; i < 40; i += 1) {
      const list = await (await fetch(`${mailbox}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
      const first = list.messages?.[0];
      if (first) return /href="([^"]+)"/.exec((await (await fetch(`${mailbox}/api/v1/message/${first.ID}`)).json()).HTML)?.[1]?.replace(/&amp;/g, "&");
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("no confirmation email arrived in the mail catcher");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pasted = (await rl.question(`\nOpen the confirmation email sent to ${email} and paste the full link here: `)).trim();
  rl.close();
  return pasted;
}

try {
  // 0. Never touch an existing account.
  const existing = await connection.executor.query("select id from public.auth_user_by_email($1)", [email]);
  if (existing.length > 0) {
    console.error("That address already has an account. The smoke test only ever uses a fresh address; nothing was done.");
    process.exitCode = 3;
  } else {
    await step("the project answers the publishable key", async () => {
      const r = await fetch(`${apiUrl}/auth/v1/settings`, { headers: supabaseKeyHeaders(anonKey) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    });
    await step("sign-up through the site's own auth code", async () => {
      const r = await auth.signUp({ email, password, displayName: "Smoke Test", adultConfirmed: true });
      if (!r.ok) throw new Error(r.reason);
    });
    let hash = null;
    await step("the confirmation email links to the site's own page with a token", async () => {
      const link = await confirmationLink();
      const url = new URL(link);
      hash = url.searchParams.get("token_hash");
      if (!/\/account\/confirm$/.test(url.pathname) || url.searchParams.get("type") !== "signup" || !hash) throw new Error("the link is not /account/confirm?token_hash=...&type=signup (check the email template and the Site URL)");
      // The templates build the link from the dashboard's Site URL: on a hosted project it must be the public address, not a local one.
      if (!api.local && (url.protocol !== "https:" || describeTarget(url.origin).local)) throw new Error("the link points at a local or non-https address: set the Site URL in Authentication, URL Configuration");
      return `${url.origin}${url.pathname}`;
    });
    await step("sign-in is refused until the address is confirmed", async () => {
      const r = await auth.signIn(email, password);
      if (r.ok || r.reason !== "email_not_confirmed") throw new Error(`expected email_not_confirmed, got ${r.ok ? "a session" : r.reason}`);
    });
    await step("confirming the link opens a session", async () => {
      const r = await auth.verifyEmailLink(hash, "signup");
      if (!r.ok) throw new Error(r.reason);
      made.userId = r.user.id;
      setSessionCookies(jar, r.tokens);
    });
    await step("the session is valid, and the profile the trigger made has the adult declaration and role CLIENT", async () => {
      const s = await renewSession(jar, rt);
      if (s.status !== "ok") throw new Error("the session is not valid");
      const account = await store.accounts.getAccount(s.user.id);
      if (!account || account.role !== "CLIENT" || !account.adultConfirmed) throw new Error("the profile is missing, not CLIENT, or has no adult declaration");
    });
    await step("a family account is created on demand", async () => {
      const id = await store.accounts.ensureClient(made.userId);
      if (id !== (await store.accounts.ensureClient(made.userId))) throw new Error("not idempotent");
    });
    await step("a sign-in with the password works, and a wrong one is refused", async () => {
      if (!(await auth.signIn(email, password)).ok) throw new Error("the right password was refused");
      if ((await auth.signIn(email, `${password}x`)).ok) throw new Error("a wrong password was accepted");
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
  }
} finally {
  // Cleanup: exactly what this run made, by id and path.
  if (made.userId || made.resourceId || made.paths.length) console.log("\nCleaning up what this run made:");
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
  if (made.userId) {
    await clean("the test account, its profile and its family account", async () => {
      const r = await fetch(`${apiUrl}/auth/v1/admin/users/${made.userId}`, { method: "DELETE", headers: supabaseKeyHeaders(serviceKey) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    });
  }
  await connection.close();
}

const failed = results.filter((r) => !r.ok).length;
if (results.length) console.log(`\n${results.length - failed} of ${results.length} steps passed${failed ? `, ${failed} FAILED` : ""}.`);
if (failed || process.exitCode) process.exit(process.exitCode || 1);
