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
  const env = () => ({ PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, SUPABASE_URL: stack.API_URL, SUPABASE_ANON_KEY: stack.PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY: stack.SECRET_KEY, DATABASE_URL: stack.DB_URL });
  const smoke = () => spawnSync(process.execPath, ["--import", "tsx", "scripts/supabase-smoke.mjs"], { cwd: WEB, encoding: "utf8", env: env(), timeout: 120_000 });
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
    await sql?.end({ timeout: 3 });
  });

  test("a full run passes every step, prints no key, and leaves no account, resource, file row, audit row or object behind", async () => {
    const before_ = await counts();
    const r = smoke();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /10 of 10 steps passed/);
    assert.equal((r.stdout.match(/^PASS /gm) ?? []).length, 10);
    assert.equal((r.stdout.match(/removed /g) ?? []).length, 4, "four things made, four removed");
    for (const secret of [stack.SECRET_KEY, stack.PUBLISHABLE_KEY, stack.DB_URL, "postgres:postgres"]) assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret), "no secret in the output");
    assert.deepEqual(await counts(), before_, "the database and the bucket are exactly as they were");
  });
});
