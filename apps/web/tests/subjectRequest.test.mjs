import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { careersConfig, environment, humanCheck, jsonRequest, mockEmail, nextIp, OPEN, quiet, SECRET } from "./_routeHelpers.mjs";

// "Can't see your subject?": POST /api/subject-request and the functions behind it.

careersConfig.rateLimits.subjectRequest.global.max = 100_000;
const lib = loadTsFrom(import.meta.url, "../src/lib/subject-request.ts");
const { POST } = loadTsFrom(import.meta.url, "../src/app/api/subject-request/route.ts");

const URL = "http://localhost:3100/api/subject-request";
const valid = { subject: "Computer Science", other: "", level: "Year 9", askedBy: "parent", note: "", email: "", notify: false };
const post = (body, options) => POST(jsonRequest(URL, valid, body, options));

test("a listed subject: one email to the owners, subject line counts it, no confirmation without consent", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  const lines = quiet(t);
  const response = await post({});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(sent.length, 1);
  const { body } = sent[0];
  assert.equal(body.subject, "Subject request: Computer Science (Year 9)");
  assert.deepEqual(body.to, ["info@learnthrivetuition.co.uk"]);
  assert.equal(body.reply_to, undefined, "an anonymous request has no one to reply to");
  assert.match(body.text, /Subject: Computer Science/);
  assert.match(body.text, /Asked by: A parent or guardian/);
  assert.match(body.text, /Email to tell when available: Not given/);
  assert.match(body.text, /12 months/);
  assert.doesNotMatch(lines.join("\n"), /Computer Science/, "the log holds no answers");
});

test("SUBJECT_REQUEST_EMAIL decides where requests go", async (t) => {
  environment(t, { ...OPEN, SUBJECT_REQUEST_EMAIL: "subjects@learnthrivetuition.co.uk", ENQUIRY_EMAIL: "enquiries@learnthrivetuition.co.uk" });
  const sent = mockEmail(t);
  quiet(t);
  await post({});
  assert.deepEqual(sent[0].body.to, ["subjects@learnthrivetuition.co.uk"]);
});

test("'Other' needs a typed subject, which appears in a distinct subject line", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  let response = await post({ subject: "Other", other: "" });
  assert.equal(response.status, 422);
  assert.ok((await response.json()).errors.other);
  response = await post({ subject: "Other", other: "a" });
  assert.equal(response.status, 422);
  assert.equal(sent.length, 0);

  response = await post({ subject: "Other", other: "  Latin  " });
  assert.equal(response.status, 200);
  assert.equal(sent[0].body.subject, "Subject request [other]: Latin (Year 9)");
  assert.match(sent[0].body.text, /Chosen from: Typed in \(Other\)/);
});

test("a typed subject is cleaned: markup removed, one line, capped", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const response = await post({ subject: "Other", other: "<b>Ancient</b>\r\nGreek <script>x</script>\u0000" + "y".repeat(100) });
  assert.equal(response.status, 200);
  const { subject, html } = sent[0].body;
  assert.ok(!/[\r\n<>]/.test(subject), subject);
  assert.ok(subject.startsWith("Subject request [other]: AncientGreek x") || subject.startsWith("Subject request [other]: Ancient Greek x"), subject);
  assert.ok(!html.includes("<script>"));
  assert.ok(lib.cleanOtherSubject("z".repeat(200)).length === 60);
});

test("the typed text is ignored when another subject is chosen", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  await post({ subject: "History", other: "Something else" });
  assert.equal(sent[0].body.subject, "Subject request: History (Year 9)");
  assert.doesNotMatch(sent[0].body.text, /Something else/);
});

test("a subject, level or asker outside the lists is refused", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  for (const bad of [{ subject: "Basket weaving" }, { subject: "" }, { level: "Year 99" }, { level: "" }, { askedBy: "robot" }, { askedBy: "" }]) {
    const response = await post(bad);
    assert.equal(response.status, 422, JSON.stringify(bad));
  }
  assert.equal(sent.length, 0);
});

test("the note is optional and limited to 500 characters", async (t) => {
  environment(t, OPEN);
  mockEmail(t);
  quiet(t);
  assert.equal((await post({ note: "x".repeat(500) })).status, 200);
  const response = await post({ note: "x".repeat(501) });
  assert.equal(response.status, 422);
  assert.ok((await response.json()).errors.note);
});

