import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { compileFunction } from "node:vm";
import ts from "typescript";

// Run the real TypeScript route using the existing compiler dependency. This also
// works on the supported Node 20 releases, which cannot import TypeScript directly.
const require = createRequire(import.meta.url);
const routeSource = readFileSync(
  new URL("../src/app/api/enquiry/route.ts", import.meta.url),
  "utf8",
);
const compiledRoute = ts.transpileModule(routeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadRoute() {
  const fakeModule = { exports: {} };
  compileFunction(compiledRoute, ["require", "module", "exports"])(
    require, fakeModule, fakeModule.exports,
  );
  return fakeModule.exports;
}

function setApiKey(t, value) {
  const previous = process.env.RESEND_API_KEY;
  if (value === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = value;
  t.after(() => {
    if (previous === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  });
}

const validEnquiry = {
  parentName: "Test Parent",
  email: "parent@example.com",
  phone: "",
  yearGroup: "Year 8",
  subject: "Maths",
  support: "We would like help with fractions and algebra.",
  contactMethod: "email",
};

function request(body = validEnquiry) {
  return new Request("http://localhost/api/enquiry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

for (const key of [undefined, "   "]) {
  test(`route loads without email credentials and returns 503 (${key === undefined ? "missing" : "blank"} key)`, async (t) => {
    setApiKey(t, key);
    t.mock.method(globalThis, "fetch", () => assert.fail("Unconfigured enquiries must not contact Resend"));
    const { POST } = loadRoute();
    const response = await POST(request());
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(typeof body.error, "string");
    assert.match(body.error, /info@learnthrivetuition\.co\.uk/);
    assert.equal(body.success, undefined);
  });
}

test("invalid enquiries still return 400 when email is unconfigured", async (t) => {
  setApiKey(t, undefined);
  const { POST } = loadRoute();
  const response = await POST(request({ ...validEnquiry, email: "not-an-email" }));
  assert.equal(response.status, 400);
});

test("email credentials are read at request time and a configured enquiry can succeed", async (t) => {
  setApiKey(t, undefined);
  const { POST } = loadRoute();
  process.env.RESEND_API_KEY = "re_test_not_a_real_key";
  const sentEmails = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    sentEmails.push(JSON.parse(options.body));
    return Response.json({ id: "test-email-id" });
  });
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });

  // Two emails now, not one: an admin notification and an auto-reply confirmation to the
  // parent, both awaited (not fire-and-forget) so this ordering is deterministic.
  assert.equal(sentEmails.length, 2);
  const [adminEmail, autoReply] = sentEmails;
  assert.equal(adminEmail.reply_to, "parent@example.com");
  assert.match(adminEmail.html, /fractions and algebra/);
  assert.deepEqual(adminEmail.to, ["info@learnthrivetuition.co.uk"]);

  assert.deepEqual(autoReply.to, ["parent@example.com"]);
  assert.equal(autoReply.reply_to, "info@learnthrivetuition.co.uk");
  assert.match(autoReply.html, /Thank you for your enquiry, Test Parent/);
});

test("a failed auto-reply does not fail the overall enquiry submission", async (t) => {
  setApiKey(t, undefined);
  const { POST } = loadRoute();
  process.env.RESEND_API_KEY = "re_test_not_a_real_key";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    calls += 1;
    const parsed = JSON.parse(options.body);
    // Fail only the second call (the auto-reply) — the admin notification must still succeed.
    if (calls === 2) throw new Error("simulated Resend outage");
    void parsed;
    return Response.json({ id: "test-email-id" });
  });
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(calls, 2);
});

// ── plan15 Wave 12: abuse protection and fail-closed production config ──────────────────────────

function setEnv(t, name, value) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

function mockResend(t) {
  const sent = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return Response.json({ id: "test-email-id" });
  });
  return sent;
}

function productionEnv(t) {
  setEnv(t, "NODE_ENV", "production");
  setEnv(t, "RESEND_API_KEY", "re_test_not_a_real_key");
  setEnv(t, "RESEND_FROM_EMAIL", "enquiries@example.test");
  setEnv(t, "ENQUIRY_EMAIL", "owner@example.test");
}

test("a filled honeypot gets the normal success answer and sends nothing", async (t) => {
  setEnv(t, "RESEND_API_KEY", "re_test_not_a_real_key");
  const sent = mockResend(t);
  const { POST } = loadRoute();
  const response = await POST(request({ ...validEnquiry, website: "https://spam.example" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(sent.length, 0);
});

test("in production a submission that arrives too fast, or with no timing at all, is dropped silently", async (t) => {
  productionEnv(t);
  const sent = mockResend(t);
  const { POST } = loadRoute();
  for (const extra of [{ elapsedMs: 400 }, {}, { elapsedMs: "soon" }]) {
    const response = await POST(request({ ...validEnquiry, ...extra }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
  }
  assert.equal(sent.length, 0);
});

test("in production a human-paced submission is sent", async (t) => {
  productionEnv(t);
  const sent = mockResend(t);
  const { POST } = loadRoute();
  const response = await POST(request({ ...validEnquiry, website: "", elapsedMs: 41000 }));
  assert.equal(response.status, 200);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0].to, ["owner@example.test"]);
  assert.match(sent[0].from, /enquiries@example\.test/);
});

test("outside production a fast submission is allowed (developers and un-mocked e2e runs)", async (t) => {
  setEnv(t, "RESEND_API_KEY", "re_test_not_a_real_key");
  const sent = mockResend(t);
  const { POST } = loadRoute();
  const response = await POST(request({ ...validEnquiry, elapsedMs: 50 }));
  assert.equal(response.status, 200);
  assert.equal(sent.length, 2);
});

for (const missing of ["ENQUIRY_EMAIL", "RESEND_FROM_EMAIL"]) {
  test(`production fails closed when ${missing} is missing`, async (t) => {
    productionEnv(t);
    setEnv(t, missing, undefined);
    t.mock.method(globalThis, "fetch", () => assert.fail("A misconfigured production deploy must not send"));
    const { POST } = loadRoute();
    const response = await POST(request({ ...validEnquiry, elapsedMs: 41000 }));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Please email \S+@\S+ directly/);
  });
}

test("the same enquiry sent twice in a row is one enquiry (double click, retry)", async (t) => {
  setEnv(t, "RESEND_API_KEY", "re_test_not_a_real_key");
  const sent = mockResend(t);
  const { POST } = loadRoute();
  const first = await POST(request());
  const second = await POST(request());
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { success: true });
  assert.equal(sent.length, 2, "one admin email and one auto-reply, not four");
});

test("a failed send does not leave the parent's retry blocked as a duplicate", async (t) => {
  setEnv(t, "RESEND_API_KEY", "re_test_not_a_real_key");
  let attempt = 0;
  t.mock.method(globalThis, "fetch", async () => {
    attempt += 1;
    if (attempt === 1) return Response.json({ name: "application_error", message: "down" }, { status: 500 });
    return Response.json({ id: "ok" });
  });
  const { POST } = loadRoute();
  assert.equal((await POST(request())).status, 500);
  assert.equal((await POST(request())).status, 200);
});

test("the log line for an outcome carries no personal data", async (t) => {
  setEnv(t, "RESEND_API_KEY", "re_test_not_a_real_key");
  mockResend(t);
  const lines = [];
  t.mock.method(console, "info", (line) => lines.push(String(line)));
  const { POST } = loadRoute();
  await POST(request());
  const joined = lines.join("\n");
  assert.match(joined, /"outcome":"sent"/);
  assert.doesNotMatch(joined, /parent@example\.com|Test Parent|fractions/);
});
