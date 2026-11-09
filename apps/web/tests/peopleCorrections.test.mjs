import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// docs/improvement/PLAN.md item 5: a wrong record can be put right, by an administrator only, and the correction is audited by field
// name. The audit storage is proven in packages/data (correctionsAudit.test.ts); this is the rule that decides what changes.

const { studentCorrection, tutorCorrection } = loadTsFrom(import.meta.url, "../src/lib/people/corrections.ts");

test("a student's correction names exactly the fields that changed", () => {
  const current = { name: "Sam", yearGroup: "Year 9" };
  assert.deepEqual(studentCorrection(current, { name: "  Samir ", yearGroup: "Year 9" }), { ok: true, patch: { name: "Samir" }, fields: ["name"] });
  assert.deepEqual(studentCorrection(current, { name: "Sam", yearGroup: "Year 10" }), { ok: true, patch: { yearGroup: "Year 10" }, fields: ["yearGroup"] });
  assert.deepEqual(studentCorrection(current, { name: "Sam", yearGroup: "Year 9" }), { ok: true, patch: {}, fields: [] }, "nothing changed: nothing to write or audit");
  assert.deepEqual(studentCorrection({ name: "Sam" }, { name: "Sam", yearGroup: "" }), { ok: true, patch: {}, fields: [] }, "an unset year group and an empty box are the same thing");
  assert.deepEqual(studentCorrection(current, { name: "Sam", yearGroup: "" }).fields, ["yearGroup"], "a year group can be cleared");
});

test("a student's correction is refused where the database would refuse it", () => {
  const current = { name: "Sam", yearGroup: "Year 9" };
  assert.equal(studentCorrection(current, { name: "   ", yearGroup: "" }).ok, false);
  assert.equal(studentCorrection(current, { name: "x".repeat(81), yearGroup: "" }).ok, false);
  assert.equal(studentCorrection(current, { name: "x".repeat(80), yearGroup: "" }).ok, true);
  assert.equal(studentCorrection(current, { name: "Sam", yearGroup: "y".repeat(41) }).ok, false);
});

test("a tutor's correction: name, contact email and subjects, each validated", () => {
  const current = { name: "Alex Tutor", email: "alex@example.test", subjects: ["Maths", "Physics"] };
  assert.deepEqual(tutorCorrection(current, { name: "Alex Tutor", email: "ALEX@example.test", subjects: "Maths, Physics" }), { ok: true, patch: {}, fields: [] }, "case and spacing are not a change");
  const changed = tutorCorrection(current, { name: "Alex  Q Tutor", email: "new@example.test", subjects: "Maths, Maths, Chemistry , " });
  assert.deepEqual(changed, { ok: true, patch: { name: "Alex Q Tutor", email: "new@example.test", subjects: ["Maths", "Chemistry"] }, fields: ["name", "email", "subjects"] });
  assert.equal(tutorCorrection(current, { name: "", email: "alex@example.test", subjects: "" }).ok, false);
  assert.equal(tutorCorrection(current, { name: "Alex", email: "not an address", subjects: "" }).ok, false);
  assert.equal(tutorCorrection(current, { name: "Alex", email: "a@example.test, b@example.test", subjects: "" }).ok, false, "one address, not a list");
  assert.equal(tutorCorrection(current, { name: "Alex", email: "alex@example.test", subjects: Array.from({ length: 21 }, (_, i) => `S${i}`).join(",") }).ok, false);
});

test("both correction actions check for an administrator first and audit field names, never values", () => {
  const code = readFileSync(new URL("../src/lib/actions/people.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  for (const name of ["updateStudentAction", "updateTutorAction"]) {
    const start = code.indexOf(`export async function ${name}(`);
    assert.ok(start > 0, `${name} exists`);
    const body = code.slice(start, code.indexOf("\n}\n", start));
    const firstLine = body.split("\n")[1];
    assert.match(firstLine, /const admin = await requireRole\(\["ADMIN"\]\);/, `${name} starts with the administrator check`);
    assert.match(body, /recordAudit\(\{ actor: admin\.id, action: "(student|tutor)_details_changed"/, `${name} writes an audit entry`);
    assert.match(body, /fields: change\.fields/, "the audit carries which fields changed");
    const auditCall = body.slice(body.indexOf("recordAudit("), body.indexOf(");", body.indexOf("recordAudit(")));
    assert.doesNotMatch(auditCall, /change\.patch|text\(formData|\.name|\.email/, "and never the old or the new value");
    assert.ok(body.indexOf(".update(id, change.patch)") < body.indexOf("recordAudit"), "audited only after the change is made");
  }
});