test("a confirmation goes out only when an address is given AND the box is ticked", async (t) => {
  environment(t, OPEN);
  let sent = mockEmail(t);
  quiet(t);
  await post({ email: "family@example.com", notify: false });
  assert.equal(sent.length, 1, "an address without the ticked box is ignored");
  assert.doesNotMatch(sent[0].body.text, /family@example\.com/, "and is not passed to the owners");
  assert.equal(sent[0].body.reply_to, undefined);

  t.mock.restoreAll();
  quiet(t);
  sent = mockEmail(t);
  const response = await post({ subject: "Other", other: "Latin", email: "family@example.com", notify: true });
  assert.equal(response.status, 200);
  assert.equal(sent.length, 2);
  assert.match(sent[0].body.text, /Email to tell when available: family@example\.com/);
  assert.equal(sent[0].body.reply_to, "family@example.com");
  const confirmation = sent[1].body;
  assert.deepEqual(confirmation.to, ["family@example.com"]);
  assert.match(confirmation.text, /We will only email you if Latin becomes available/);
  assert.match(confirmation.text, /not add you to any list/);
  assert.match(confirmation.text, /\/privacy/);
});

test("ticking the box needs a valid address", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  let response = await post({ notify: true, email: "" });
  assert.equal(response.status, 422);
  assert.ok((await response.json()).errors.email);
  response = await post({ notify: true, email: "nope" });
  assert.equal(response.status, 422);
  assert.equal(sent.length, 0);
});

test("a script that fills the honeypot, or is too quick in production, is told it worked and nothing is sent", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const trapped = await post({ website: "http://spam.example" });
  assert.equal(trapped.status, 200);
  assert.deepEqual(await trapped.json(), { success: true });
  assert.equal(sent.length, 0);

  environment(t, { NODE_ENV: "production", CAPTCHA_SECRET: SECRET, RESEND_API_KEY: "re_live", RESEND_FROM_EMAIL: "careers@mail.learnthrivetuition.co.uk" });
  assert.equal((await post({ elapsedMs: 500 })).status, 200);
  assert.equal((await post({ elapsedMs: undefined })).status, 200);
  assert.equal(sent.length, 0);
  assert.equal((await post({ elapsedMs: careersConfig.minFillMs.subjectRequest })).status, 200);
  assert.equal(sent.length, 1);
});

test("origin, human check and rate limit", async (t) => {
  environment(t, OPEN);
  mockEmail(t);
  quiet(t);
  assert.equal((await post({}, { headers: { origin: "https://evil.example.com" } })).status, 403);
  const none = await post({ humanCheck: undefined });
  assert.equal(none.status, 400);
  assert.equal((await none.json()).code, "human-check");
  const answer = humanCheck();
  assert.equal((await post({ humanCheck: answer })).status, 200);
  assert.equal((await post({ humanCheck: answer })).status, 400);

  const ip = nextIp();
  const statuses = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await post({}, { ip })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});

test("unconfigured email in production is a friendly 503; a send failure is reported", async (t) => {
  environment(t, { NODE_ENV: "production", CAPTCHA_SECRET: SECRET });
  const sent = mockEmail(t);
  quiet(t);
  const response = await post({ elapsedMs: 60_000 });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /info@learnthrivetuition\.co\.uk/);
  assert.equal(sent.length, 0);

  environment(t, OPEN);
  t.mock.restoreAll();
  quiet(t);
  mockEmail(t, [500]);
  assert.equal((await post({})).status, 502);
});

test("hostile or oversized bodies are refused", async (t) => {
  environment(t, OPEN);
  mockEmail(t);
  quiet(t);
  for (const body of ["not json", "[]", "null"]) {
    const request = new Request(URL, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `${nextIp()}, 10.0.0.1` }, body });
    assert.equal((await POST(request)).status, 400, body);
  }
  const huge = new Request(URL, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `${nextIp()}, 10.0.0.1` }, body: JSON.stringify({ pad: "x".repeat(40_000) }) });
  assert.equal((await POST(huge)).status, 413);
});

test("the options are the ones the owners asked for", () => {
  assert.deepEqual([...lib.SUBJECT_REQUEST_OPTIONS], ["Computer Science", "Biology", "Chemistry", "Physics", "History", "Geography", "French", "Spanish", "Business Studies", "Economics", "Psychology", "Music"]);
  assert.equal(lib.OTHER_SUBJECT, "Other");
  assert.ok(lib.LEVEL_OPTIONS.includes("Year 3") && lib.LEVEL_OPTIONS.includes("Other / not sure"));
});
