import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment, humanCheck, jsonRequest, mockEmail, nextIp, OPEN, quiet, SECRET } from "./_routeHelpers.mjs";

// The Library waitlist: POST /api/library-waitlist and the pure functions behind it (plan19 phase B2).

const { libraryConfig, libraryPhase, libraryPrices } = loadTsFrom(import.meta.url, "../src/lib/library-config.ts");
const lib = loadTsFrom(import.meta.url, "../src/lib/library-waitlist.ts");
const { POST } = loadTsFrom(import.meta.url, "../src/app/api/library-waitlist/route.ts");

const RULES = libraryConfig.waitlist.rateLimits;
const GLOBAL_MAX = RULES.global.max;
RULES.global.max = 100_000;

const URL = "http://localhost:3100/api/library-waitlist";
const valid = { email: "family@example.com", consent: true };
const post = (body, options) => POST(jsonRequest(URL, valid, body, options));
const PRODUCTION = { NODE_ENV: "production", CAPTCHA_SECRET: SECRET, RESEND_API_KEY: "re_live", RESEND_FROM_EMAIL: "careers@mail.learnthrivetuition.co.uk" };

test("a sign-up: one email to the owners, then a confirmation to the person, and no personal data in the log", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  const lines = quiet(t);
  const response = await post({});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(sent.length, 2);

  const owners = sent[0].body;
  assert.equal(owners.subject, "Library waitlist: new sign-up");
  assert.deepEqual(owners.to, ["info@learnthrivetuition.co.uk"]);
  assert.equal(owners.reply_to, "family@example.com");
  assert.match(owners.text, /Email address: family@example\.com/);
  assert.match(owners.text, /Agreed to: Email me once when the Library launches/);
  assert.match(owners.text, /12 months/);

  const person = sent[1].body;
  assert.deepEqual(person.to, ["family@example.com"]);
  assert.equal(person.subject, "You are on the LearnThrive Library waitlist");
  assert.equal(person.reply_to, "info@learnthrivetuition.co.uk");
  assert.match(person.text, /email you once/);
  assert.match(person.text, /reply to this email or write to info@learnthrivetuition\.co\.uk/);
  assert.match(person.text, /\/privacy/);

  const log = lines.join("\n");
  assert.match(log, /library-waitlist/);
  assert.doesNotMatch(log, /family|example\.com|@/, "the log holds counters only");
});

test("LIBRARY_WAITLIST_EMAIL, then ENQUIRY_EMAIL, then the site address decide where sign-ups go", async (t) => {
  environment(t, { ...OPEN, LIBRARY_WAITLIST_EMAIL: "library@learnthrivetuition.co.uk", ENQUIRY_EMAIL: "enquiries@learnthrivetuition.co.uk" });
  let sent = mockEmail(t);
  quiet(t);
  await post({});
  assert.deepEqual(sent[0].body.to, ["library@learnthrivetuition.co.uk"]);
  assert.equal(sent[1].body.reply_to, "library@learnthrivetuition.co.uk");

  t.mock.restoreAll();
  environment(t, { ...OPEN, ENQUIRY_EMAIL: "enquiries@learnthrivetuition.co.uk" });
  quiet(t);
  sent = mockEmail(t);
  await post({});
  assert.deepEqual(sent[0].body.to, ["enquiries@learnthrivetuition.co.uk"]);

  t.mock.restoreAll();
  environment(t, OPEN);
  quiet(t);
  sent = mockEmail(t);
  await post({});
  assert.deepEqual(sent[0].body.to, ["info@learnthrivetuition.co.uk"]);
});

test("a filled honeypot is told it worked and nothing is sent", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const response = await post({ website: "http://spam.example" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(sent.length, 0);
});

test("too quick in production is told it worked and nothing is sent; outside production fast is allowed", async (t) => {
  environment(t, PRODUCTION);
  const sent = mockEmail(t);
  quiet(t);
  for (const elapsedMs of [500, libraryConfig.waitlist.minFillMs - 1, undefined]) {
    const response = await post({ elapsedMs });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
  }
  assert.equal(sent.length, 0);
  assert.equal((await post({ elapsedMs: libraryConfig.waitlist.minFillMs })).status, 200);
  assert.equal(sent.length, 2, "the minimum time itself is accepted");

  t.mock.restoreAll();
  environment(t, OPEN);
  quiet(t);
  const dev = mockEmail(t);
  assert.equal((await post({ elapsedMs: 10 })).status, 200);
  assert.equal(dev.length, 2, "outside production a fast submission is real (tests and local use)");
});

test("a request from another origin is refused", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  assert.equal((await post({}, { headers: { origin: "https://evil.example.com" } })).status, 403);
  assert.equal(sent.length, 0);
});

