import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { validApplication } from "./_fixtures.mjs";

// The application's validation, run by the browser for inline errors and by the server as the authority.

const v = loadTsFrom(import.meta.url, "../src/lib/careers-validation.ts");
const { currentAgreement } = loadTsFrom(import.meta.url, "../src/lib/safeguarding-agreement.ts");

const understanding = Object.fromEntries(currentAgreement.understanding.map((q) => [q.id, q.correctOptionId]));
const valid = validApplication;
const context = { agreement: currentAgreement, today: "2026-10-09", understandingRequired: true };


const errors = (overrides = {}, ctx = context) => v.validateApplication({ ...valid(), ...overrides }, ctx);

test("a complete application has no errors", () => {
  assert.deepEqual(errors(), {});
  assert.deepEqual(v.validateApplication(v.parseApplication(valid()), context), {});
});

test("an empty application names every required field", () => {
  const result = v.validateApplication(v.emptyApplication(), context);
  for (const key of [
    "firstName", "lastName", "email", "phone", "town", "over18", "role", "subjects", "yearGroups", "highestQualification",
    "qualificationSubject", "results", "yearsTutoring", "additionalNeeds", "onlineExperience", "times", "hoursPerWeek", "startDate",
    "privateSpace", "rightToWork", "whyTutor", "agreementVersion", "agreedParts", "understanding", "typedName", "declAccurate",
    "declDbs", "declSelfEmployed", "declPrivacy",
  ]) {
    assert.ok(result[key], `${key} should be required`);
  }
  for (const key of ["examBoards", "otherSubjects", "coverLetterText", "stuckLearner", "talentPool", "dbsCertificate", "postgraduate"]) {
    assert.equal(result[key], undefined, `${key} is optional`);
  }
});

test("results: at least one of GCSE, A Level, undergraduate or postgraduate must be filled in", () => {
  assert.ok(errors({ gcse: "" }).results);
  for (const key of ["gcse", "aLevel", "undergraduate", "postgraduate"]) {
    assert.equal(errors({ gcse: "", [key]: "something" }).results, undefined, key);
  }
  assert.ok(errors({ gcse: "x".repeat(601) }).gcse);
});

test("email and phone must look right", () => {
  assert.ok(errors({ email: "nope" }).email);
  assert.ok(errors({ email: "a@b" }).email);
  assert.ok(errors({ phone: "call me" }).phone);
  assert.equal(errors({ phone: "07700 900123" }).phone, undefined);
});

test("the applicant must confirm they are 18 or over", () => {
  assert.match(errors({ over18: false }).over18, /18/);
});

test("the right to work in the UK: yes and not sure continue, no is stopped with an explanation", () => {
  assert.equal(errors({ rightToWork: "yes" }).rightToWork, undefined);
  assert.equal(errors({ rightToWork: "not-sure" }).rightToWork, undefined);
  assert.match(errors({ rightToWork: "no" }).rightToWork, /right to work in the UK/);
  assert.ok(errors({ rightToWork: "maybe" }).rightToWork);
});

test("the role must be an open role; subjects and year groups must come from the lists, once each", () => {
  assert.ok(errors({ role: "astronaut" }).role);
  assert.equal(errors({ role: "register-interest" }).role, undefined);
  assert.ok(errors({ subjects: ["Maths", "Basket weaving"] }).subjects);
  assert.ok(errors({ subjects: ["Maths", "Maths"] }).subjects);
  assert.ok(errors({ yearGroups: ["Year 99"] }).yearGroups);
  assert.ok(errors({ yearGroups: ["Other / not sure"] }).yearGroups, "the enquiry form's catch-all is not a tutoring level");
});

test("every select must hold one of its listed values", () => {
  assert.ok(errors({ highestQualification: "PhD in magic" }).highestQualification);
  assert.ok(errors({ yearsTutoring: "forever" }).yearsTutoring);
  assert.ok(errors({ additionalNeeds: "Loads" }).additionalNeeds);
  assert.ok(errors({ onlineExperience: "Loads" }).onlineExperience);
  assert.ok(errors({ hoursPerWeek: "all of them" }).hoursPerWeek);
  assert.ok(errors({ times: ["Midnight"] }).times);
  assert.ok(errors({ dbsCertificate: "maybe" }).dbsCertificate);
  assert.equal(errors({ dbsCertificate: "in-progress", dbsUpdateService: "not-sure" }).dbsCertificate, undefined);
});

