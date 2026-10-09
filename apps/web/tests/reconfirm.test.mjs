import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { careersConfig, environment, humanCheck, jsonRequest, mockEmail, nextIp, OPEN, quiet, SECRET } from "./_routeHelpers.mjs";
import { understanding } from "./_fixtures.mjs";

// The yearly reconfirmation of the safeguarding agreement: POST /api/safeguarding/reconfirm.

careersConfig.rateLimits.reconfirm.global.max = 100_000;
const { currentAgreement } = loadTsFrom(import.meta.url, "../src/lib/safeguarding-agreement.ts");
const { agreementHash } = loadTsFrom(import.meta.url, "../src/lib/agreement-record.ts");
const reconfirm = loadTsFrom(import.meta.url, "../src/lib/reconfirm.ts");
const { POST } = loadTsFrom(import.meta.url, "../src/app/api/safeguarding/reconfirm/route.ts");

const URL = "http://localhost:3100/api/safeguarding/reconfirm";
const valid = {
  fullName: "Jane Smith",
  email: "jane@example.com",
  change: "none",
  agreementVersion: currentAgreement.version,
  agreedParts: ["A", "B", "C", "D", "E", "F", "G"],
  typedName: "jane  smith",
};
const post = (body, options) => POST(jsonRequest(URL, valid, body, options));

test("a reconfirmation is emailed with its record, and the tutor gets a confirmation with the same record", async (t) => {
  environment(t, { ...OPEN, RESEND_FROM_EMAIL: "careers@mail.learnthrivetuition.co.uk" });
  careersConfig.agreementApprovedByOwner = true;
  const sent = mockEmail(t);
  const lines = quiet(t);

  const response = await post({});
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.changeDeclared, false);
  assert.match(result.reference, /^LT-RECONF-\d{8}-[A-HJKMNP-Z2-9]{6}$/);

  const [internal, confirmation] = sent.map((entry) => entry.body);
  assert.deepEqual(internal.to, ["info@learnthrivetuition.co.uk"]);
  assert.equal(internal.reply_to, "jane@example.com");
  assert.equal(internal.subject, `Safeguarding reconfirmation: Jane Smith - ${currentAgreement.version} - ${result.reference}`);
  assert.match(internal.text, new RegExp(`Agreement version: ${currentAgreement.version}`));
  assert.match(internal.text, /Typed name: jane smith/);
  assert.match(internal.text, /Parts confirmed: A, B, C, D, E, F, G/);
  assert.match(internal.text, /Clauses confirmed: A1/);
  assert.match(internal.text, /Understanding check: Not part of this submission/);
  assert.ok(internal.text.includes(`Agreement text SHA-256: ${agreementHash(currentAgreement)}`));
  assert.match(internal.text, /no login/);
  assert.match(internal.text, /6 years/);
  assert.doesNotMatch(internal.subject, /CHANGE DECLARED/);

  assert.deepEqual(confirmation.to, ["jane@example.com"]);
  assert.match(confirmation.text, new RegExp(`version ${currentAgreement.version}`));
  assert.ok(confirmation.text.includes(agreementHash(currentAgreement)));
  assert.match(confirmation.text, /careers\/safeguarding-agreement/);
  assert.doesNotMatch(confirmation.text, /contact the safeguarding lead directly and immediately/);

  const log = lines.join("\n");
  assert.match(log, /"event":"reconfirm","outcome":"sent"/);
  for (const secret of ["Jane", "Smith", "jane@example.com"]) assert.ok(!log.includes(secret), secret);
});

test("a declared change is flagged in the subject and the body, and the tutor is told to call the safeguarding lead", async (t) => {
  environment(t, OPEN);
  careersConfig.agreementApprovedByOwner = true;
  const sent = mockEmail(t);
  quiet(t);
  const response = await post({ change: "changed" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).changeDeclared, true);
  const [internal, confirmation] = sent.map((entry) => entry.body);
  assert.match(internal.subject, /^\[CHANGE DECLARED\] Safeguarding reconfirmation: Jane Smith/);
  assert.match(internal.text, /SOMETHING HAS CHANGED/);
  assert.match(internal.text, /Contact them directly and immediately/);
  assert.match(internal.html, /Contact them directly and immediately/);
  assert.match(confirmation.text, /contact the safeguarding lead directly and immediately/i);
  assert.match(confirmation.text, /\+44 7459 839595/);
});

test("it is closed while the agreement is a draft, even though applications may be switched on", async (t) => {
  environment(t, { CAPTCHA_SECRET: SECRET, RESEND_API_KEY: "re_test_key" });
  const sent = mockEmail(t);
  quiet(t);
  const response = await post({});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "closed");
  assert.equal(sent.length, 0);
});

test("reconfirmation does not depend on the application switch", async (t) => {
  environment(t, OPEN);
  const before = careersConfig.acceptingApplications;
  careersConfig.acceptingApplications = false;
  t.after(() => { careersConfig.acceptingApplications = before; });
  mockEmail(t);
  quiet(t);
  assert.equal((await post({})).status, 200);
});