test("the rate limit applies per client, and a global ceiling applies to everyone", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const ip = nextIp();
  const statuses = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await post({}, { ip })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  assert.equal((await post({}, { ip: nextIp() })).status, 200, "another visitor is unaffected");

  const before = sent.length;
  RULES.global.max = 0;
  t.after(() => {
    RULES.global.max = 100_000;
  });
  assert.equal(GLOBAL_MAX, 150);
  const response = await post({}, { ip: nextIp() });
  assert.equal(response.status, 429);
  assert.equal(sent.length, before);
});

test("the human check is required, valid and used once", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const none = await post({ humanCheck: undefined });
  assert.equal(none.status, 400);
  assert.equal((await none.json()).code, "human-check");
  const forged = await post({ humanCheck: { ...humanCheck(), solution: "not-it" } });
  assert.equal(forged.status, 400);
  assert.equal((await forged.json()).code, "human-check");
  assert.equal(sent.length, 0);

  const answer = humanCheck();
  assert.equal((await post({ humanCheck: answer })).status, 200);
  const reused = await post({ humanCheck: answer });
  assert.equal(reused.status, 400);
  assert.equal((await reused.json()).code, "human-check");
  assert.equal(sent.length, 2, "only the first use sent anything");
});

test("the box must be ticked: an unticked or missing consent is refused", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  for (const consent of [false, undefined, "yes", "true", 1, null]) {
    const response = await post({ consent });
    assert.equal(response.status, 422, String(consent));
    const body = await response.json();
    assert.ok(body.errors.consent, String(consent));
    assert.equal(body.errors.email, undefined);
  }
  assert.equal(sent.length, 0);
});

test("a missing, malformed or overlong address is refused with a field error", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const tooLong = `${"a".repeat(libraryConfig.waitlist.emailMaxLength - 11)}@example.com`;
  assert.equal(tooLong.length, libraryConfig.waitlist.emailMaxLength + 1);
  for (const email of ["", "   ", "nope", "a@b", "two words@example.com", "a@@example.com", tooLong, undefined, 42, ["a@example.com"], { email: "a@example.com" }]) {
    const response = await post({ email });
    assert.equal(response.status, 422, JSON.stringify(email));
    assert.ok((await response.json()).errors.email, JSON.stringify(email));
  }
  assert.equal(sent.length, 0);
  assert.equal((await post({ email: `${"a".repeat(libraryConfig.waitlist.emailMaxLength - 12)}@example.com` })).status, 200, "the longest allowed address is accepted");
});

test("markup or control characters in the address cannot reach a subject line or the HTML", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  // Markup is refused at the door ...
  const markup = "<img/src=x/onerror=alert(1)>@example.com";
  assert.equal((await post({ email: markup })).status, 422);
  assert.equal(sent.length, 0);
  // ... and, if the rule were ever loosened, the builders still escape it (defence in depth).
  const built = lib.buildWaitlistEmail({ email: markup, consent: true });
  assert.equal(built.subject, "Library waitlist: new sign-up");
  assert.ok(!built.html.includes("<img"), "the owner email escapes the address");
  assert.ok(built.html.includes("&lt;img/src=x/onerror=alert(1)&gt;@example.com"));
  // Characters that are legal in an address and special in HTML arrive escaped.
  assert.equal((await post({ email: "o'brien&co@example.com" })).status, 200);
  assert.ok(sent[0].body.html.includes("o&#39;brien&amp;co@example.com"));
  assert.ok(!sent[1].body.html.includes("brien"), "the confirmation does not repeat the address");

  const before = sent.length;
  for (const email of ["a@example.com\r\nBcc: attacker@example.com", "a@example.com\nSubject: hijack", "a\u0000@example.com\u2028b"]) {
    await post({ email });
  }
  assert.equal(sent.length, before, "an address with a line break or control character sends nothing");
  for (const { body } of sent) {
    assert.ok(!/[\r\n\u0000]/.test(body.subject), body.subject);
    assert.equal(body.subject.includes("hijack"), false);
    assert.ok(![body.reply_to ?? "", ...body.to].some((address) => /[\r\n\u0000\u2028]/.test(address)), "no control character in an address header");
    assert.equal(JSON.stringify(body.bcc ?? []), "[]");
  }
  assert.ok(sent.length >= before, "the loop only ever sent clean mail");
});

