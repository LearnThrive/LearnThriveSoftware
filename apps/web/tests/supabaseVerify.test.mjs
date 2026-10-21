import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PUBLIC_TABLES, runProbes } from "../scripts/supabase-verify.mjs";

// scripts/supabase-verify.mjs against fake projects: a well-set-up one (everything passes) and deliberately leaky ones (the right
// probe fails). No network beyond localhost, no real key: the "key" is a made-up string that must never appear in any output.

const KEY = "sb_publishable_NotARealKeyJustATestValue123";
const REFUSAL = JSON.stringify({ code: "42501", message: "permission denied for table x" });

/** A fake Supabase. `leaks` switches individual mistakes on. */
function fakeProject(leaks = {}) {
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const send = (status, body, headers = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    const path = url.pathname;
    if (path === "/auth/v1/settings") {
      return send(200, { external: { email: true, google: Boolean(leaks.google), phone: false, anonymous_users: Boolean(leaks.anonymous) }, disable_signup: Boolean(leaks.signupClosed), mailer_autoconfirm: Boolean(leaks.autoconfirm), saml_enabled: false });
    }
    if (path === "/rest/v1/") return send(200, { paths: { "/": {}, "/resources": {}, ...(leaks.openapi ? { "/clients": {} } : {}) } });
    if (path === "/rest/v1/resources" && request.method === "PATCH") return leaks.anonWrite ? send(204, "") : send(401, REFUSAL);
    if (path === "/rest/v1/resources") return send(200, leaks.paths ? [{ id: 1, storage_path: "a/b.pdf" }] : [{ id: 1, title: "t" }]);
    if (path === "/rest/v1/resource_files") return leaks.filePaths ? send(200, [{ storage_path: "a/b.pdf" }]) : send(401, REFUSAL);
    if (path === "/rest/v1/clients" && leaks.errorStack) return send(500, { message: "boom", detail: "at Object.run (/usr/src/app/node_modules/x.js:1:1)" });
    if (path.startsWith("/rest/v1/")) {
      const schema = request.headers["accept-profile"];
      if (schema && schema !== "public") return leaks.schema === schema ? send(200, [{ id: 1 }]) : send(406, { code: "PGRST106" });
      return leaks.tables?.includes(path.split("/").pop()) ? send(200, [{ id: 1, thing: 1 }]) : send(401, REFUSAL);
    }
    if (path === "/graphql/v1") return leaks.graphql ? send(200, { data: {} }) : send(406, { message: "no" });
    if (path.startsWith("/pg/")) return leaks.meta ? send(200, []) : send(404, { error: "not found" });
    if (path === "/storage/v1/bucket") return send(200, leaks.publicBucket ? [{ id: "library", public: true }] : []);
    if (path.startsWith("/storage/v1/object/public/")) return leaks.publicUrl ? send(200, "%PDF") : send(400, { statusCode: "404" });
    if (path.startsWith("/storage/v1/object/list/")) return send(200, leaks.listable ? [{ name: "x.pdf" }] : []);
    if (path.startsWith("/storage/v1/object/")) return request.method === "POST" ? (leaks.upload ? send(200, { Key: "x" }) : send(400, { statusCode: "403" })) : leaks.unsigned ? send(200, "%PDF") : send(400, { statusCode: "404" });
    return send(404, {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}

async function probe(leaks, options = {}) {
  const project = await fakeProject(leaks);
  try {
    const results = await runProbes({ url: project.url, key: KEY, ...options });
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    return { results, by, failed: results.filter((r) => r.level === "fail").map((r) => r.id) };
  } finally {
    await project.close();
  }
}

test("a well-set-up project passes every probe", async () => {
  const { failed, results } = await probe({});
  assert.deepEqual(failed, [], JSON.stringify(results.filter((r) => r.level === "fail")));
  assert.ok(results.filter((r) => r.level === "pass").length >= 14);
});

test("each mistake makes its own probe fail, and only that one", async () => {
  const cases = [
    [{ google: true }, "providers"],
    [{ anonymous: true }, "providers"],
    [{ autoconfirm: true }, "confirm-email"],
    [{ tables: ["clients"] }, "anon-tables"],
    [{ tables: ["chat_messages", "consents"] }, "anon-tables"],
    [{ paths: true }, "no-paths"],
    [{ filePaths: true }, ["anon-file-paths", "anon-tables"]], // resource_files is also a table anonymous callers must not read
    [{ anonWrite: true }, "anon-write"],
    [{ schema: "private" }, "schemas"],
    [{ graphql: true }, "graphql"],
    [{ openapi: true }, "openapi"],
    [{ meta: true }, "meta", { assumeLocal: false }], // held to the hosted rules (on the local stack /pg/ is only a note)
    [{ publicBucket: true }, "storage"],
    [{ publicUrl: true }, "storage"],
    [{ listable: true }, "storage"],
    [{ unsigned: true }, "storage"],
    [{ upload: true }, "storage"],
    [{ errorStack: true }, "leaks"],
  ];
  for (const [leak, expected, options] of cases) {
    const { failed } = await probe(leak, options);
    // A localhost fake held to the hosted rules also fails the HTTPS check, which is correct and expected.
    const want = [expected].flat().concat(options?.assumeLocal === false ? ["transport"] : []);
    assert.deepEqual([...failed].sort(), want.sort(), `${JSON.stringify(leak)} should fail exactly ${want}`);
  }
  // On the local stack the same /pg/ answer is only a note: it is the CLI gateway's Studio tool, not the hosted API.
  const local = await probe({ meta: true });
  assert.deepEqual(local.failed, []);
  assert.equal(local.by.meta.level, "note");
});

test("the owner's chosen settings are compared, not assumed: sign-up open or closed, GraphQL on or off", async () => {
  assert.deepEqual((await probe({ signupClosed: true })).failed, ["signup"], "closed when the checklist says open");
  assert.deepEqual((await probe({ signupClosed: true }, { expectSignup: "closed" })).failed, []);
  assert.deepEqual((await probe({}, { expectSignup: "closed" })).failed, ["signup"]);
  assert.deepEqual((await probe({ graphql: true }, { expectGraphql: "on" })).failed, []);
  assert.deepEqual((await probe({}, { expectGraphql: "on" })).failed, ["graphql"]);
});

test("the key never appears in the results, even when the server echoes it back", async () => {
  const echo = createServer((request, response) => {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end(`bad key ${request.headers.apikey}`);
  });
  await new Promise((r) => echo.listen(0, "127.0.0.1", r));
  try {
    const results = await runProbes({ url: `http://127.0.0.1:${echo.address().port}`, key: KEY });
    assert.ok(results.some((r) => r.level === "fail"));
    assert.ok(!JSON.stringify(results).includes(KEY), "the key is not in any result");
  } finally {
    await new Promise((r) => echo.close(r));
  }
  const cli = spawnSync(process.execPath, ["scripts/supabase-verify.mjs"], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", env: { PATH: process.env.PATH, SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_ANON_KEY: KEY } });
  assert.equal(cli.status, 1, "an unreachable project is a FAIL, not a crash");
  assert.ok(!cli.stdout.includes(KEY) && !cli.stderr.includes(KEY));
  assert.equal(spawnSync(process.execPath, ["scripts/supabase-verify.mjs"], { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", env: { PATH: process.env.PATH } }).status, 2, "no URL or key: it could not run");
});

test("the table list covers every table the migrations create (a new table must be added to the probes)", () => {
  const dir = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
  const created = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    // Comment lines are skipped: 0002 describes the future embeddings table in a comment, and it must not count until it exists.
    const sql = readFileSync(join(dir, file), "utf8").split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    for (const m of sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/gi)) created.add(m[1]);
  }
  assert.deepEqual([...created].sort(), [...PUBLIC_TABLES].sort());
});
