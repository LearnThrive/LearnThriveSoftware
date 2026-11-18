import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// Staff meetings (docs/STAFF_MEETINGS.md): who may enter one, and when. These are the rules every door (the Join button, the room page) asks.

const { decideEntry, isStaff } = loadTsFrom(import.meta.url, "../src/lib/meetings/rules.ts");
const { navigationFor } = loadTsFrom(import.meta.url, "../src/lib/navigation/appNavigation.ts");

const host = { id: "host-1", role: "ADMIN", roles: ["ADMIN"], name: "Host", email: "h@example.test" };
const tutor = { id: "tutor-login", role: "TUTOR", roles: ["TUTOR"], profileId: "tutor-1", name: "Tutor", email: "t@example.test" };
const outsiderTutor = { ...tutor, id: "other-login", profileId: "tutor-2" };
const adminWhoTeaches = { id: "admin-2", role: "ADMIN", roles: ["ADMIN", "TUTOR"], profileId: "admin-2", tutorId: "tutor-3", name: "Admin", email: "a@example.test" };
const parent = { id: "parent-login", role: "CLIENT", roles: ["CLIENT"], profileId: "client-1", name: "Parent", email: "p@example.test" };
const learner = { id: "learner-login", role: "STUDENT", roles: ["STUDENT"], profileId: "student-1", name: "Learner", email: "l@example.test" };

const START = "2026-12-01T10:00:00.000Z";
const at = (iso) => new Date(iso);
const meeting = (over = {}) => ({
  id: "m1", title: "Catch-up", startsAt: START, durationMinutes: 60, roomId: "room-abcdefgh", hostId: host.id, hostName: "Host",
  invitees: [{ id: tutor.id, name: "Tutor" }, { id: parent.id, name: "Parent" }, { id: learner.id, name: "Learner" }], createdAt: START, cancelledAt: null, ...over,
});

const juniorWhoIsAStudent = { id: "junior-login", role: "JUNIOR_TUTOR", roles: ["STUDENT", "JUNIOR_TUTOR"], profileId: "tutor-9", tutorId: "tutor-9", studentId: "student-9", name: "Junior", email: "j@example.test" };
const tutorWhoIsAParent = { id: "tp-login", role: "TUTOR", roles: ["TUTOR", "CLIENT"], profileId: "tutor-8", tutorId: "tutor-8", clientId: "client-8", name: "Tutor parent", email: "tp@example.test" };

test("staff are administrators and anyone who teaches, nobody else", () => {
  assert.equal(isStaff(host), true);
  assert.equal(isStaff(tutor), true);
  assert.equal(isStaff(adminWhoTeaches), true);
  assert.equal(isStaff(tutorWhoIsAParent), true, "a tutor who is also a parent is an adult colleague");
  assert.equal(isStaff(parent), false);
  assert.equal(isStaff(learner), false);
});

test("anyone who also holds the Student role is left out, even if they teach: a learner may be under 18", () => {
  assert.equal(isStaff(juniorWhoIsAStudent), false);
  assert.equal(isStaff({ ...tutor, roles: ["TUTOR", "STUDENT"] }), false);
  const decision = decideEntry(juniorWhoIsAStudent, meeting({ invitees: [{ id: juniorWhoIsAStudent.id, name: "Junior" }] }), at(START));
  assert.equal(decision.ok, false);
});

test("the host and an invited tutor enter inside the window, as host and as invitee", () => {
  assert.deepEqual(decideEntry(host, meeting(), at(START)), { ok: true, role: "HOST" });
  assert.deepEqual(decideEntry(tutor, meeting(), at(START)), { ok: true, role: "INVITEE" });
});

test("the window: the host from 30 minutes before, an invitee from 10, both until 30 minutes after the end", () => {
  assert.equal(decideEntry(host, meeting(), at("2026-12-01T09:29:00.000Z")).ok, false);
  assert.equal(decideEntry(host, meeting(), at("2026-12-01T09:31:00.000Z")).ok, true);
  assert.equal(decideEntry(tutor, meeting(), at("2026-12-01T09:49:00.000Z")).ok, false);
  assert.equal(decideEntry(tutor, meeting(), at("2026-12-01T09:51:00.000Z")).ok, true);
  assert.equal(decideEntry(tutor, meeting(), at("2026-12-01T11:29:00.000Z")).ok, true);
  assert.equal(decideEntry(tutor, meeting(), at("2026-12-01T11:31:00.000Z")).ok, false);
});

test("a tutor who was not invited cannot enter, and neither can an administrator who is not the host or invited", () => {
  assert.equal(decideEntry(outsiderTutor, meeting(), at(START)).ok, false);
  const refused = decideEntry({ ...host, id: "other-admin" }, meeting(), at(START));
  assert.equal(refused.ok, false);
  assert.match(refused.message, /not invited/);
});

test("a parent or a learner cannot enter, even if they were somehow on the invitation", () => {
  for (const person of [parent, learner]) {
    const decision = decideEntry(person, meeting(), at(START));
    assert.equal(decision.ok, false);
    assert.match(decision.message, /administrators and tutors/);
  }
});

test("a cancelled meeting and a missing one admit nobody", () => {
  assert.equal(decideEntry(host, meeting({ cancelledAt: START }), at(START)).ok, false);
  assert.equal(decideEntry(host, null, at(START)).ok, false);
});

test("the menu has Meetings for administrators and tutors and not for families or learners", () => {
  const has = (role) => navigationFor(role).some((s) => s.items.some((i) => i.href === "/dashboard/meetings"));
  assert.equal(has("ADMIN"), true);
  assert.equal(has("TUTOR"), true);
  assert.equal(has("JUNIOR_TUTOR"), true);
  assert.equal(has("CLIENT"), false);
  assert.equal(has("STUDENT"), false);
});
