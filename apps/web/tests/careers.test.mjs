import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The careers data and its gates: who can apply and when, the roles and their terms, the JobPosting markup,
// and the public words the owners ruled out.

const { agreementOpen, applicationsOpen, careersConfig, previewOpen } = loadTsFrom(import.meta.url, "../src/lib/careers-config.ts");
const { GENERAL_ROLE_SLUG, careerRoles, getRole, openRoles, openVacancies } = loadTsFrom(import.meta.url, "../src/lib/careers.ts");
const { jobPostingData } = loadTsFrom(import.meta.url, "../src/lib/careers-jobposting.ts");

// ── gates ────────────────────────────────────────────────────────────────────────────────────────────

test("the preview gate opens only outside production, and only when asked for with exactly 1", () => {
  assert.equal(previewOpen({ NODE_ENV: "development", CAREERS_OPEN_FOR_TESTING: "1" }), true);
  assert.equal(previewOpen({ NODE_ENV: "test", CAREERS_OPEN_FOR_TESTING: "1" }), true);
  assert.equal(previewOpen({ NODE_ENV: "production", CAREERS_OPEN_FOR_TESTING: "1" }), false);
  assert.equal(previewOpen({ NODE_ENV: "development" }), false);
  assert.equal(previewOpen({ NODE_ENV: "development", CAREERS_OPEN_FOR_TESTING: "true" }), false);
});

test("applications follow the owner's approval in production, and the preview gate only in development", () => {
  const production = { NODE_ENV: "production", CAREERS_OPEN_FOR_TESTING: "1" };
  assert.equal(agreementOpen(production), careersConfig.agreementApprovedByOwner, "the variable cannot open a production build");
  assert.equal(applicationsOpen(production), careersConfig.acceptingApplications && careersConfig.agreementApprovedByOwner);
  const development = { NODE_ENV: "development", CAREERS_OPEN_FOR_TESTING: "1" };
  assert.equal(agreementOpen(development), true);
  assert.equal(applicationsOpen(development), careersConfig.acceptingApplications);
  assert.equal(applicationsOpen({ NODE_ENV: "development" }), careersConfig.acceptingApplications && careersConfig.agreementApprovedByOwner);
});

// ── roles ────────────────────────────────────────────────────────────────────────────────────────────

test("there are four real vacancies and one register-your-interest option, each with its own slug", () => {
  assert.deepEqual(careerRoles.filter((role) => role.kind === "vacancy").map((role) => role.slug), ["maths-tutor", "english-tutor", "science-tutor", "11-plus-tutor"]);
  assert.deepEqual(careerRoles.filter((role) => role.kind === "general").map((role) => role.slug), [GENERAL_ROLE_SLUG]);
  assert.equal(new Set(careerRoles.map((role) => role.slug)).size, careerRoles.length);
  assert.equal(getRole("maths-tutor").title, "Maths Tutor");
  assert.equal(getRole("nope"), undefined);
  assert.ok(openVacancies().every((role) => role.kind === "vacancy"));
  assert.ok(openRoles().length >= openVacancies().length);
});

test("every role states the confirmed terms: self-employed, online and one to one, £10 an hour per student, hours by availability", () => {
  for (const role of careerRoles) {
    assert.equal(role.employmentType, "Self-employed", role.slug);
    assert.match(role.location, /Online, one to one/, role.slug);
    assert.equal(role.pay, "£10 an hour per student.", role.slug);
    assert.equal(role.hours, "Hours depend on student availability.", role.slug);
  }
});

// ── JobPosting ───────────────────────────────────────────────────────────────────────────────────────

const vacancy = { ...getRole("maths-tutor"), postedDate: "2026-10-01" };
const open = { applicationsOpen: true, today: "2026-10-09" };

test("a job posting is made only for an open, real vacancy with a confirmed date, while applications are open", () => {
  assert.ok(jobPostingData(vacancy, open));
  assert.equal(jobPostingData(getRole("maths-tutor"), open), null, "a role with no confirmed date has no posting");
  assert.equal(jobPostingData(vacancy, { ...open, applicationsOpen: false }), null, "applications are closed");
  assert.equal(jobPostingData({ ...vacancy, status: "closed" }, open), null);
  assert.equal(jobPostingData({ ...vacancy, status: "coming-soon" }, open), null);
  assert.equal(jobPostingData({ ...getRole(GENERAL_ROLE_SLUG), postedDate: "2026-10-01" }, open), null, "the register-your-interest option is never a posting");
  assert.equal(jobPostingData({ ...vacancy, closingDate: "2026-10-08" }, open), null, "the closing date has passed");
  assert.ok(jobPostingData({ ...vacancy, closingDate: "2026-10-09" }, open), "the closing day itself is still open");
});

test("the posting says only what the page says", () => {
  const posting = jobPostingData({ ...vacancy, closingDate: "2026-11-30" }, open);
  assert.equal(posting["@context"], "https://schema.org");
  assert.equal(posting["@type"], "JobPosting");
  assert.equal(posting.title, "Maths Tutor");
  assert.equal(posting.datePosted, "2026-10-01");
  assert.equal(posting.validThrough, "2026-11-30T23:59:59+00:00");
  assert.equal(posting.employmentType, "CONTRACTOR");
  assert.equal(posting.jobLocationType, "TELECOMMUTE");
  assert.equal(posting.directApply, true);
  assert.equal(posting.baseSalary.currency, "GBP");
  assert.equal(posting.baseSalary.value.value, 10);
  assert.equal(posting.baseSalary.value.unitText, "HOUR");
  assert.match(posting.url, /\/careers\/maths-tutor$/);
  assert.match(posting.description, /£10 an hour per student/);
  assert.match(posting.description, /Hours depend on student availability/);
  assert.equal(jobPostingData(vacancy, open).validThrough, undefined, "no closing date, no validThrough");
});

test("text that reaches the posting's description is escaped", () => {
  const posting = jobPostingData({ ...vacancy, summary: 'Teach <b>& "more"</b>' }, open);
  assert.match(posting.description, /&lt;b&gt;/);
  assert.doesNotMatch(posting.description, /<b>/);
});

// ── words the owners ruled out ───────────────────────────────────────────────────────────────────────

const srcDir = resolve(import.meta.dirname, "..", "src");
function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx)$/.test(name) ? [full] : [];
  });
}

test("no page, form, email or comment mentions refresher training or induction, or names Google as a provider", () => {
  // Owner decisions: no induction or refresher training is promised anywhere, and the company mailbox is IONOS.
  const ruledOut = /\b(?:refresher|induction)\b|google (?:workspace|meet|drive|docs|sheets)/i;
  for (const file of sourceFiles(srcDir)) {
    assert.doesNotMatch(readFileSync(file, "utf8"), ruledOut, relative(srcDir, file).replaceAll("\\", "/"));
  }
});