test("an address cannot carry a second recipient, a display name or odd syntax: one recipient, one Reply-To", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const refused = [
    "a@example.com,victim@example.org",
    "a@example.com;victim@example.org",
    "victim@example.org,a@example.com",
    "Name<victim@example.org>",
    "<victim@example.org>",
    '"a b"@example.com',
    "a(comment)@example.com",
    "a@example.com>",
    "a@[127.0.0.1]",
    "a@example",
    "a@example.c",
    "a@-example.com",
    "a@example-.com",
    "a@exa_mple.com",
    "a@example..com",
    ".a@example.com",
    "a.@example.com",
    "a..b@example.com",
    "a@exämple.com",
    "ä@example.com",
    "a\\@example.com",
  ];
  for (const email of refused) {
    const response = await post({ email });
    assert.equal(response.status, 422, email);
    const text = await response.text();
    assert.ok(!text.includes("victim") && !text.includes(email), "the answer does not echo the address");
  }
  assert.equal(sent.length, 0);
  for (const email of ["a@example.com", "first.last+library@sub.example.co.uk", "a_b-c@example.com", "A@Example.COM", "a@xn--p1ai.xn--p1ai"]) {
    assert.equal((await post({ email })).status, 200, email);
  }
  for (const { body } of sent) {
    assert.equal(body.to.length, 1, "one recipient per message");
    assert.ok(!/[,;<>\s]/.test(body.to[0]) && !/[,;<>\s]/.test(body.reply_to), "no list, name or space in an address header");
  }
});

test("no cookie, no stored data and no caching on any answer", async (t) => {
  environment(t, OPEN);
  mockEmail(t);
  quiet(t);
  for (const response of [await post({}), await post({ consent: false }), await post({ website: "x" }), await post({}, { headers: { origin: "https://evil.example.com" } })]) {
    assert.equal(response.headers.get("set-cookie"), null);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  }
});

test("the honeypot catches any value, not only text", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  for (const website of [" x ", 1, true, [], {}, ["x"]]) {
    const response = await post({ website });
    assert.equal(response.status, 200, JSON.stringify(website));
    assert.deepEqual(await response.json(), { success: true });
  }
  assert.equal(sent.length, 0);
  assert.equal((await post({ website: null })).status, 200);
  assert.equal(sent.length, 2, "an empty or absent honeypot is a person");
});

test("a request that fails a guard never spends the human check, and the guards run before any email", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const answer = humanCheck();
  assert.equal((await post({ humanCheck: answer }, { headers: { origin: "https://evil.example.com" } })).status, 403);
  assert.equal((await post({ humanCheck: answer, website: "x" })).status, 200);
  assert.equal(sent.length, 0);
  assert.equal((await post({ humanCheck: answer })).status, 200, "the answer was still unused");
  assert.equal(sent.length, 2);
});

