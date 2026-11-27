import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// Who enters a lesson's classroom, and as what (apps/web/src/lib/classroom/lessonEntry.ts): the one rule the lesson page's Join button, the classroom
// page and the reconnect route all use. An administrator who is not the lesson's tutor enters as a SUPERVISOR (docs/CLASSROOM_INTEGRATION.md).

const entry = loadTsFrom(import.meta.url, "../src/lib/classroom/lessonEntry.ts");
const { verifyClassroomJoinToken } = loadTsFrom(import.meta.url, "../../../packages/shared/classroomToken.ts");

const START = Date.parse("2026-12-01T16:00:00Z");
const at = (minutes) => new Date(START + minutes * 60_000);
const lesson = (over = {}) => ({ id: "lesson-1", tutorId: "T1", studentIds: ["S1"], clientIds: ["C1"], startAt: new Date(START).toISOString(), durationMinutes: 60, locationType: "ONLINE", classroomRoomId: "room-abcdefgh", status: "PLANNED", ...over });
const person = (over) => ({ email: "x@example.test", name: "Someone", ...over });
const tutor = person({ id: "acct-tutor", name: "Tara", role: "TUTOR", roles: ["TUTOR"], profileId: "T1", tutorId: "T1" });
const student = person({ id: "acct-student", name: "Sam", role: "STUDENT", roles: ["STUDENT"], profileId: "S1", studentId: "S1" });
const admin = person({ id: "acct-admin", name: "Ada", role: "ADMIN", roles: ["ADMIN"] });
const adminWhoTeachesIt = person({ id: "acct-at", name: "Meera", role: "ADMIN", roles: ["ADMIN", "TUTOR"], tutorId: "T1" });
const otherTutor = person({ id: "acct-t2", name: "Other", role: "TUTOR", roles: ["TUTOR"], profileId: "T2", tutorId: "T2" });
const parent = person({ id: "acct-parent", name: "Pat", role: "CLIENT", roles: ["CLIENT"], profileId: "C1", clientId: "C1" });
const junior = person({ id: "acct-junior", name: "Jo", role: "JUNIOR_TUTOR", roles: ["JUNIOR_TUTOR"], profileId: "T9", tutorId: "T9" });

test("the lesson's tutor enters as its tutor, a student on it as a student, and any other administrator as a supervisor", () => {
  assert.equal(entry.lessonJoinRole(tutor, lesson()), "tutor");
  assert.equal(entry.lessonJoinRole(student, lesson()), "student");
  assert.equal(entry.lessonJoinRole(admin, lesson()), "supervisor");
  assert.equal(entry.lessonJoinRole(adminWhoTeachesIt, lesson()), "tutor", "an administrator who teaches it is its tutor, not a supervisor");
  for (const outsider of [otherTutor, parent, junior]) assert.equal(entry.lessonJoinRole(outsider, lesson()), null);
});

test("a supervisor's signed link names them, their account and the role, for this lesson's room only", () => {
  const result = entry.lessonEntryFor(admin, lesson(), at(5));
  assert.equal(result.ok, true);
  assert.equal(result.role, "supervisor");
  const payload = verifyClassroomJoinToken(result.token);
  assert.deepEqual({ role: payload.role, uid: payload.uid, name: payload.name, roomId: payload.roomId, lessonId: payload.lessonId }, { role: "supervisor", uid: "acct-admin", name: "Ada", roomId: "room-abcdefgh", lessonId: "lesson-1" });
  assert.ok(payload.exp <= at(5).getTime() + 5 * 60_000, "short-lived");
});

test("a supervisor has the tutor's window: from 30 minutes before the start to 30 minutes after the end", () => {
  assert.equal(entry.lessonEntryFor(admin, lesson(), at(-31)).ok, false);
  assert.equal(entry.lessonEntryFor(admin, lesson(), at(-30)).ok, true);
  assert.equal(entry.lessonEntryFor(admin, lesson(), at(90)).ok, true);
  assert.equal(entry.lessonEntryFor(admin, lesson(), at(91)).ok, false);
  // A student has the same window.
  assert.equal(entry.lessonEntryFor(student, lesson(), at(-31)).ok, false);
  assert.equal(entry.lessonEntryFor(student, lesson(), at(-30)).ok, true);
  assert.equal(entry.lessonEntryFor(student, lesson(), at(90)).ok, true);
});

test("nobody enters a cancelled lesson, an in-person lesson or one with no room, a supervisor included", () => {
  for (const bad of [lesson({ status: "CANCELLED" }), lesson({ locationType: "IN_PERSON", classroomRoomId: undefined }), lesson({ classroomRoomId: undefined })]) {
    assert.equal(entry.lessonEntryFor(admin, bad, at(5)).ok, false);
  }
  assert.equal(entry.lessonEntryFor(admin, null, at(5)).ok, false);
  for (const outsider of [otherTutor, parent, junior]) {
    const result = entry.lessonEntryFor(outsider, lesson(), at(5));
    assert.equal(result.ok, false);
    assert.equal(result.message, "You are not assigned to this lesson.");
  }
});
