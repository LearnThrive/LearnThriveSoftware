import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// plan15 Wave 11 section 15.2: the app palette's search must never find, name or link to anything the
// person could not already open. These are adversarial: they plant data a given role must not see and
// search for exactly that.

const { getDataProvider } = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");
const { searchApp, MAX_RESULTS, MAX_QUERY_LENGTH } = loadTsFrom(import.meta.url, "../src/lib/search/appSearch.ts");

const unique = () => crypto.randomUUID().slice(0, 8);

/**
 * Two families, two tutors:
 *   Tutor A teaches Student A (parent: Client A); Tutor B teaches Student B (parent: Client B).
 * Student A's lesson has an APPROVED report with a CONFIDENTIAL internal note;
 * Student B's lesson has a SUBMITTED (not yet approved) report and a DRAFT lesson report exists too.
 */
async function world() {
  const data = getDataProvider();
  const tag = unique();
  const tutorA = await data.tutors.create({ name: `Alder Tutor ${tag}`, email: `alder-${tag}@example.test`, subjects: ["Maths"], active: true });
  const tutorB = await data.tutors.create({ name: `Birch Tutor ${tag}`, email: `birch-${tag}@example.test`, subjects: ["English"], active: true });
  const studentA = await data.students.create({ name: `Anya Alpha ${tag}`, yearGroup: "Year 8", active: true });
  const studentB = await data.students.create({ name: `Bruno Bravo ${tag}`, yearGroup: "Year 9", active: true });
  const clientA = await data.clients.create({ name: `Parent Alpha ${tag}`, email: `parent-a-${tag}@example.test`, active: true });
  const clientB = await data.clients.create({ name: `Parent Bravo ${tag}`, email: `parent-b-${tag}@example.test`, active: true });
  await data.students.linkClient(clientA.id, studentA.id);
  await data.students.linkClient(clientB.id, studentB.id);

  const makeLesson = async (tutor, student, client, title, subject) => {
    const assignment = await data.assignments.create({ title, subject, tutorId: tutor.id, studentIds: [student.id], clientIds: [client.id], status: "ACTIVE" });
    return data.lessons.create({
      assignmentId: assignment.id, tutorId: tutor.id, studentIds: [student.id], clientIds: [client.id], title, subject,
      startAt: "2026-11-03T16:00:00.000Z", durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status: "PLANNED",
    });
  };
  const lessonA = await makeLesson(tutorA, studentA, clientA, `Fractions ${tag}`, "Maths");
  const lessonB = await makeLesson(tutorB, studentB, clientB, `Poetry ${tag}`, "English");

  const reportA = await data.reports.create({
    lessonId: lessonA.id, tutorId: tutorA.id, status: "APPROVED", publicSummary: `Covered equivalent fractions ${tag}`,
    internalTutorNotes: `CONFIDENTIAL zebrafish ${tag}`, submittedAt: "2026-11-03T18:00:00.000Z", approvedAt: "2026-11-04T09:00:00.000Z",
  });
  const reportB = await data.reports.create({
    lessonId: lessonB.id, tutorId: tutorB.id, status: "SUBMITTED", publicSummary: `Unapproved sonnet analysis ${tag}`,
    internalTutorNotes: `CONFIDENTIAL walrus ${tag}`, submittedAt: "2026-11-03T18:00:00.000Z",
  });

  const user = (role, profileId, name) => ({ id: `u-${role}-${profileId}`, email: `${role}@example.test`, role, name, profileId });
  return {
    data, tag, tutorA, tutorB, studentA, studentB, clientA, clientB, lessonA, lessonB, reportA, reportB,
    admin: user("ADMIN", undefined, "Admin"),
    tutorAUser: user("TUTOR", tutorA.id, tutorA.name),
    tutorBUser: user("TUTOR", tutorB.id, tutorB.name),
    clientAUser: user("CLIENT", clientA.id, clientA.name),
    clientBUser: user("CLIENT", clientB.id, clientB.name),
    studentAUser: user("STUDENT", studentA.id, studentA.name),
    studentBUser: user("STUDENT", studentB.id, studentB.name),
  };
}

const ids = (results) => results.map((r) => r.id);
const serialised = (results) => JSON.stringify(results);

test("a query that is too short, not a string, or empty finds nothing", async () => {
  const w = await world();
  for (const q of ["", " ", "a", undefined, null, 42, {}, ["fractions"]]) {
    assert.deepEqual(await searchApp(w.data, w.admin, q), [], String(q));
  }
});

