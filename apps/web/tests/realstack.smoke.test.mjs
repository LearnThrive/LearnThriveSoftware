import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// supabase-smoke on the REAL local stack: it passes end to end, leaves nothing behind, and never touches an existing account.
// Skipped unless SUPABASE_LOCAL=1:   SUPABASE_LOCAL=1 node --test tests/realstack.smoke.test.mjs

const ENABLED = process.env.SUPABASE_LOCAL === "1";
const WEB = fileURLToPath(new URL("..", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));

describe("supabase-smoke on the real local stack", { skip: ENABLED ? false : "set SUPABASE_LOCAL=1 with the local stack running (npm run supabase:start)" }, () => {
  let stack;
  let sql;
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
  const created = [];
  const env = (email) => ({ PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, SUPABASE_URL: stack.API_URL, SUPABASE_ANON_KEY: stack.PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY: stack.SECRET_KEY, DATABASE_URL: stack.DB_URL, SMOKE_EMAIL: email });
  const smoke = (email) => spawnSync(process.execPath, ["--import", "tsx", "scripts/supabase-smoke.mjs", "--mailbox", stack.MAILPIT_URL], { cwd: WEB, encoding: "utf8", env: env(email), timeout: 120_000 });
  const counts = async () => ({
    users: (await sql`select count(*)::int as n from auth.users`)[0].n,
    resources: (await sql`select count(*)::int as n from public.resources`)[0].n,
    events: (await sql`select count(*)::int as n from public.download_events`)[0].n,
    objects: (await sql`select count(*)::int as n from storage.objects where bucket_id = 'library'`)[0].n,
  });

  before(() => {
    stack = JSON.parse(spawnSync("npx", ["supabase", "status", "--output", "json"], { cwd: REPO, encoding: "utf8", shell: true }).stdout);
    assert.ok(["127.0.0.1", "localhost"].includes(new URL(stack.API_URL).hostname), "local stack only");
    sql = postgres(stack.DB_URL, { max: 1, prepare: false, onnotice: () => {} });
  });
  after(async () => {
    for (const id of created) await fetch(`${stack.API_URL}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: { apikey: stack.SECRET_KEY } });
    await sql?.end({ timeout: 3 });
  });

  test("a full run passes every step, prints no key, and leaves no account, resource, file row, audit row or object behind", async () => {
    const email = `smoke-${run}-a@example.com`;
    const before_ = await counts();
    const r = smoke(email);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /11 of 11 steps passed/);
    assert.equal((r.stdout.match(/^PASS /gm) ?? []).length, 11);
    assert.equal((r.stdout.match(/removed /g) ?? []).length, 4, "four things made, four removed");
    for (const secret of [stack.SECRET_KEY, stack.PUBLISHABLE_KEY, stack.DB_URL, "postgres:postgres"]) assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret), "no secret in the output");
    assert.deepEqual(await counts(), before_, "the database and the bucket are exactly as they were");
    assert.equal((await sql`select count(*)::int as n from auth.users where email = ${email}`)[0].n, 0);
  });

  test("an address that already has an account is never touched: the run stops before doing anything", async () => {
    const email = `smoke-${run}-b@example.com`;
    const made = await (await fetch(`${stack.API_URL}/auth/v1/admin/users`, { method: "POST", headers: { apikey: stack.SECRET_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "correct horse battery staple", email_confirm: true, user_metadata: { display_name: "Real Person", adult_confirmed: true } }) })).json();
    created.push(made.id);
    const before_ = await counts();
    const r = smoke(email);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stderr, /already has an account/);
    assert.ok(!r.stdout.includes("PASS"), "no step ran");
    assert.equal((await sql`select display_name from public.profiles where id = ${made.id}`)[0].display_name, "Real Person", "the existing account is untouched");
    assert.deepEqual(await counts(), before_);
  });
});
