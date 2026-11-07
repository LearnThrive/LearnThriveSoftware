import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scramVerifier, grantStatements } from "../scripts/create-server-role.mjs";

// The two operator scripts of plan20 (promote-admin, create-server-role): the paths that must refuse BEFORE any database is touched.
// None of these needs a database: the URLs point nowhere, and every run must end before a connection is tried. The flows that do
// change a database run against the real local stack in realstack.admin.test.mjs.

const WEB = fileURLToPath(new URL("..", import.meta.url));
const PASSWORD = "do-not-print-this-password-0123456789";
const run = (script, args, env = {}, input = "") =>
  spawnSync(process.execPath, [`scripts/${script}`, ...args], { cwd: WEB, encoding: "utf8", input, env: { PATH: process.env.PATH, ...env }, timeout: 20_000 });
const promote = (args, env = {}, input = "") => run("promote-admin.mjs", args, env, input);
const LOCAL = `postgresql://postgres:${PASSWORD}@127.0.0.1:54322/postgres`;
const HOSTED = `postgresql://postgres:${PASSWORD}@db.abcdefghijklmnop.supabase.co:5432/postgres`;

test("promote-admin refuses without a connection string, a username or an explicit host, before connecting", () => {
  assert.equal(promote(["--username", "a.person", "--host", "127.0.0.1"]).status, 2, "no DATABASE_URL");
  assert.equal(promote(["--host", "127.0.0.1"], { DATABASE_URL: LOCAL }).status, 2, "no username");
  assert.equal(promote(["--username", "not a username", "--host", "127.0.0.1"], { DATABASE_URL: LOCAL }).status, 2, "a bad username");
  const noHost = promote(["--username", "a.person"], { DATABASE_URL: LOCAL });
  assert.equal(noHost.status, 3);
  assert.match(noHost.stderr, /--host .* is required/);
  const wrong = promote(["--username", "a.person", "--host", "db.other.supabase.co"], { DATABASE_URL: LOCAL });
  assert.equal(wrong.status, 3);
  assert.match(wrong.stderr, /is not the host of DATABASE_URL/);
});

test("promote-admin against a hosted database needs a real terminal to type the host: a pipe is refused, and nothing is sent", () => {
  const r = promote(["--username", "a.person", "--host", "db.abcdefghijklmnop.supabase.co"], { DATABASE_URL: HOSTED }, "a.person\n");
  assert.equal(r.status, 3);
  assert.match(r.stderr, /needs a person at the keyboard/);
  // And it never echoes the connection string or its password, on any path.
  for (const out of [r.stdout, r.stderr]) assert.ok(!out.includes(PASSWORD) && !out.includes("postgres:"), out);
});

const account = (args, env = {}, input = "") =>
  spawnSync(process.execPath, ["--import", "tsx", "scripts/create-account.mjs", ...args], { cwd: WEB, encoding: "utf8", input, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...env }, timeout: 30_000 });

