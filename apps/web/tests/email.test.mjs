import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The shared email helper: configuration is read at request time and fails closed in production, the
// destination falls back in a fixed order, and free text can never break out of the HTML or a subject line.

const email = loadTsFrom(import.meta.url, "../src/lib/email.ts");

test("loading the helper needs no key and constructs no client", () => {
  assert.equal(typeof email.createMailer, "function");
  assert.equal(typeof email.readEmailConfig, "function");
});

test("no key, or a blank key, is not configured", () => {
  assert.deepEqual(email.readEmailConfig({}), { ok: false, reason: "no-api-key" });
  assert.deepEqual(email.readEmailConfig({ RESEND_API_KEY: "   " }), { ok: false, reason: "no-api-key" });
});

test("production needs a verified sender as well as a key; development falls back to Resend's test sender", () => {
  assert.deepEqual(email.readEmailConfig({ NODE_ENV: "production", RESEND_API_KEY: "re_x" }), { ok: false, reason: "incomplete-production-config" });
  assert.deepEqual(email.readEmailConfig({ NODE_ENV: "production", RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: " " }), { ok: false, reason: "incomplete-production-config" });
  assert.deepEqual(email.readEmailConfig({ NODE_ENV: "production", RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: "careers@learnthrivetuition.co.uk" }), {
    ok: true,
    config: { apiKey: "re_x", fromAddress: "careers@learnthrivetuition.co.uk" },
  });
  assert.deepEqual(email.readEmailConfig({ NODE_ENV: "development", RESEND_API_KEY: "re_x" }), {
    ok: true,
    config: { apiKey: "re_x", fromAddress: "onboarding@resend.dev" },
  });
});

test("careers mail goes to CAREERS_EMAIL, then ENQUIRY_EMAIL, then the site address", () => {
  assert.equal(email.destinationFor("careers", { CAREERS_EMAIL: "careers@x.co.uk", ENQUIRY_EMAIL: "enq@x.co.uk" }), "careers@x.co.uk");
  assert.equal(email.destinationFor("careers", { ENQUIRY_EMAIL: "enq@x.co.uk" }), "enq@x.co.uk");
  assert.equal(email.destinationFor("careers", { CAREERS_EMAIL: "  ", ENQUIRY_EMAIL: "" }), "info@learnthrivetuition.co.uk");
  assert.equal(email.destinationFor("careers", {}), "info@learnthrivetuition.co.uk");
});

test("subject requests go to SUBJECT_REQUEST_EMAIL, then ENQUIRY_EMAIL, then the site address", () => {
  assert.equal(email.destinationFor("subject", { SUBJECT_REQUEST_EMAIL: "subjects@x.co.uk", CAREERS_EMAIL: "careers@x.co.uk" }), "subjects@x.co.uk");
  assert.equal(email.destinationFor("subject", { CAREERS_EMAIL: "careers@x.co.uk", ENQUIRY_EMAIL: "enq@x.co.uk" }), "enq@x.co.uk");
  assert.equal(email.destinationFor("subject", {}), "info@learnthrivetuition.co.uk");
});

test("escapeHtml neutralises markup and quotes", () => {
  assert.equal(email.escapeHtml(`<img src=x onerror="alert('1')"> & more`), "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt; &amp; more");
});

test("a subject line never carries a line break, control character or an unbounded length", () => {
  assert.equal(email.subjectSafe("Maths\r\nBcc: evil@example.com"), "Maths Bcc: evil@example.com");
  assert.equal(email.subjectSafe("a\u0000b\u007fc d"), "a b c d");
  assert.equal(email.subjectSafe("  spaced   out  "), "spaced out");
  const long = email.subjectSafe("x".repeat(500));
  assert.equal(long.length, 160);
  assert.ok(long.endsWith("…"));
});

test("tables and paragraphs escape every value and keep line breaks", () => {
  const html = email.htmlTable([["Name", "<b>Jane</b>"], ["Note", "line one\nline two"], ["Empty", "  "]]);
  assert.ok(!html.includes("<b>Jane"));
  assert.match(html, /&lt;b&gt;Jane&lt;\/b&gt;/);
  assert.match(html, /line one<br\/>line two/);
  assert.match(html, />—</);
  assert.equal(email.textTable([["Name", "Jane"], ["Empty", ""]]), "Name: Jane\nEmpty: -");
  assert.ok(!email.htmlParagraph("<script>x</script>").includes("<script>"));
  assert.ok(!email.htmlBanner("<i>x</i>").includes("<i>"));
});

test("the wrapper escapes its preheader and is light-only", () => {
  const html = email.emailWrapper("<p>body</p>", "<b>hidden</b>");
  assert.ok(!html.includes("<b>hidden"));
  assert.match(html, /color-scheme/);
  assert.match(html, /<p>body<\/p>/);
});

test("sendEmail returns a reason and never throws, whatever the provider does", async () => {
  const message = { from: "a@b.co", to: "c@d.co", subject: "s", html: "<p>h</p>", text: "t" };
  assert.deepEqual(await email.sendEmail({ emails: { send: async () => ({ error: null }) } }, message), { ok: true });
  assert.deepEqual(await email.sendEmail({ emails: { send: async () => ({ error: { name: "validation_error" } }) } }, message), { ok: false, reason: "validation_error" });
  assert.deepEqual(await email.sendEmail({ emails: { send: async () => { throw new Error("boom with someone@example.com in it"); } } }, message), { ok: false, reason: "send-threw" });
});

test("attachments are only sent when there are some", async () => {
  const seen = [];
  const mailer = { emails: { send: async (payload) => { seen.push(payload); return { error: null }; } } };
  const base = { from: "a@b.co", to: "c@d.co", subject: "s", html: "h", text: "t" };
  await email.sendEmail(mailer, base);
  await email.sendEmail(mailer, { ...base, attachments: [{ filename: "cv.pdf", content: Buffer.from("x") }] });
  await email.sendEmail(mailer, { ...base, replyTo: "r@e.co" });
  assert.equal("attachments" in seen[0], false);
  assert.equal(seen[1].attachments[0].filename, "cv.pdf");
  assert.equal(seen[2].replyTo, "r@e.co");
  assert.equal(seen[0].from, "LearnThrive Tuition <a@b.co>");
});
