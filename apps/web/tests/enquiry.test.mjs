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
  let sentEmail;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    sentEmail = JSON.parse(options.body);
    return Response.json({ id: "test-email-id" });
  });
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(sentEmail.reply_to, "parent@example.com");
  assert.match(sentEmail.html, /fractions and algebra/);
});
