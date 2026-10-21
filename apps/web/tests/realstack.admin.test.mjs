import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// The first-administrator bootstrap on the REAL local stack (plan20 section 4): promote-admin run as an operator would, through the
// narrow learnthrive_server role the site uses. Skipped unless SUPABASE_LOCAL=1:   SUPABASE_LOCAL=1 node --test tests/realstack.admin.test.mjs

const ENABLED = process.env.SUPABASE_LOCAL === "1";
const WEB = fileURLToPath(new URL("..", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));

describe("promote-admin on the real local stack", { skip: ENABLED ? false : "set SUPABASE_LOCAL=1 with the local stack running (npm run supabase:start)" }, () => {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
  let stack;
  let url; // the narrow server role, direct
  let sql;
  const created = [];
  const api = (path, init = {}) => fetch(`${stack.API_URL}${path}`, { ...init, headers: { apikey: stack.SECRET_KEY, "Content-Type": "application/json", ...init.headers } });

  before(async () => {
    stack = JSON.parse(spawnSync("npx", ["supabase", "status", "--output", "json"], { cwd: REPO, encoding: "utf8", shell: true }).stdout);
    assert.ok(["127.0.0.1", "localhost"].includes(new URL(stack.DB_URL).hostname), "local stack only");
    const password = randomBytes(32).toString("base64url");
    const made = spawnSync(process.execPath, ["scripts/create-server-role.mjs"], { cwd: WEB, encoding: "utf8", env: { ...process.env, DATABASE_ADMIN_URL: stack.DB_URL, LEARNTHRIVE_SERVER_PASSWORD: password } });
    assert.equal(made.status, 0, made.stdout + made.stderr);
    url = `postgresql://learnthrive_server:${password}@127.0.0.1:54322/postgres`;
    sql = postgres(stack.DB_URL, { max: 1, prepare: false, onnotice: () => {} }); // the stack's postgres role, for checks only
  });
  after(async () => {
    for (const id of created) await api(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
    await sql?.end({ timeout: 3 });
  });

  const promote = (email, { host = "127.0.0.1", typed = email } = {}) =>
    spawnSync(process.execPath, ["scripts/promote-admin.mjs", "--email", email, "--host", host], { cwd: WEB, encoding: "utf8", input: `${typed}\n`, env: { PATH: process.env.PATH, DATABASE_URL: url }, timeout: 30_000 });
  const roleOf = async (id) => (await sql`select role from public.profiles where id = ${id}`)[0].role;
  async function account(name, { confirmed = true } = {}) {
    const email = `pa-${run}-${name}@example.com`;
    const body = { email, password: "correct horse battery staple", ...(confirmed ? { email_confirm: true } : {}), user_metadata: { display_name: name, adult_confirmed: true } };
    const made = await (await api("/auth/v1/admin/users", { method: "POST", body: JSON.stringify(body) })).json();
    created.push(made.id);
    return { id: made.id, email };
  }

  test("an unknown address, an unconfirmed account and a wrong typed email change nothing", async () => {
    const ghost = promote(`pa-${run}-ghost@example.com`);
    assert.equal(ghost.status, 1);
    assert.match(ghost.stderr, /no account with that address/);
    const pending = await account("pending", { confirmed: false });
    const early = promote(pending.email);
    assert.equal(early.status, 1);
    assert.match(early.stderr, /has not confirmed/);
    assert.equal(await roleOf(pending.id), "CLIENT");
    const person = await account("careful");
    const mismatch = promote(person.email, { typed: `pa-${run}-someone-else@example.com` });
    assert.equal(mismatch.status, 3);
    assert.match(mismatch.stderr, /did not match/);
    assert.equal(await roleOf(person.id), "CLIENT", "a wrong confirmation changes nothing");
    const wrongHost = promote(person.email, { host: "localhost" });
    assert.equal(wrongHost.status, 3, "--host must be the connection's own host, written the same way");
    assert.equal(await roleOf(person.id), "CLIENT");
  });

  test("a confirmed account is promoted once the operator types the address again; the output is one counter-only line and holds no email", async () => {
    const person = await account("boss");
    const r = promote(person.email);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(await roleOf(person.id), "ADMIN");
    const audit = JSON.parse(r.stdout.split("\n").find((l) => l.startsWith("{")));
    assert.equal(audit.event, "promote-admin");
    assert.equal(audit.outcome, "promoted");
    assert.equal(audit.host, "127.0.0.1");
    assert.ok(Number.isInteger(audit.administrators) && audit.administrators >= 1);
    assert.ok(!JSON.stringify(audit).includes(person.email) && !JSON.stringify(audit).includes("boss"), "the audit line has no email or name");
    for (const out of [r.stdout, r.stderr]) assert.ok(!out.includes(new URL(url).password), "the connection password is never printed");
    // Promoting again is a no-op that says so.
    const again = promote(person.email);
    assert.equal(again.status, 0);
    assert.match(again.stdout, /already an administrator/);
    assert.equal(JSON.parse(again.stdout.split("\n").find((l) => l.startsWith("{"))).outcome, "already_admin");
  });

  test("the promotion takes effect for real: a fresh sign-in has administrator reach (all families, never conversations), and nobody else does", async () => {
    const boss = await account("boss2");
    const other = await account("other");
    assert.equal(promote(boss.email).status, 0);
    const token = async (a) => (await (await api("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: a.email, password: "correct horse battery staple" }) })).json()).access_token;
    const read = async (a, table) => (await fetch(`${stack.API_URL}/rest/v1/${table}?select=id`, { headers: { apikey: stack.PUBLISHABLE_KEY, Authorization: `Bearer ${await token(a)}` } })).json();
    assert.ok((await read(boss, "profiles")).length >= 2, "an administrator reads profiles for support");
    assert.equal((await read(other, "profiles")).length, 1, "an ordinary account reads only its own");
    assert.deepEqual(await read(boss, "chat_sessions"), [], "even an administrator never reads conversations");
  });
});
