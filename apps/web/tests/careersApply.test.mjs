import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { docx, JPEG, MACRO_CONTENT_TYPES, pdf, validApplication } from "./_fixtures.mjs";

// POST /api/careers/apply with email mocked at the network layer (the Resend SDK's fetch), covering the whole
// path: the gate, origin, rate limit, configuration, body limit, screening, validation, files, both emails.

const { careersConfig } = loadTsFrom(import.meta.url, "../src/lib/careers-config.ts");
// The route-wide ceiling is covered in rateLimit.test.mjs; raise it so this file's many requests do not meet it.
careersConfig.rateLimits.apply.global.max = 100_000;
const check = loadTsFrom(import.meta.url, "../src/lib/human-check.ts");
const core = loadTsFrom(import.meta.url, "../src/lib/human-check-core.ts");
const { currentAgreement } = loadTsFrom(import.meta.url, "../src/lib/safeguarding-agreement.ts");
const { agreementHash } = loadTsFrom(import.meta.url, "../src/lib/agreement-record.ts");
const { POST } = loadTsFrom(import.meta.url, "../src/app/api/careers/apply/route.ts");

const SECRET = "a-test-secret-that-is-at-least-thirty-two-characters-long";
const ENV_KEYS = ["NODE_ENV", "CAREERS_OPEN_FOR_TESTING", "CAPTCHA_SECRET", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "CAREERS_EMAIL", "ENQUIRY_EMAIL", "ALLOWED_ORIGINS", "TRUSTED_PROXY_HOPS", "CLIENT_IP_HEADER"];

/** Sets the environment for one test and puts it back afterwards. `undefined` removes a variable. */
function environment(t, values) {
  const before = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const gate = careersConfig.agreementApprovedByOwner;
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) if (value !== undefined) process.env[key] = value;
  check.resetHumanCheckState();
  t.after(() => {
    for (const key of ENV_KEYS) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
    careersConfig.agreementApprovedByOwner = gate;
  });
}

const OPEN = { CAREERS_OPEN_FOR_TESTING: "1", CAPTCHA_SECRET: SECRET, RESEND_API_KEY: "re_test_key" };

let ipCounter = 0;
const nextIp = () => `203.0.113.${(ipCounter += 1)}`;

function solve(challenge) {
  for (let n = 0; ; n += 1) {
    const solution = String(n);
    if (core.leadingZeroBits(createHash("sha256").update(core.powInput(challenge.challenge, solution)).digest()) >= challenge.bits) return solution;
  }
}
function humanCheck() {
  const challenge = check.issuePowChallenge({ bits: 6 });
  return challenge ? { ...challenge, solution: solve(challenge) } : { kind: "pow" };
}