test("the earliest start date: a real date, today or later, within two years", () => {
  assert.ok(errors({ startDate: "" }).startDate);
  assert.ok(errors({ startDate: "2026-02-30" }).startDate);
  assert.ok(errors({ startDate: "next week" }).startDate);
  assert.ok(errors({ startDate: "2026-10-01" }).startDate);
  assert.equal(errors({ startDate: "2026-10-08" }).startDate, undefined, "one day of slack for time zones");
  assert.equal(errors({ startDate: "2026-10-09" }).startDate, undefined);
  assert.equal(errors({ startDate: "2028-10-08" }).startDate, undefined);
  assert.ok(errors({ startDate: "2028-10-10" }).startDate);
});

test("the short answer needs a sensible length and the text boxes have limits", () => {
  assert.match(errors({ whyTutor: "Because." }).whyTutor, /at least 80/);
  assert.ok(errors({ whyTutor: "x".repeat(1501) }).whyTutor);
  assert.ok(errors({ stuckLearner: "x".repeat(1501) }).stuckLearner);
  assert.ok(errors({ coverLetterText: "x".repeat(4001) }).coverLetterText);
  assert.equal(errors({ coverLetterText: "x".repeat(4000) }).coverLetterText, undefined);
  assert.ok(errors({ firstName: "x".repeat(61) }).firstName);
});

test("the safeguarding agreement: current version, every part ticked, all six answers right, name typed exactly", () => {
  assert.ok(errors({ agreementVersion: "0.9" }).agreementVersion);
  assert.match(errors({ agreedParts: ["A", "B", "C"] }).agreedParts, /Part D, Part E, Part F, Part G/);
  assert.ok(errors({ agreedParts: [] }).agreedParts);
  const wrong = { ...understanding, [currentAgreement.understanding[2].id]: "a" };
  assert.ok(errors({ understanding: wrong }).understanding);
  assert.ok(errors({ understanding: {} }).understanding);
  assert.ok(errors({ typedName: "" }).typedName);
  assert.ok(errors({ typedName: "Jane" }).typedName);
  assert.ok(errors({ typedName: "Jane Smyth" }).typedName);
  assert.equal(errors({ typedName: " jane   SMITH " }).typedName, undefined);
});

test("the understanding check can be switched off, and then it is not required", () => {
  assert.equal(errors({ understanding: {} }, { ...context, understandingRequired: false }).understanding, undefined);
});

test("every declaration is required; the talent pool box is optional", () => {
  for (const key of ["declAccurate", "declDbs", "declSelfEmployed", "declPrivacy"]) assert.ok(errors({ [key]: false })[key], key);
  assert.equal(errors({ talentPool: true }).talentPool, undefined);
});

test("parseApplication drops unknown keys, repairs wrong types and removes line breaks from one-line fields", () => {
  const parsed = v.parseApplication({
    firstName: "Jane\r\nBcc: evil@example.com",
    lastName: 42,
    email: ["x"],
    subjects: ["Maths", 7, null, "English"],
    over18: "true",
    privateSpace: true,
    understanding: { a: "b", c: { nested: 1 }, [`k${"x".repeat(80)}`]: "z" },
    gcse: "Line one\r\n\r\n\r\n\r\nLine two\u0000",
    __proto__: { polluted: true },
    unknownField: "x",
  });
  assert.equal(parsed.firstName, "Jane Bcc: evil@example.com");
  assert.equal(parsed.lastName, "");
  assert.equal(parsed.email, "");
  assert.deepEqual(parsed.subjects, ["Maths", "English"]);
  assert.equal(parsed.over18, false, "only a real boolean true counts");
  assert.equal(parsed.privateSpace, true);
  assert.deepEqual(parsed.understanding, { a: "b" });
  assert.equal(parsed.gcse, "Line one\n\nLine two");
  assert.ok(!("unknownField" in parsed));
  assert.deepEqual(v.parseApplication(null), v.emptyApplication());
  assert.deepEqual(v.parseApplication("a string"), v.emptyApplication());
});

test("the choices offered match what the server accepts", () => {
  assert.deepEqual([...v.SUBJECT_CHOICES], ["Maths", "English", "Science", "11+ Preparation"]);
  assert.equal(v.YEAR_GROUP_CHOICES[0], "Year 3");
  assert.equal(v.YEAR_GROUP_CHOICES.at(-1), "Year 13");
  assert.equal(v.YEAR_GROUP_CHOICES.length, 11);
});
