import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// What only the real Auth service can prove (launch checklist 3.2.1, 3.2.8, 3.2.9): that it accepts the internal address, that a login made by
// the Admin API signs in, and that the operator script works through the narrow learnthrive_server role. Skipped unless SUPABASE_LOCAL=1:
//   SUPABASE_LOCAL=1 node --test tests/realstack.accounts.test.mjs

const ENABLED = process.env.SUPABASE_LOCAL === "1";
const WEB = fileURLToPath(new URL("..", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const DOMAIN = "accounts.learnthrivetuition.co.uk";

describe("accounts on the real local stack", { skip: ENABLED ? false : "set SUPABASE_LOCAL=1 with the local stack running (npm run supabase:start)" }, () => {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
  const folder = mkdtempSync(join(tmpdir(), "learnthrive-accounts-"));
  let stack;
  let url; // the narrow server role, direct
  let sql;
  const created = [];
  const api = (path, init = {}, key = stack.SECRET_KEY) => fetch(`${stack.API_URL}${path}`, { ...init, headers: { apikey: key, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const signIn = (username, password) => api("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: `${username}@${DOMAIN}`, password }) }, stack.PUBLISHABLE_KEY);

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
    rmSync(folder, { recursive: true, force: true });
  });

  const script = (list, extra = [], input = "") => {
    const file = join(folder, `list-${randomBytes(4).toString("hex")}.json`);
    writeFileSync(file, JSON.stringify(list));
    return spawnSync(process.execPath, ["--import", "tsx", "scripts/create-account.mjs", "--file", file, "--host", "127.0.0.1", "--local-stack", ...extra], {
      cwd: WEB,
      encoding: "utf8",
      input,
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, DATABASE_URL: url, SUPABASE_URL: stack.API_URL, SUPABASE_SERVICE_ROLE_KEY: stack.SECRET_KEY },
      timeout: 60_000,
    });
  };

  test("Auth accepts the internal address: an Admin API login on that domain is confirmed and signs in", async () => {
    const password = randomBytes(18).toString("base64url");
    const email = `probe-${run}@${DOMAIN}`;
    const reply = await api("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: "Probe" } }) });
    assert.equal(reply.status, 200, "if this refuses the domain, give it a null MX record (docs/AUTHENTICATION.md)");
    created.push((await reply.json()).id);
    assert.equal((await signIn(`probe-${run}`, password)).status, 200);
    const link = await api("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "recovery", email }) });
    assert.equal(link.status, 200);
    const { hashed_token: tokenHash } = await link.json();
    assert.ok(tokenHash, "the token comes back instead of an email going out");
    const spent = await api("/auth/v1/verify", { method: "POST", body: JSON.stringify({ type: "recovery", token_hash: tokenHash }) }, stack.PUBLISHABLE_KEY);
    assert.equal(spent.status, 200);
    const again = await api("/auth/v1/verify", { method: "POST", body: JSON.stringify({ type: "recovery", token_hash: tokenHash }) }, stack.PUBLISHABLE_KEY);
    assert.notEqual(again.status, 200, "single use");
  });

  test("wrong username and wrong password are the same answer from Auth", async () => {
    const reply = await api("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: `twin-${run}@${DOMAIN}`, password: randomBytes(18).toString("base64url"), email_confirm: true }) });
    created.push((await reply.json()).id);
    const wrongPassword = await signIn(`twin-${run}`, "not the password at all");
    const wrongUsername = await signIn(`nobody-${run}`, "not the password at all");
    assert.equal(wrongPassword.status, wrongUsername.status);
    assert.deepEqual(await wrongPassword.json(), await wrongUsername.json());
  });

  test("the operator script: a dry run changes nothing, then staff, a family and a child are made through the narrow role", async () => {
    const parent = `parent-${run}`;
    const list = [
      { username: `alvi-${run}`, displayName: "Teaching Admin", linkedEmail: `alvi-${run}@example.com`, role: "ADMIN", teaches: true, subjects: ["Maths"] },
      { username: `brian-${run}`, displayName: "Admin Only", linkedEmail: `brian-${run}@example.com`, role: "ADMIN" },
      { username: parent, displayName: "A Parent", linkedEmail: `Parent-${run}@example.com`, role: "CLIENT" },
      { username: `kit-${run}`, displayName: "Kit", role: "STUDENT", parent, yearGroup: "Year 9" },
    ];
    const dry = script(list);
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.match(dry.stdout, /DRY RUN/);
    assert.equal((await sql`select count(*)::int as n from public.profiles where username = ${parent}`)[0].n, 0, "a dry run changes nothing");

    const passwords = join(folder, `passwords-${run}.tsv`);
    const real = script(list, ["--apply", "--passwords", passwords], `${list.length}\n`);
    assert.equal(real.status, 0, real.stdout + real.stderr);
    const handed = new Map(readFileSync(passwords, "utf8").trim().split("\n").map((row) => row.split("\t")));
    assert.equal(handed.size, list.length);
    for (const [, password] of handed) {
      assert.ok(!real.stdout.includes(password) && !real.stderr.includes(password), "a temporary password never reaches the console");
    }
    const rows = await sql`select id, username, role, linked_email, must_change_password, adult_confirmed_at from public.profiles where username = any(${list.map((row) => row.username)})`;
    created.push(...rows.map((row) => row.id));
    const by = new Map(rows.map((row) => [row.username, row]));
    assert.equal(by.get(`alvi-${run}`).role, "ADMIN");
    assert.equal((await sql`select count(*)::int as n from public.tutors where profile_id = ${by.get(`alvi-${run}`).id}`)[0].n, 1, "an administrator who teaches has a tutor record");
    assert.equal((await sql`select count(*)::int as n from public.tutors where profile_id = ${by.get(`brian-${run}`).id}`)[0].n, 0, "an administrator only has none");
    assert.equal(by.get(`kit-${run}`).role, "STUDENT");
    assert.equal(by.get(`kit-${run}`).linked_email, `parent-${run}@example.com`, "a child takes their parent's address");
    assert.equal(by.get(`kit-${run}`).adult_confirmed_at, null);
    assert.ok(rows.every((row) => row.must_change_password));

    assert.equal((await signIn(`kit-${run}`, handed.get(`kit-${run}`))).status, 200, "each signs in with the temporary password");

    const again = script(list);
    assert.equal(again.status, 1, "a re-run sees the usernames are taken and stops");
    assert.match(again.stdout, /ALREADY TAKEN/);
  });

  test("the operator script refuses to overwrite the passwords file, and a wrong confirmation changes nothing", async () => {
    const list = [{ username: `nope-${run}`, displayName: "Nope", linkedEmail: `nope-${run}@example.com`, role: "CLIENT" }];
    const passwords = join(folder, `unconfirmed-${run}.tsv`);
    const wrong = script(list, ["--apply", "--passwords", passwords], "99\n");
    assert.equal(wrong.status, 3);
    assert.equal((await sql`select count(*)::int as n from public.profiles where username = ${`nope-${run}`}`)[0].n, 0);
    writeFileSync(passwords, "already here");
    const exists = script(list, ["--apply", "--passwords", passwords], "1\n");
    assert.equal(exists.status, 3);
    assert.match(exists.stderr, /never overwritten/);
  });
});