test("an Admin finds lessons, students, clients, tutors and reports", async () => {
  const w = await world();
  assert.ok(ids(await searchApp(w.data, w.admin, `Fractions ${w.tag}`)).includes(w.lessonA.id));
  assert.ok(ids(await searchApp(w.data, w.admin, `Anya Alpha ${w.tag}`)).includes(w.studentA.id));
  assert.ok(ids(await searchApp(w.data, w.admin, `Parent Bravo ${w.tag}`)).includes(w.clientB.id));
  assert.ok(ids(await searchApp(w.data, w.admin, `Birch Tutor ${w.tag}`)).includes(w.tutorB.id));
  assert.ok(ids(await searchApp(w.data, w.admin, `equivalent fractions ${w.tag}`)).includes(w.reportA.id));
  // Links go to the Admin's own detail pages.
  const [student] = (await searchApp(w.data, w.admin, `Anya Alpha ${w.tag}`)).filter((r) => r.kind === "student");
  assert.equal(student.href, `/dashboard/admin/students/${w.studentA.id}`);
});

test("a Tutor finds their own students and lessons, and never another tutor's", async () => {
  const w = await world();
  assert.ok(ids(await searchApp(w.data, w.tutorAUser, `Anya Alpha ${w.tag}`)).includes(w.studentA.id));
  assert.ok(ids(await searchApp(w.data, w.tutorAUser, `Fractions ${w.tag}`)).includes(w.lessonA.id));
  for (const q of [`Bruno Bravo ${w.tag}`, `Poetry ${w.tag}`, `Bravo ${w.tag}`, `sonnet ${w.tag}`, `Birch Tutor ${w.tag}`]) {
    const found = await searchApp(w.data, w.tutorAUser, q);
    assert.ok(!ids(found).some((id) => [w.studentB.id, w.lessonB.id, w.reportB.id, w.tutorB.id].includes(id)), `Tutor A found something of Tutor B's for "${q}"`);
  }
});

test("a Tutor cannot search for people the Admin pages hold: other tutors and clients", async () => {
  const w = await world();
  for (const q of [`Birch Tutor ${w.tag}`, `Alder Tutor ${w.tag}`, `Parent Alpha ${w.tag}`, `parent-a-${w.tag}`]) {
    const kinds = (await searchApp(w.data, w.tutorAUser, q)).map((r) => r.kind);
    assert.ok(!kinds.includes("tutor") && !kinds.includes("client"), `Tutor got a tutor/client result for "${q}"`);
  }
});

test("a Parent finds their own child, lesson and approved report, and nothing of another family's", async () => {
  const w = await world();
  assert.ok(ids(await searchApp(w.data, w.clientAUser, `Anya Alpha ${w.tag}`)).includes(w.studentA.id));
  assert.ok(ids(await searchApp(w.data, w.clientAUser, `Fractions ${w.tag}`)).includes(w.lessonA.id));
  assert.ok(ids(await searchApp(w.data, w.clientAUser, `equivalent fractions ${w.tag}`)).includes(w.reportA.id));
  for (const q of [`Bruno Bravo ${w.tag}`, `Poetry ${w.tag}`, `Parent Bravo ${w.tag}`, `Birch ${w.tag}`, `parent-b-${w.tag}`]) {
    const found = await searchApp(w.data, w.clientAUser, q);
    assert.ok(!ids(found).some((id) => [w.studentB.id, w.lessonB.id, w.reportB.id, w.clientB.id, w.tutorB.id].includes(id)), `Parent A found family B's record for "${q}"`);
    assert.ok(!found.some((r) => /Bruno|Poetry|Bravo/.test(`${r.title} ${r.subtitle ?? ""}`)), `a result leaked family B's names for "${q}"`);
  }
});

test("a Parent never finds a report that is not approved, by its text, its title or its status", async () => {
  const w = await world();
  // Move family A's report back to SUBMITTED: it must vanish from the parent's results at once.
  await w.data.reports.update(w.reportA.id, { status: "SUBMITTED" });
  const found = await searchApp(w.data, w.clientAUser, `equivalent fractions ${w.tag}`);
  assert.ok(!ids(found).includes(w.reportA.id), "a submitted-but-unapproved report was found by a Parent");
  const byStatus = await searchApp(w.data, w.clientAUser, "Awaiting approval");
  assert.ok(!byStatus.some((r) => r.kind === "report" && r.id === w.reportA.id));
  await w.data.reports.update(w.reportA.id, { status: "DRAFT" });
  assert.ok(!ids(await searchApp(w.data, w.clientAUser, `equivalent fractions ${w.tag}`)).includes(w.reportA.id), "a draft was found by a Parent");
});