test("create-account refuses before connecting: missing settings, a wrong host, a local database, a list in the repository, a bad list", () => {
  const folder = mkdtempSync(join(tmpdir(), "learnthrive-create-account-"));
  try {
    const good = join(folder, "list.json");
    writeFileSync(good, JSON.stringify([{ username: "a.parent", displayName: "A Parent", linkedEmail: "a@example.com", role: "CLIENT" }]));
    const hosted = { DATABASE_URL: HOSTED, SUPABASE_URL: "https://abcdefghijklmnop.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_FakeKeyForTests_0123456789" };
    const host = "db.abcdefghijklmnop.supabase.co";

    assert.equal(account(["--file", good, "--host", host]).status, 2, "nothing set");
    assert.equal(account(["--host", host], hosted).status, 2, "no list");
    assert.equal(account(["--file", good], hosted).status, 3, "no host");
    assert.match(account(["--file", good, "--host", "db.other.supabase.co"], hosted).stderr, /is not the host of DATABASE_URL/);
    assert.match(account(["--file", good, "--host", "127.0.0.1"], { ...hosted, DATABASE_URL: LOCAL, SUPABASE_URL: "http://127.0.0.1:54321" }).stderr, /--local-stack/);
    assert.match(account(["--file", good, "--host", host], { ...hosted, SUPABASE_URL: "https://zzzzzzzzzzzzzzzz.supabase.co" }).stderr, /not belong to the same project/);
    assert.match(account(["--file", good, "--host", host, "--apply"], hosted).stderr, /--passwords/);

    const inside = join(WEB, "tests", "_routeHelpers.mjs");
    assert.match(account(["--file", inside, "--host", host], hosted).stderr, /outside this repository/);
    assert.match(account(["--file", good, "--host", host, "--apply", "--passwords", join(WEB, "passwords.tsv")], hosted).stderr, /outside this repository/);
    const already = join(folder, "already.tsv");
    writeFileSync(already, "x");
    assert.match(account(["--file", good, "--host", host, "--apply", "--passwords", already], hosted).stderr, /never overwritten/);

    const bad = join(folder, "bad.json");
    writeFileSync(bad, JSON.stringify([
      { username: "admin", displayName: "Reserved", linkedEmail: "a@example.com", role: "CLIENT" },
      { username: "kit-1234", displayName: "Kit", role: "STUDENT" },
      { username: "kit-1234", displayName: "", linkedEmail: "nope", role: "OWNER" },
      { username: "a.parent", displayName: "Parent", linkedEmail: "a@example.com", role: "CLIENT", teaches: true },
    ]));
    const refused = account(["--file", bad, "--host", host], hosted);
    assert.equal(refused.status, 2);
    for (const problem of [/reserved/, /needs "parent"/, /appears twice/, /displayName is required/, /role must be one of/, /"teaches" is only for an ADMIN/]) assert.match(refused.stderr, problem);

    const piped = account(["--file", good, "--host", host], hosted, "x\n");
    assert.equal(piped.status, 3, "a hosted project needs a real terminal to type the host");
    assert.match(piped.stderr, /needs a person at the keyboard/);
    for (const out of [piped.stdout, piped.stderr]) assert.ok(!out.includes(PASSWORD) && !out.includes("sb_secret_"), "no secret in any output");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("create-server-role refuses a missing or weak password and a hosted database without --host, before connecting", () => {
  const base = { DATABASE_ADMIN_URL: HOSTED };
  assert.equal(run("create-server-role.mjs", [], {}).status, 2, "no admin URL");
  assert.equal(run("create-server-role.mjs", [], base).status, 2, "no password");
  for (const weak of ["short", "x".repeat(31), `has space ${"x".repeat(40)}`]) {
    const r = run("create-server-role.mjs", [], { ...base, LEARNTHRIVE_SERVER_PASSWORD: weak });
    assert.equal(r.status, 2, weak);
    assert.ok(!r.stderr.includes(weak) || weak.length < 6, "the password is never echoed");
  }
  const noHost = run("create-server-role.mjs", [], { ...base, LEARNTHRIVE_SERVER_PASSWORD: PASSWORD });
  assert.equal(noHost.status, 3);
  assert.match(noHost.stderr, /not this machine/);
  assert.match(noHost.stderr, /--host db\.abcdefghijklmnop\.supabase\.co/);
  const piped = run("create-server-role.mjs", ["--host", "db.abcdefghijklmnop.supabase.co"], { ...base, LEARNTHRIVE_SERVER_PASSWORD: PASSWORD }, "db.abcdefghijklmnop.supabase.co\n");
  assert.equal(piped.status, 3, "a pipe cannot confirm a hosted database");
  for (const out of [noHost.stdout, noHost.stderr, piped.stdout, piped.stderr]) assert.ok(!out.includes(PASSWORD), "no password in any output");
});

test("the SCRAM verifier has Postgres's exact shape and is salted (the plaintext password is never what is sent)", () => {
  const v = scramVerifier(PASSWORD, Buffer.alloc(16, 7), 4096);
  const m = /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/.exec(v);
  assert.ok(m, v);
  assert.equal(m[1], "4096");
  assert.equal(Buffer.from(m[2], "base64").length, 16, "16-byte salt");
  assert.equal(Buffer.from(m[3], "base64").length, 32, "StoredKey is a SHA-256");
  assert.equal(Buffer.from(m[4], "base64").length, 32, "ServerKey is an HMAC-SHA-256");
  assert.equal(scramVerifier(PASSWORD, Buffer.alloc(16, 7), 4096), v, "deterministic for a given salt");
  assert.notEqual(scramVerifier(PASSWORD), scramVerifier(PASSWORD), "a fresh random salt each time");
  assert.ok(!v.includes(PASSWORD));
  // The statements carry the verifier and never the password; every one is a role or grant statement.
  const statements = grantStatements(v);
  assert.ok(statements.every((s) => !s.includes(PASSWORD)));
  assert.ok(statements.some((s) => s.includes(v)));
  assert.ok(statements.every((s) => /^(do \$\$|alter role|revoke|grant)/.test(s)), "nothing but role, revoke and grant statements");
  assert.ok(!statements.some((s) => /superuser|createrole|createdb|replication/i.test(s)), "attributes Postgres only lets a superuser name are not written");
  assert.ok(!statements.some((s) => /grant .* on (all )?(tables|sequences|functions) .* to (public|anon|authenticated)/i.test(s)));
});

// ---- supabase-smoke: every guard that must refuse before a connection is tried ----------------------------------------------------

const smoke = (args, env = {}, input = "") =>
  spawnSync(process.execPath, ["--import", "tsx", "scripts/supabase-smoke.mjs", ...args], { cwd: WEB, encoding: "utf8", input, env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...env }, timeout: 60_000 });
const SMOKE_BASE = { SUPABASE_ANON_KEY: "sb_publishable_FakeKeyForTests_0123456789", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_FakeKeyForTests_0123456789" };
const API = "https://abcdefghijklmnopqrst.supabase.co";
const POOLER = `postgresql://learnthrive_server.abcdefghijklmnopqrst:${PASSWORD}@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;

test("supabase-smoke refuses a missing setting, mixed local and hosted settings, another project's database, and a missing --host", () => {
  assert.equal(smoke([], {}).status, 2, "nothing set");
  assert.equal(smoke([], { ...SMOKE_BASE, SUPABASE_URL: API, DATABASE_URL: LOCAL }).status, 3, "a hosted API with a local database");
  const other = smoke(["--host", "abcdefghijklmnopqrst.supabase.co"], { ...SMOKE_BASE, SUPABASE_URL: API, DATABASE_URL: POOLER.replace(/abcdefghijklmnopqrst/g, "zzzzzzzzzzzzzzzzzzzz") });
  assert.equal(other.status, 3);
  assert.match(other.stderr, /not belong to the same project/);
  const noHost = smoke([], { ...SMOKE_BASE, SUPABASE_URL: API, DATABASE_URL: POOLER });
  assert.equal(noHost.status, 3);
  assert.match(noHost.stderr, /Pass --host abcdefghijklmnopqrst\.supabase\.co/);
  const piped = smoke(["--host", "abcdefghijklmnopqrst.supabase.co"], { ...SMOKE_BASE, SUPABASE_URL: API, DATABASE_URL: POOLER }, "abcdefghijklmnopqrst.supabase.co\n");
  assert.equal(piped.status, 3, "a hosted project needs a real terminal to type the host");
  assert.match(piped.stderr, /needs a person at the keyboard/);
  for (const r of [noHost, piped, other]) for (const out of [r.stdout, r.stderr]) assert.ok(!out.includes(PASSWORD) && !out.includes("sb_secret_"), "no secret in any output");
});
