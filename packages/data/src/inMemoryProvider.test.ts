import assert from "node:assert/strict";
import { test } from "node:test";
import { SEED_IDS, getDataProvider, resetDataProvider } from "./inMemoryProvider";

test("seed data: the demo Tutor, Client, and Student exist with the expected fixed ids", async () => {
  const data = getDataProvider();
  const tutor = await data.tutors.get(SEED_IDS.tutorJamiePatel);
  const client = await data.clients.get(SEED_IDS.clientSarahAhmed);
  const student = await data.students.get(SEED_IDS.studentAyaanAhmed);
  assert.equal(tutor?.name, "Jamie Patel");
  assert.equal(client?.name, "Sarah Ahmed");
  assert.equal(student?.name, "Ayaan Ahmed");
});

test("seed data: the demo Client-Student link resolves in both directions", async () => {
  const data = getDataProvider();
  const studentsForClient = await data.students.studentsFor(SEED_IDS.clientSarahAhmed);
  const clientsForStudent = await data.students.clientsFor(SEED_IDS.studentAyaanAhmed);
  assert.deepEqual(studentsForClient.map((s) => s.id), [SEED_IDS.studentAyaanAhmed]);
  assert.deepEqual(clientsForStudent.map((c) => c.id), [SEED_IDS.clientSarahAhmed]);
});

test("seed data: the demo Tuition Assignment links tutor, student, and client together", async () => {
  const data = getDataProvider();
  const forTutor = await data.assignments.forTutor(SEED_IDS.tutorJamiePatel);
  const forStudent = await data.assignments.forStudent(SEED_IDS.studentAyaanAhmed);
  const forClient = await data.assignments.forClient(SEED_IDS.clientSarahAhmed);
  assert.equal(forTutor.length, 1);
  assert.equal(forTutor[0].id, SEED_IDS.assignmentGcseMaths);
  assert.equal(forStudent[0]?.id, SEED_IDS.assignmentGcseMaths);
  assert.equal(forClient[0]?.id, SEED_IDS.assignmentGcseMaths);
});

test("a Student can have more than one Client, and a Client more than one Student (section 14: not a 1:1 model)", async () => {
  const data = getDataProvider();
  const secondClient = await data.clients.create({ name: "Second Parent", email: "second-parent@example.test", active: true });
  const secondStudent = await data.students.create({ name: "Second Student", active: true });

  await data.students.linkClient(secondClient.id, SEED_IDS.studentAyaanAhmed); // shared custody scenario
  await data.students.linkClient(SEED_IDS.clientSarahAhmed, secondStudent.id); // a second child

  const clientsForAyaan = await data.students.clientsFor(SEED_IDS.studentAyaanAhmed);
  const studentsForSarah = await data.students.studentsFor(SEED_IDS.clientSarahAhmed);

  assert.equal(clientsForAyaan.length, 2);
  assert.ok(clientsForAyaan.some((c) => c.id === secondClient.id));
  assert.equal(studentsForSarah.length, 2);
  assert.ok(studentsForSarah.some((s) => s.id === secondStudent.id));

  // Clean up so this test doesn't leak state into others sharing the same singleton provider.
  await data.students.unlinkClient(secondClient.id, SEED_IDS.studentAyaanAhmed);
  await data.students.unlinkClient(SEED_IDS.clientSarahAhmed, secondStudent.id);
});

test("creating a Tutor generates a stable record retrievable by id", async () => {
  const data = getDataProvider();
  const tutor = await data.tutors.create({ name: "New Tutor", email: "new-tutor@example.test", subjects: ["English"], active: true });
  assert.ok(tutor.id);
  assert.ok(tutor.createdAt);
  const fetched = await data.tutors.get(tutor.id);
  assert.equal(fetched?.email, "new-tutor@example.test");
});

test("updating a Tuition Assignment's status preserves its other fields", async () => {
  const data = getDataProvider();
  const updated = await data.assignments.update(SEED_IDS.assignmentGcseMaths, { status: "PAUSED" });
  assert.equal(updated.status, "PAUSED");
  assert.equal(updated.subject, "Mathematics");
  // Restore, since this is the shared singleton other tests read from.
  await data.assignments.update(SEED_IDS.assignmentGcseMaths, { status: "ACTIVE" });
});

// Last in the file deliberately — this wipes every change earlier tests made (including any
// they didn't bother restoring), so nothing after it may depend on prior test state.
test("resetDataProvider: discards anything created beyond the seed scenario, but the seed scenario itself comes back identical (plan section 98)", async () => {
  const before = getDataProvider();
  await before.tutors.create({ name: "Session Clutter Tutor", email: "clutter@example.test", subjects: ["Art"], active: true });
  const clutteredTutors = await before.tutors.list();
  assert.ok(clutteredTutors.length > 1);

  const after = resetDataProvider();
  assert.equal(after, getDataProvider()); // the singleton itself was replaced, not just its contents

  const tutorsAfterReset = await after.tutors.list();
  assert.equal(tutorsAfterReset.length, 1);
  assert.equal(tutorsAfterReset[0].id, SEED_IDS.tutorJamiePatel); // same fixed id, not a new random one

  const assignment = await after.assignments.get(SEED_IDS.assignmentGcseMaths);
  assert.equal(assignment?.status, "ACTIVE"); // the seed scenario's own default, not whatever an earlier test left it as
});