test("a spoofed X-Forwarded-For prefix does not buy a fresh rate-limit bucket", async (t) => {
  environment(t, OPEN);
  mockEmail(t);
  quiet(t);
  const ip = nextIp();
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    const request = new Request(URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${i + 1}, ${ip}, 10.0.0.1` },
      body: JSON.stringify({ website: "", elapsedMs: 60_000, humanCheck: humanCheck(), ...valid }),
    });
    statuses.push((await POST(request)).status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});

test("missing configuration is a friendly 503 that points to the site email", async (t) => {
  environment(t, { CAREERS_OPEN_FOR_TESTING: "1", CAPTCHA_SECRET: SECRET });
  const sent = mockEmail(t);
  quiet(t);
  let response = await post({});
  assert.equal(response.status, 503);
  let body = await response.json();
  assert.equal(body.code, "unavailable");
  assert.match(body.error, /info@learnthrivetuition\.co\.uk/);

  environment(t, { ...PRODUCTION, CAPTCHA_SECRET: undefined });
  response = await post({});
  assert.equal(response.status, 503);
  body = await response.json();
  assert.equal(body.code, "unavailable");
  assert.match(body.error, /info@learnthrivetuition\.co\.uk/);

  environment(t, { NODE_ENV: "production", CAPTCHA_SECRET: SECRET });
  assert.equal((await post({})).status, 503, "production without the email key");

  environment(t, { NODE_ENV: "production", CAPTCHA_SECRET: SECRET, RESEND_API_KEY: "re_live" });
  response = await post({});
  assert.equal(response.status, 503, "production without a verified sender never falls back to the shared one");
  assert.equal((await response.json()).code, "unavailable");

  environment(t, { ...PRODUCTION, CAPTCHA_SECRET: "short" });
  assert.equal((await post({})).status, 503, "a too-short human-check secret fails closed");
  assert.equal(sent.length, 0);
});

test("a failure sending to the owners is a 502 and nothing goes to the person", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t, [500]);
  const lines = quiet(t);
  const response = await post({});
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /info@learnthrivetuition\.co\.uk/);
  assert.equal(sent.length, 1, "the confirmation is not attempted");
  assert.deepEqual(sent[0].body.to, ["info@learnthrivetuition.co.uk"]);
  assert.doesNotMatch(lines.join("\n"), /family|example\.com/);
});

test("a failed confirmation still counts: the owners have the sign-up", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t, [200, 500]);
  const lines = quiet(t);
  const response = await post({});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true });
  assert.equal(sent.length, 2);
  assert.match(lines.join("\n"), /failed/);
});

test("a thrown network error is a generic 500 that leaks nothing", async (t) => {
  environment(t, OPEN);
  const lines = quiet(t);
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed to family@example.com");
  });
  const response = await post({});
  assert.ok(response.status === 502 || response.status === 500);
  assert.doesNotMatch(await response.text(), /family@example\.com/);
  assert.doesNotMatch(lines.join("\n"), /family@example\.com/);
});

test("hostile or oversized bodies are refused", async (t) => {
  environment(t, OPEN);
  const sent = mockEmail(t);
  quiet(t);
  const raw = (body) => new Request(URL, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `${nextIp()}, 10.0.0.1` }, body });
  for (const body of ["not json", "[]", "[{\"email\":\"a@example.com\",\"consent\":true}]", "null", "42", '"text"', "", "{"]) {
    const response = await POST(raw(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(await response.json(), { error: "We could not read that. Please try again." }, "the same plain answer, whatever was wrong");
  }
  assert.equal((await POST(raw(JSON.stringify({ pad: "x".repeat(40_000) })))).status, 413);
  assert.equal(sent.length, 0);
});

test("parseWaitlist: reads only the two fields, cleans the address, and treats junk as empty", () => {
  assert.deepEqual({ ...lib.parseWaitlist({ email: "  a@example.com \r\n", consent: true, website: "x", extra: 1 }) }, { email: "a@example.com", consent: true });
  assert.deepEqual({ ...lib.parseWaitlist(null) }, { email: "", consent: false });
  assert.deepEqual({ ...lib.parseWaitlist("text") }, { email: "", consent: false });
  assert.deepEqual({ ...lib.parseWaitlist({ email: 5, consent: "true" }) }, { email: "", consent: false });
  assert.deepEqual({ ...lib.emptyWaitlist() }, { email: "", consent: false });
});

test("validateWaitlist: needs a valid address and the ticked box", () => {
  assert.deepEqual({ ...lib.validateWaitlist({ email: "a@example.com", consent: true }) }, {});
  const empty = lib.validateWaitlist({ email: "", consent: false });
  assert.match(empty.email, /Enter your email/);
  assert.match(empty.consent, /Tick the box/);
  assert.match(lib.validateWaitlist({ email: "nope", consent: true }).email, /valid email/);
  assert.equal(lib.validateWaitlist({ email: "a@example.com", consent: false }).email, undefined);
  const max = libraryConfig.waitlist.emailMaxLength;
  assert.deepEqual({ ...lib.validateWaitlist({ email: `${"a".repeat(max - 12)}@example.com`, consent: true }) }, {});
  assert.ok(lib.validateWaitlist({ email: `${"a".repeat(max - 11)}@example.com`, consent: true }).email);
});

test("libraryPhase: info unless the value is a known phase; unknown values read as info", () => {
  assert.equal(libraryPhase({}), "info");
  assert.equal(libraryPhase({ LIBRARY_PHASE: "" }), "info");
  assert.equal(libraryPhase({ LIBRARY_PHASE: "info" }), "info");
  assert.equal(libraryPhase({ LIBRARY_PHASE: " Enrolled " }), "enrolled");
  assert.equal(libraryPhase({ LIBRARY_PHASE: "LIVE" }), "live");
  for (const value of ["launched", "beta", "0", "live now", "enrolled,live", "__proto__"]) assert.equal(libraryPhase({ LIBRARY_PHASE: value }), "info", value);
});

test("libraryPrices: a price shows only when set, valid and above zero", () => {
  assert.deepEqual({ ...libraryPrices({}) }, { monthly: null, annual: null });
  assert.deepEqual({ ...libraryPrices({ LIBRARY_PRICE_MONTHLY: "9.99", LIBRARY_PRICE_ANNUAL: "99" }) }, { monthly: "£9.99", annual: "£99" });
  assert.equal(libraryPrices({ LIBRARY_PRICE_ANNUAL: " 99.00 " }).annual, "£99.00");
  assert.equal(libraryPrices({ LIBRARY_PRICE_MONTHLY: "1234.50" }).monthly, "£1234.50");
  for (const bad of ["", "free", "-5", "-0.99", "9.999", "9.9", "9.", ".99", "£9.99", "9,99", "12345", "1e3", "0", "0.00", "00", "NaN", "Infinity", "9.99 a month", "0999", "01.50", "9.99\n9.99", "<b>9</b>", "９９"]) {
    assert.equal(libraryPrices({ LIBRARY_PRICE_MONTHLY: bad }).monthly, null, `"${bad}"`);
  }
  assert.deepEqual({ ...libraryPrices({ LIBRARY_PRICE_MONTHLY: "9.99", LIBRARY_PRICE_ANNUAL: "nope" }) }, { monthly: "£9.99", annual: null });
});