/** A multipart application request. `files` maps part name -> [filename, bytes]. */
function applyRequest({ payload = {}, files = { cv: ["Jane CV.pdf", pdf()] }, headers = {}, ip = nextIp(), documentTypes = [] } = {}) {
  const form = new FormData();
  form.append("payload", JSON.stringify({ ...validApplication(), website: "", elapsedMs: 120_000, humanCheck: humanCheck(), documentTypes, ...payload }));
  for (const [name, [filename, bytes]] of Object.entries(files)) form.append(name, new Blob([bytes]), filename);
  return new Request("http://localhost:3100/api/careers/apply", {
    method: "POST",
    body: form,
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1`, ...headers },
  });
}

/** Replaces fetch with a recorder. `outcomes` lists the status each call should return (default 200). */
function mockEmail(t, outcomes = []) {
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    sent.push({ url: String(url), body });
    const status = outcomes[sent.length - 1] ?? 200;
    return status === 200 ? Response.json({ id: `email-${sent.length}` }) : Response.json({ name: "internal_server_error", message: "no" }, { status });
  });
  return sent;
}

const decode = (attachment) => Buffer.from(attachment.content, "base64");
const quiet = (t) => {
  const lines = [];
  t.mock.method(console, "info", (line) => lines.push(String(line)));
  t.mock.method(console, "warn", (line) => lines.push(String(line)));
  t.mock.method(console, "error", () => undefined); // the Resend SDK reports a simulated failure here
  return lines;
};

test("a good application sends the hiring team's email with the files, then the applicant's confirmation", async (t) => {
  environment(t, { ...OPEN, RESEND_FROM_EMAIL: "careers@mail.learnthrivetuition.co.uk" });
  const sent = mockEmail(t);
  const lines = quiet(t);
  const request = applyRequest({
    files: { cv: ["Jane CV.pdf", pdf()], coverLetterFile: ["letter.docx", docx()], "support-0": ["degree.jpg", JPEG] },
    documentTypes: ["qualification"],
  });

  const response = await POST(request);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  assert.match(result.reference, /^LT-APP-\d{8}-[A-HJKMNP-Z2-9]{6}$/);
  assert.equal(result.role, "Maths Tutor");
  assert.equal(response.headers.get("cache-control"), "no-store");

  assert.equal(sent.length, 2);
  const [internal, confirmation] = sent.map((entry) => entry.body);
  assert.deepEqual(internal.to, ["info@learnthrivetuition.co.uk"]);
  assert.equal(internal.from, "LearnThrive Tuition <careers@mail.learnthrivetuition.co.uk>");
  assert.equal(internal.reply_to, "jane@example.com");
  assert.equal(internal.subject, `Careers application: Maths Tutor - Jane Smith - ${result.reference}`);
  assert.deepEqual(internal.attachments.map((a) => a.filename), ["CV - Jane CV.pdf", "Cover letter - letter.docx", "Qualification or certificate - degree.jpg"]);
  assert.equal(decode(internal.attachments[0]).subarray(0, 5).toString(), "%PDF-");
  assert.deepEqual(decode(internal.attachments[2]), JPEG);
  assert.match(internal.html, /untrusted/);
  assert.match(internal.text, /untrusted/);
  assert.match(internal.html, /Mathematics/);
  assert.match(internal.text, /Why they want to tutor/);

  // The agreement record: version, the name typed, parts and clauses, the check, time, and the hash of the text.
  assert.match(internal.text, new RegExp(`Agreement version: ${currentAgreement.version}`));
  assert.match(internal.text, /Typed name: Jane Smith/);
  assert.match(internal.text, /Parts confirmed: A, B, C, D, E, F, G/);
  assert.match(internal.text, /Clauses confirmed: A1, A2/);
  assert.match(internal.text, /Understanding check: Passed/);
  assert.match(internal.text, /Received \(server time, UTC\): 20\d\d-\d\d-\d\dT/);
  assert.ok(internal.text.includes(`Agreement text SHA-256: ${agreementHash(currentAgreement)}`));
  assert.doesNotMatch(internal.text, /203\.0\.113/, "the visitor's address is never recorded");

  assert.deepEqual(confirmation.to, ["jane@example.com"]);
  assert.equal(confirmation.reply_to, "info@learnthrivetuition.co.uk");
  assert.equal(confirmation.attachments, undefined);
  assert.match(confirmation.subject, new RegExp(result.reference));
  assert.match(confirmation.text, new RegExp(`Your reference: ${result.reference}`));
  assert.match(confirmation.text, /We will reply within 5 working days\./);
  assert.match(confirmation.text, new RegExp(`version ${currentAgreement.version}`));
  assert.match(confirmation.text, /careers\/safeguarding-agreement/);
  assert.match(confirmation.text, /careers\/privacy/);
  assert.match(confirmation.text, /tutor agreement/);
  assert.doesNotMatch(confirmation.text, /Mathematics|Leeds|degree\.jpg|jane@example\.com/, "no copy of their answers");

  // Logs carry the reference, outcome and sizes, and nothing personal.
  const log = lines.join("\n");
  assert.match(log, /"event":"careers","outcome":"sent"/);
  assert.match(log, new RegExp(result.reference));
  for (const secret of ["Jane", "Smith", "jane@example.com", "Leeds", "Mathematics", "Jane CV"]) assert.ok(!log.includes(secret), `the log must not contain ${secret}`);
});

test("identity and right-to-work files are flagged in the subject and the body", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  const response = await POST(applyRequest({ files: { cv: ["cv.pdf", pdf()], "support-0": ["passport.png", JPEG.length ? Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]) : JPEG] }, documentTypes: ["identity"] }));
  assert.equal(response.status, 200);
  const { body } = sent[0];
  assert.match(body.subject, /\[ID documents attached\]$/);
  assert.match(body.html, /Identity or right-to-work documents are attached/);
  assert.match(body.text, /SENSITIVE/);
  assert.equal(body.attachments[1].filename, "Identity document - passport.png");
});

test("duplicate file names are made distinct, and odd names are cleaned", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  const response = await POST(applyRequest({
    files: { cv: ["../../cv.exe.pdf", pdf()], "support-0": ["a.jpg", JPEG], "support-1": ["a.jpg", JPEG] },
    documentTypes: ["other", "other"],
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(sent[0].body.attachments.map((a) => a.filename), ["CV - cv-exe.pdf", "Other - a.jpg", "Other - a (2).jpg"]);
});

test("everything the applicant typed is escaped in the HTML email and cannot add a header to the subject", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  const response = await POST(applyRequest({
    payload: { firstName: "<img src=x onerror=alert(1)>", lastName: "Smith\r\nBcc: evil@example.com", typedName: "<img src=x onerror=alert(1)> Smith Bcc: evil@example.com", town: "<b>Leeds</b>", whyTutor: `<script>alert("x")</script> ${"I like teaching. ".repeat(8)}` },
  }));
  assert.equal(response.status, 200);
  const { subject, html } = sent[0].body;
  assert.ok(!/[\r\n]/.test(subject));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<b>Leeds"));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("while the agreement is still a draft the route is closed, in development and in production", async (t) => {
  environment(t, { CAPTCHA_SECRET: SECRET, RESEND_API_KEY: "re_test_key" });
  const sent = mockEmail(t);
  for (const mode of [undefined, "development"]) {
    process.env.NODE_ENV = mode ?? "";
    const response = await POST(applyRequest());
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "closed");
    assert.match(body.error, /info@learnthrivetuition\.co\.uk/);
    assert.match(body.error, /safeguarding agreement/);
  }
  // The testing switch is ignored in a production build, whatever it says.
  process.env.NODE_ENV = "production";
  process.env.CAREERS_OPEN_FOR_TESTING = "1";
  process.env.RESEND_FROM_EMAIL = "careers@mail.learnthrivetuition.co.uk";
  assert.equal((await POST(applyRequest())).status, 503);
  assert.equal(sent.length, 0);
});

test("switching applications off closes the form even after the agreement is approved", async (t) => {
  environment(t, { ...OPEN });
  careersConfig.agreementApprovedByOwner = true;
  const switchedOn = careersConfig.acceptingApplications;
  careersConfig.acceptingApplications = false;
  t.after(() => { careersConfig.acceptingApplications = switchedOn; });
  const sent = mockEmail(t);
  assert.equal((await POST(applyRequest())).status, 503);
  assert.equal(sent.length, 0);
});

test("in production, with the agreement approved, a complete application is accepted", async (t) => {
  environment(t, { NODE_ENV: "production", CAPTCHA_SECRET: SECRET, RESEND_API_KEY: "re_live", RESEND_FROM_EMAIL: "careers@mail.learnthrivetuition.co.uk", CAREERS_EMAIL: "careers@learnthrivetuition.co.uk" });
  careersConfig.agreementApprovedByOwner = true;
  const sent = mockEmail(t);
  quiet(t);
  const response = await POST(applyRequest({ headers: { origin: "https://www.learnthrivetuition.co.uk" }, payload: { elapsedMs: 90_000 } }));
  assert.equal(response.status, 200);
  assert.deepEqual(sent[0].body.to, ["careers@learnthrivetuition.co.uk"], "CAREERS_EMAIL decides where it goes");
});

test("in production a missing key or sender is a friendly 503 and nothing is read or sent", async (t) => {
  careersConfig.agreementApprovedByOwner = true;
  for (const env of [
    { NODE_ENV: "production", CAPTCHA_SECRET: SECRET },
    { NODE_ENV: "production", CAPTCHA_SECRET: SECRET, RESEND_API_KEY: "re_live" },
    { NODE_ENV: "production", RESEND_API_KEY: "re_live", RESEND_FROM_EMAIL: "a@b.co" },
  ]) {
    environment(t, env);
    careersConfig.agreementApprovedByOwner = true;
    const sent = mockEmail(t);
    const response = await POST(applyRequest());
    assert.equal(response.status, 503, JSON.stringify(Object.keys(env)));
    assert.equal((await response.json()).code, "unavailable");
    assert.equal(sent.length, 0);
    t.mock.restoreAll();
  }
});

test("a missing email key does not stop the module loading or the route answering", async (t) => {
  environment(t, { CAREERS_OPEN_FOR_TESTING: "1", CAPTCHA_SECRET: SECRET });
  const sent = mockEmail(t);
  quiet(t);
  const response = await POST(applyRequest());
  assert.equal(response.status, 503);
  assert.equal(sent.length, 0);
});

test("a request from another site is refused; the site's own origins and localhost in development are fine", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  assert.equal((await POST(applyRequest({ headers: { origin: "https://evil.example.com" } }))).status, 403);
  assert.equal((await POST(applyRequest({ headers: { "sec-fetch-site": "cross-site" } }))).status, 403);
  assert.equal(sent.length, 0);
  for (const origin of ["https://www.learnthrivetuition.co.uk", "https://learnthrivetuition.co.uk", "http://localhost:3100"]) {
    assert.equal((await POST(applyRequest({ headers: { origin } }))).status, 200, origin);
  }
});

test("a visitor who sends too many applications is limited (and it is stricter than the enquiry form's)", async (t) => {
  environment(t, OPEN);
  mockEmail(t);
  quiet(t);
  const ip = "198.51.100.200";
  const statuses = [];
  for (let i = 0; i < 4; i += 1) statuses.push((await POST(applyRequest({ ip }))).status);
  assert.deepEqual(statuses, [200, 200, 200, 429]);
  assert.ok(careersConfig.rateLimits.apply.perClient.max < 5, "the enquiry route allows 5 per 15 minutes");
  assert.equal((await POST(applyRequest({ ip: "198.51.100.201" }))).status, 200, "another visitor is unaffected");
});

test("a forged left-hand X-Forwarded-For entry does not escape the limit", async (t) => {
  environment(t, OPEN);
  mockEmail(t);
  quiet(t);
  const statuses = [];
  for (let i = 0; i < 4; i += 1) {
    const request = applyRequest({ ip: "198.51.100.210", headers: { "x-forwarded-for": `1.2.3.${i}, 198.51.100.210, 10.0.0.1` } });
    statuses.push((await POST(request)).status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 429]);
});

test("a body over the limit is refused before it is read, and one that lies about its size is cut off", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const limit = careersConfig.limits.totalBytes + careersConfig.limits.bodyOverheadBytes;
  const headers = (extra = {}) => ({ "content-type": "multipart/form-data; boundary=x", "x-forwarded-for": `${nextIp()}, 10.0.0.1`, ...extra });

  // Declared too large: refused from the header alone (some runtimes will not let a script set Content-Length).
  const declared = await POST(new Request("http://localhost:3100/api/careers/apply", { method: "POST", headers: headers({ "content-length": String(limit + 1) }), body: "tiny" }));
  assert.ok([413, 400].includes(declared.status));

  // No length at all (like chunked encoding) and a body that never ends: counted as it arrives and cut off.
  let pulled = 0;
  const endless = new ReadableStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });
  const streamed = await POST(new Request("http://localhost:3100/api/careers/apply", { method: "POST", headers: headers(), body: endless, duplex: "half" }));
  assert.equal(streamed.status, 413);
  assert.match((await streamed.json()).error, /too large/);
  assert.ok(pulled <= Math.ceil(limit / (1024 * 1024)) + 8, `read ${pulled} MB before stopping`);
  assert.equal(sent.length, 0);
});

test("a filled honeypot is refused honestly, and so is a form with no human check", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  assert.equal((await POST(applyRequest({ payload: { website: "http://spam.example" } }))).status, 400);
  const none = await POST(applyRequest({ payload: { humanCheck: undefined } }));
  assert.equal(none.status, 400);
  assert.equal((await none.json()).code, "human-check");
  assert.equal(sent.length, 0);
});

test("in production a form sent in seconds, or with no timing, is refused", async (t) => {
  environment(t, { NODE_ENV: "production", CAPTCHA_SECRET: SECRET, RESEND_API_KEY: "re_live", RESEND_FROM_EMAIL: "careers@mail.learnthrivetuition.co.uk" });
  careersConfig.agreementApprovedByOwner = true;
  const sent = mockEmail(t);
  quiet(t);
  assert.equal((await POST(applyRequest({ payload: { elapsedMs: 4000 } }))).status, 400);
  assert.equal((await POST(applyRequest({ payload: { elapsedMs: undefined } }))).status, 400);
  assert.equal((await POST(applyRequest({ payload: { elapsedMs: careersConfig.minFillMs.apply } }))).status, 200);
  assert.equal(sent.length, 2);
});

test("a human-check answer works once; an expired, tampered or reused one is refused", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const answer = humanCheck();
  assert.equal((await POST(applyRequest({ payload: { humanCheck: answer } }))).status, 200);
  const reused = await POST(applyRequest({ payload: { humanCheck: answer } }));
  assert.equal(reused.status, 400);
  assert.equal((await reused.json()).code, "human-check");

  const tampered = humanCheck();
  assert.equal((await POST(applyRequest({ payload: { humanCheck: { ...tampered, bits: 1 } } }))).status, 400);
  const expired = check.issuePowChallenge({ bits: 6, now: Date.now() - 2 * careersConfig.humanCheck.ttlMs });
  assert.equal((await POST(applyRequest({ payload: { humanCheck: { ...expired, solution: solve(expired) } } }))).status, 400);
  assert.equal(sent.length, 2, "only the one good application was sent");
});

test("the fallback sum is accepted in place of the proof of work", async (t) => {
  environment(t, OPEN);
  mockEmail(t);
  quiet(t);
  const question = check.issueTextChallenge();
  const [, a, b] = /What is (\d+) plus (\d+)\?/.exec(question.question);
  const answer = { kind: "text", id: question.id, expires: question.expires, signature: question.signature, answer: String(Number(a) + Number(b)) };
  assert.equal((await POST(applyRequest({ payload: { humanCheck: answer } }))).status, 200);
});

test("answers are validated again on the server, with an error for each field", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const response = await POST(applyRequest({ payload: { email: "nope", typedName: "Someone Else", agreedParts: ["A", "B"], understanding: {}, declDbs: false, rightToWork: "no", gcse: "" } }));
  assert.equal(response.status, 422);
  const { errors } = await response.json();
  for (const key of ["email", "typedName", "agreedParts", "understanding", "declDbs", "rightToWork", "results"]) assert.ok(errors[key], key);
  assert.equal(sent.length, 0);
});

test("a submission made against an old version of the agreement is refused", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const response = await POST(applyRequest({ payload: { agreementVersion: "0.9" } }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).errors.agreementVersion, /updated/);
  assert.equal(sent.length, 0);
});

test("a role that is not open is refused", async (t) => {
  environment(t, OPEN);
  mockEmail(t);
  quiet(t);
  const response = await POST(applyRequest({ payload: { role: "astronaut" } }));
  assert.equal(response.status, 422);
  assert.ok((await response.json()).errors.role);
});

test("the CV is required, and each file is checked for what it is", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);

  let response = await POST(applyRequest({ files: {} }));
  assert.equal(response.status, 422);
  assert.ok((await response.json()).fileErrors.cv);

  response = await POST(applyRequest({ files: { cv: ["cv.exe", Buffer.from("MZ")] } }));
  assert.equal(response.status, 422);
  assert.ok((await response.json()).fileErrors.cv);

  response = await POST(applyRequest({ files: { cv: ["cv.pdf", docx()] } }));
  assert.equal((await response.json()).fileErrors.cv.length > 10, true);

  response = await POST(applyRequest({ files: { cv: ["cv.docx", docx({ contentTypes: MACRO_CONTENT_TYPES })] } }));
  assert.match((await response.json()).fileErrors.cv, /macros/);

  response = await POST(applyRequest({ files: { cv: ["cv.pdf", pdf("/JavaScript")] } }));
  assert.match((await response.json()).fileErrors.cv, /scripting/);

  response = await POST(applyRequest({ files: { cv: ["cv.pdf", pdf()], "support-0": ["x.jpg", Buffer.from("not a jpeg")] }, documentTypes: ["other"] }));
  assert.equal(response.status, 422);
  assert.ok((await response.json()).fileErrors.supporting[0]);

  assert.equal(sent.length, 0);
});

test("supporting documents need a valid type each, and only the allowed file parts are accepted", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  assert.equal((await POST(applyRequest({ files: { cv: ["cv.pdf", pdf()], "support-0": ["a.jpg", JPEG] }, documentTypes: [] }))).status, 422);
  assert.equal((await POST(applyRequest({ files: { cv: ["cv.pdf", pdf()], "support-0": ["a.jpg", JPEG] }, documentTypes: ["nonsense"] }))).status, 422);
  assert.equal((await POST(applyRequest({ files: { cv: ["cv.pdf", pdf()], "support-5": ["a.jpg", JPEG] }, documentTypes: ["other"] }))).status, 422);
  assert.equal((await POST(applyRequest({ files: { cv: ["cv.pdf", pdf()], extra: ["a.jpg", JPEG] } }))).status, 422);
  assert.equal(sent.length, 0);
});

test("the total across all files is enforced on the server", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const MB = 1024 * 1024;
  const padded = (head, size) => Buffer.concat([head, Buffer.alloc(size - head.length)]);
  // 3 + 3 + 3 + 3 + 0.3 MB: every file is within its own limit and the whole is just over 12 MB, but under the body ceiling.
  const response = await POST(applyRequest({
    files: {
      cv: ["cv.pdf", padded(pdf(), 3 * MB)],
      coverLetterFile: ["letter.pdf", padded(pdf(), 3 * MB)],
      "support-0": ["a.jpg", padded(JPEG, 3 * MB)],
      "support-1": ["b.jpg", padded(JPEG, 3 * MB)],
      "support-2": ["c.jpg", padded(JPEG, Math.floor(0.3 * MB))],
    },
    documentTypes: ["other", "other", "other"],
  }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).fileErrors.total, /over the 12 MB limit/);
  assert.equal(sent.length, 0);
});

test("if the hiring team's email fails, the visitor is told and no confirmation is sent", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t, [500]);
  quiet(t);
  const response = await POST(applyRequest());
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Nothing has been sent/);
  assert.equal(sent.length, 1);
});

test("if only the confirmation fails, the application still counts as received", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t, [200, 500]);
  const lines = quiet(t);
  const response = await POST(applyRequest());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  assert.equal(sent.length, 2);
  assert.match(lines.join("\n"), /"confirmation":"failed"/);
});

test("a thrown network error is handled, not leaked", async (t) => {
  environment(t, OPEN);
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed to someone@example.com"); });
  const lines = quiet(t);
  const response = await POST(applyRequest());
  assert.equal(response.status, 502);
  assert.ok(!JSON.stringify(await response.json()).includes("someone@example.com"));
  assert.ok(!lines.join("\n").includes("someone@example.com"));
});

test("a body that is not multipart, or has no payload, is a plain 400", async (t) => {
  environment(t, OPEN);
  mockEmail(t);
  quiet(t);
  const json = new Request("http://localhost:3100/api/careers/apply", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `${nextIp()}, 10.0.0.1` }, body: "{}" });
  assert.equal((await POST(json)).status, 400);
  const form = new FormData();
  form.append("cv", new Blob([pdf()]), "cv.pdf");
  assert.equal((await POST(new Request("http://localhost:3100/api/careers/apply", { method: "POST", body: form, headers: { "x-forwarded-for": `${nextIp()}, 10.0.0.1` } }))).status, 400);
  const bad = new FormData();
  bad.append("payload", "{not json");
  assert.equal((await POST(new Request("http://localhost:3100/api/careers/apply", { method: "POST", body: bad, headers: { "x-forwarded-for": `${nextIp()}, 10.0.0.1` } }))).status, 400);
});

test("with the understanding check switched off it is not required", async (t) => {
  environment(t, OPEN);
  mockEmail(t);
  quiet(t);
  const before = careersConfig.understandingCheck.applications;
  careersConfig.understandingCheck.applications = false;
  t.after(() => { careersConfig.understandingCheck.applications = before; });
  assert.equal((await POST(applyRequest({ payload: { understanding: {} } }))).status, 200);
});
