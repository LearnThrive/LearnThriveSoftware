import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTsFrom } from "./_tsLoader.mjs";

// Launch checklist 3.8 (docs/OBSERVABILITY.md): readiness, the server-error line, the heartbeat and the log line itself.
const { readiness, requestErrorFields, heartbeatFields, registerClassroom, classroomInfo, forgetClassroom } = loadTsFrom(import.meta.url, "../src/lib/observability.ts");
const { logOutcome } = loadTsFrom(import.meta.url, "../src/lib/log.ts");

const PRODUCTION_OPEN = { NODE_ENV: "production", NEXT_PUBLIC_APP_PORTAL_ENABLED: "true" };
const PRODUCTION_CLOSED = { NODE_ENV: "production" };
const answers = () => Promise.resolve();
const fails = () => Promise.reject(new Error("connection refused: postgres://learnthrive_server:secret@db"));
const hangs = () => new Promise(() => {});
const running = () => true;
const absent = () => false;

test("readiness: everything answering is ready, and says only ok, failing or off", async () => {
  const result = await readiness(PRODUCTION_OPEN, { database: answers, auth: answers, classroom: running });
  assert.deepEqual(result, { ok: true, checks: { database: "ok", auth: "ok", classroom: "ok" } });
});

test("readiness: a configured dependency that fails is not ready, and the error never reaches the answer", async () => {
  const result = await readiness(PRODUCTION_OPEN, { database: fails, auth: answers, classroom: running });
  assert.equal(result.ok, false);
  assert.deepEqual(result.checks, { database: "failing", auth: "ok", classroom: "ok" });
  assert.doesNotMatch(JSON.stringify(result), /secret|postgres|refused/);
});

test("readiness: a configured dependency that fails still counts with the portal closed", async () => {
  const result = await readiness(PRODUCTION_CLOSED, { database: answers, auth: fails, classroom: running });
  assert.equal(result.ok, false);
});

test("readiness: a dependency that hangs is failing after the timeout, not waited on forever", async () => {
  const started = Date.now();
  const result = await readiness(PRODUCTION_OPEN, { database: hangs, auth: answers, classroom: running }, 50);
  assert.equal(result.checks.database, "failing");
  assert.ok(Date.now() - started < 1_000);
});

test("readiness: with the portal open, a missing database, Auth or classroom is not ready", async () => {
  assert.equal((await readiness(PRODUCTION_OPEN, { auth: answers, classroom: running })).ok, false);
  assert.equal((await readiness(PRODUCTION_OPEN, { database: answers, classroom: running })).ok, false);
  // A plain `next start` serves the site but no classroom (checklist 3.1): exactly what this catches.
  const noClassroom = await readiness(PRODUCTION_OPEN, { database: answers, auth: answers, classroom: absent });
  assert.deepEqual(noClassroom, { ok: false, checks: { database: "ok", auth: "ok", classroom: "off" } });
});

test("readiness: with the portal closed (go-live step one) nothing needs to be configured", async () => {
  const result = await readiness(PRODUCTION_CLOSED, { classroom: absent });
  assert.deepEqual(result, { ok: true, checks: { database: "off", auth: "off", classroom: "off" } });
});

test("readiness: outside production nothing is required", async () => {
  assert.equal((await readiness({ NEXT_PUBLIC_APP_PORTAL_ENABLED: "true" }, { classroom: absent })).ok, true);
});

test("the classroom record is found by the readiness check, and can be forgotten", () => {
  forgetClassroom();
  assert.equal(classroomInfo(), null);
  const stats = () => ({ rooms: 0, participants: 0, waiting: 0, sockets: 0 });
  registerClassroom({ media: "mesh", maxStudents: 3, stats });
  assert.equal(classroomInfo().maxStudents, 3);
  forgetClassroom();
  assert.equal(classroomInfo(), null);
});

test("a server error line names the route pattern, the kind and the digest, never the message, the URL or a header", () => {
  const error = Object.assign(new Error("duplicate key value (email)=(parent@example.com)"), { digest: "2847361923" });
  const fields = requestErrorFields(
    error,
    { path: "/dashboard/admin/students/7f1c?name=Jamie", method: "POST", headers: { cookie: "lt_access=token" } },
    { routePath: "/dashboard/admin/students/[id]/page", routeType: "action", routerKind: "App Router" },
  );
  assert.deepEqual(fields, { kind: "Error", digest: "2847361923", route: "/dashboard/admin/students/[id]/page", routeType: "action", method: "POST" });
  assert.doesNotMatch(JSON.stringify(fields), /example\.com|Jamie|7f1c|token/);
});

test("a server error line reduces anything unexpected to a safe value", () => {
  const odd = class extends Error {};
  Object.defineProperty(odd.prototype, "name", { value: "Error: Jamie Patel" });
  const fields = requestErrorFields(new odd("x"), { method: "post; drop" }, { routePath: "/a?b=c d", routeType: "render" });
  assert.deepEqual(fields, { kind: "other", route: "other", routeType: "render" });
  assert.deepEqual(requestErrorFields("a thrown string", {}, {}), { kind: "string", route: "other" });
  assert.equal(requestErrorFields(Object.assign(new Error(), { digest: "has spaces in it" }), {}, {}).digest, undefined);
});

test("the heartbeat is counts and sizes only", () => {
  const fields = heartbeatFields({
    uptimeSeconds: 3600.4,
    memory: { rss: 300 * 1024 * 1024, heapUsed: 120.6 * 1024 * 1024 },
    eventLoopDelayP99Ms: 21.7,
    classroom: { media: "sfu", rooms: 2, participants: 13, waiting: 1, sockets: 14 },
  });
  assert.deepEqual(fields, { uptimeS: 3600, rssMb: 300, heapMb: 121, loopP99Ms: 22, media: "sfu", rooms: 2, participants: 13, waiting: 1, sockets: 14 });
  assert.deepEqual(Object.keys(heartbeatFields({ uptimeSeconds: 1, memory: { rss: 0, heapUsed: 0 }, eventLoopDelayP99Ms: 0, classroom: null })), ["uptimeS", "rssMb", "heapMb", "loopP99Ms"]);
});

test("the log line: routine outcomes to stdout, the rest to stderr, and only short codes and numbers survive", (t) => {
  const info = t.mock.method(console, "info", () => {});
  const warn = t.mock.method(console, "warn", () => {});
  logOutcome("account-signin", "ok");
  logOutcome("server", "heartbeat", { rooms: 1 });
  logOutcome("account-signin", "locked");
  logOutcome("readiness", "failing", { database: "failing", username: "jamie.p", email: "parent@example.com", note: "a sentence with spaces", n: Number.NaN });
  assert.deepEqual(info.mock.calls.map((call) => call.arguments[0]), ['{"event":"account-signin","outcome":"ok"}', '{"event":"server","outcome":"heartbeat","rooms":1}']);
  assert.equal(warn.mock.calls[0].arguments[0], '{"event":"account-signin","outcome":"locked"}');
  // A short code-like value such as a username would pass the shape check, so callers must never pass one: this pins the rule's limit.
  assert.deepEqual(JSON.parse(warn.mock.calls[1].arguments[0]), { event: "readiness", outcome: "failing", database: "failing", username: "jamie.p" });
});
