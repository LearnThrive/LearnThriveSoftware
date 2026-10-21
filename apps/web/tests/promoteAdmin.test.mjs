import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("promote-admin refuses without a connection string, an email or an explicit host, before connecting", () => {
  assert.equal(promote(["--email", "a@example.com", "--host", "127.0.0.1"]).status, 2, "no DATABASE_URL");
  assert.equal(promote(["--host", "127.0.0.1"], { DATABASE_URL: LOCAL }).status, 2, "no email");
  assert.equal(promote(["--email", "not an email", "--host", "127.0.0.1"], { DATABASE_URL: LOCAL }).status, 2, "a bad email");
  const noHost = promote(["--email", "a@example.com"], { DATABASE_URL: LOCAL });
  assert.equal(noHost.status, 3);
  assert.match(noHost.stderr, /--host .* is required/);
  const wrong = promote(["--email", "a@example.com", "--host", "db.other.supabase.co"], { DATABASE_URL: LOCAL });
  assert.equal(wrong.status, 3);
  assert.match(wrong.stderr, /is not the host of DATABASE_URL/);
});

test("promote-admin against a hosted database needs a real terminal to type the host: a pipe is refused, and nothing is sent", () => {
  const r = promote(["--email", "a@example.com", "--host", "db.abcdefghijklmnop.supabase.co"], { DATABASE_URL: HOSTED }, "a@example.com\n");
  assert.equal(r.status, 3);
  assert.match(r.stderr, /needs a person at the keyboard/);
  // And it never echoes the connection string or its password, on any path.
  for (const out of [r.stdout, r.stderr]) assert.ok(!out.includes(PASSWORD) && !out.includes("postgres:"), out);
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