test("nobody can find a report by a private tutor note: not the Parent, not the Student, not even the Tutor or Admin", async () => {
  const w = await world();
  for (const who of [w.clientAUser, w.studentAUser, w.tutorAUser, w.admin]) {
    for (const q of [`zebrafish ${w.tag}`, `CONFIDENTIAL zebrafish ${w.tag}`, "CONFIDENTIAL", `walrus ${w.tag}`]) {
      const found = await searchApp(w.data, who, q);
      assert.ok(!found.some((r) => r.kind === "report"), `${who.role} matched a report on a private note for "${q}"`);
      assert.doesNotMatch(serialised(found), /zebrafish|walrus/i, "a private note's text appeared in results");
    }
  }
});

test("a Student finds their own lessons and approved reports, and no people at all", async () => {
  const w = await world();
  const own = await searchApp(w.data, w.studentAUser, `Fractions ${w.tag}`);
  assert.ok(ids(own).includes(w.lessonA.id));
  assert.ok(ids(await searchApp(w.data, w.studentAUser, `equivalent fractions ${w.tag}`)).includes(w.reportA.id));
  for (const q of [`Anya Alpha ${w.tag}`, `Bruno Bravo ${w.tag}`, `Parent Alpha ${w.tag}`, `Alder Tutor ${w.tag}`, "Year 8"]) {
    const kinds = (await searchApp(w.data, w.studentAUser, q)).map((r) => r.kind);
    assert.ok(!kinds.some((k) => k === "student" || k === "client" || k === "tutor"), `a Student got a people result for "${q}"`);
  }
  assert.ok(!ids(await searchApp(w.data, w.studentAUser, `Poetry ${w.tag}`)).includes(w.lessonB.id));
});

test("a role without a linked profile finds nothing rather than everything", async () => {
  const w = await world();
  for (const role of ["TUTOR", "CLIENT", "STUDENT"]) {
    const orphan = { id: `orphan-${role}`, email: "o@example.test", role, name: "Orphan" };
    assert.deepEqual(await searchApp(w.data, orphan, w.tag), [], role);
  }
});

test("a forged role or profile id in the query text does nothing: only the session's user counts", async () => {
  const w = await world();
  const found = await searchApp(w.data, w.clientAUser, `role:ADMIN profileId:${w.clientB.id} Bruno Bravo ${w.tag}`);
  assert.deepEqual(found, []);
});

test("results carry display strings and a route only: no report text, no notes, no extra fields", async () => {
  const w = await world();
  const found = await searchApp(w.data, w.admin, `equivalent fractions ${w.tag}`);
  assert.ok(found.length > 0);
  for (const result of found) {
    assert.deepEqual(Object.keys(result).sort(), ["href", "id", "kind", "subtitle", "title"].filter((k) => k in result).sort());
    assert.match(result.href, /^\/dashboard\//);
  }
  assert.doesNotMatch(serialised(found), /Covered equivalent fractions|zebrafish/, "the report's own text must not be echoed");
});

test("the result count and the query length are bounded", async () => {
  const w = await world();
  assert.ok((await searchApp(w.data, w.admin, w.tag)).length <= MAX_RESULTS);
  const huge = "a".repeat(MAX_QUERY_LENGTH * 50);
  assert.ok((await searchApp(w.data, w.admin, huge)).length <= MAX_RESULTS);
});

test("a result's route is one the role can open: Admin detail pages for Admin, list pages for others", async () => {
  const w = await world();
  for (const r of await searchApp(w.data, w.tutorAUser, `Anya ${w.tag}`)) {
    assert.ok(!r.href.startsWith("/dashboard/admin/"), `a Tutor was linked to an Admin page: ${r.href}`);
  }
  for (const r of await searchApp(w.data, w.clientAUser, `Anya ${w.tag}`)) {
    assert.ok(!r.href.startsWith("/dashboard/admin/"), `a Parent was linked to an Admin page: ${r.href}`);
  }
});