test("the typed name must match the full name given, the version must be current and every part ticked", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  let response = await post({ typedName: "Jane" });
  assert.equal(response.status, 422);
  assert.ok((await response.json()).errors.typedName);
  response = await post({ agreementVersion: "0.1" });
  assert.ok((await response.json()).errors.agreementVersion);
  response = await post({ agreedParts: ["A", "B", "C"] });
  assert.match((await response.json()).errors.agreedParts, /Part D/);
  response = await post({ change: "" });
  assert.ok((await response.json()).errors.change);
  response = await post({ email: "nope", fullName: "" });
  const { errors } = await response.json();
  assert.ok(errors.email && errors.fullName);
  assert.equal(sent.length, 0);
});

test("the understanding check is off by default for reconfirmation, and enforced when switched on", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  assert.equal(careersConfig.understandingCheck.reconfirmation, false);
  assert.equal((await post({})).status, 200);
  careersConfig.understandingCheck.reconfirmation = true;
  t.after(() => { careersConfig.understandingCheck.reconfirmation = false; });
  assert.equal((await post({})).status, 422);
  const ok = await post({ understanding });
  assert.equal(ok.status, 200);
  assert.match(sent.at(-2).body.text, /Understanding check: Passed/);
});

test("origin, rate limit, honeypot, human check and the production timing rule", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  assert.equal((await post({}, { headers: { origin: "https://evil.example.com" } })).status, 403);
  assert.equal((await post({ website: "x" })).status, 400);
  const noCheck = await post({ humanCheck: undefined });
  assert.equal(noCheck.status, 400);
  assert.equal((await noCheck.json()).code, "human-check");
  const answer = humanCheck();
  assert.equal((await post({ humanCheck: answer })).status, 200);
  assert.equal((await post({ humanCheck: answer })).status, 400, "a spent check cannot be used again");

  const ip = nextIp();
  const statuses = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await post({}, { ip })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  assert.equal(careersConfig.rateLimits.reconfirm.perClient.max, 5);
  assert.ok(sent.length > 0);
});

test("in production a form sent in seconds is refused", async (t) => {
  environment(t, { NODE_ENV: "production", CAPTCHA_SECRET: SECRET, RESEND_API_KEY: "re_live", RESEND_FROM_EMAIL: "careers@mail.learnthrivetuition.co.uk" });
  careersConfig.agreementApprovedByOwner = true;
  mockEmail(t);
  quiet(t);
  assert.equal((await post({ elapsedMs: 3000 })).status, 400);
  assert.equal((await post({ elapsedMs: undefined })).status, 400);
  assert.equal((await post({ elapsedMs: careersConfig.minFillMs.reconfirm })).status, 200);
});

test("a send failure is reported and no confirmation follows; a confirmation failure is not an error", async (t) => {
  environment(t, OPEN);
  let sent = mockEmail(t, [500]);
  quiet(t);
  assert.equal((await post({})).status, 502);
  assert.equal(sent.length, 1);
  t.mock.restoreAll();
  quiet(t);
  sent = mockEmail(t, [200, 500]);
  assert.equal((await post({})).status, 200);
  assert.equal(sent.length, 2);
});

test("unconfigured email is a friendly 503, and hostile bodies are refused", async (t) => {
  environment(t, { CAREERS_OPEN_FOR_TESTING: "1", CAPTCHA_SECRET: SECRET });
  const sent = mockEmail(t);
  quiet(t);
  assert.equal((await post({})).status, 503);
  environment(t, OPEN);
  for (const body of ["not json", "[]", "null", "\"text\""]) {
    const request = new Request(URL, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `${nextIp()}, 10.0.0.1` }, body });
    assert.equal((await POST(request)).status, 400, body);
  }
  const huge = new Request(URL, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `${nextIp()}, 10.0.0.1` }, body: JSON.stringify({ pad: "x".repeat(100_000) }) });
  assert.equal((await POST(huge)).status, 413);
  assert.equal(sent.length, 0);
});

test("everything typed is escaped in the HTML, and no header can be added through the name", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const name = "<script>alert(1)</script>\r\nBcc: evil@example.com";
  const response = await post({ fullName: name, typedName: name });
  assert.equal(response.status, 200);
  const { subject, html } = sent[0].body;
  assert.ok(!/[\r\n]/.test(subject));
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("the validation functions agree with the route", () => {
  const fields = reconfirm.parseReconfirm({ ...valid });
  assert.deepEqual(reconfirm.validateReconfirm(fields, { agreement: currentAgreement, understandingRequired: false }), {});
  assert.deepEqual(reconfirm.validateReconfirm(reconfirm.emptyReconfirm(), { agreement: currentAgreement, understandingRequired: true }).fullName, "Enter your full name.");
});
