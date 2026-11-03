import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// "Teaches" is a capability, not a role (docs/ROLE_PERMISSIONS.md): three of the four launch accounts are administrators who teach, and the
// fourth must never look like a tutor. Every guard asks these functions, so the rules are proved here once.

const { asTutor, joinRoleFor, teaches, teachesLesson, teachingTutorId } = loadTsFrom(import.meta.url, "../src/lib/auth/teaching.ts");
const { navigationFor, platformNavigation } = loadTsFrom(import.meta.url, "../src/lib/navigation/appNavigation.ts");
const { goToTargetsFor } = loadTsFrom(import.meta.url, "../src/lib/palette/appShortcuts.ts");
const { toPlatformUser } = loadTsFrom(import.meta.url, "../src/lib/access/platformUser.ts");

const tutor = { id: "a", role: "TUTOR", profileId: "tutor-1", name: "T", email: "t@example.test" };
const adminWhoTeaches = { id: "b", role: "ADMIN", profileId: "tutor-2", tutorId: "tutor-2", name: "A", email: "a@example.test" };
const adminOnly = { id: "c", role: "ADMIN", profileId: "c", name: "B", email: "b@example.test" };
const family = { id: "d", role: "CLIENT", profileId: "client-1", name: "C", email: "c@example.test" };
const learner = { id: "e", role: "STUDENT", profileId: "student-1", name: "L", email: "l@example.test" };

const lessonOf = (tutorId) => ({ tutorId, studentIds: ["student-1"], clientIds: ["client-1"] });

test("who teaches: a tutor and an administrator with a tutor record, and nobody else", () => {
  assert.equal(teachingTutorId(tutor), "tutor-1");
  assert.equal(teachingTutorId(adminWhoTeaches), "tutor-2");
  for (const nobody of [adminOnly, family, learner]) {
    assert.equal(teachingTutorId(nobody), null);
    assert.equal(teaches(nobody), false);
  }
  assert.equal(teachingTutorId({ role: "CLIENT", profileId: "x", tutorId: "tutor-9" }), null, "a stray tutorId on a family account gives nothing");
  assert.equal(teachingTutorId({ role: "TUTOR" }), null, "a tutor with no linked record teaches nothing");
});

test("whose lesson it is: being an administrator is not enough", () => {
  assert.equal(teachesLesson(adminWhoTeaches, lessonOf("tutor-2")), true);
  assert.equal(teachesLesson(adminWhoTeaches, lessonOf("tutor-1")), false, "someone else's lesson: they act as an administrator, not its tutor");
  assert.equal(teachesLesson(adminOnly, lessonOf("c")), false, "an administrator's own id never matches as a tutor");
  assert.equal(teachesLesson(tutor, lessonOf("tutor-2")), false);
});

test("joining a classroom: the lesson's tutor and its own students, and no other administrator", () => {
  assert.equal(joinRoleFor(tutor, lessonOf("tutor-1")), "TUTOR");
  assert.equal(joinRoleFor(adminWhoTeaches, lessonOf("tutor-2")), "TUTOR");
  assert.equal(joinRoleFor(adminWhoTeaches, lessonOf("tutor-1")), null);
  assert.equal(joinRoleFor(adminOnly, lessonOf("tutor-1")), null);
  assert.equal(joinRoleFor(learner, lessonOf("tutor-1")), "STUDENT");
  assert.equal(joinRoleFor({ ...learner, profileId: "someone-else" }, lessonOf("tutor-1")), null);
  assert.equal(joinRoleFor(family, lessonOf("tutor-1")), null);
});

test("the tutor view only narrows: an administrator scoped to their own teaching, and null for anyone who does not teach", () => {
  const view = asTutor(adminWhoTeaches);
  assert.equal(view.role, "TUTOR");
  assert.equal(view.profileId, "tutor-2");
  assert.equal(view.id, adminWhoTeaches.id, "still the same person: their notifications stay theirs");
  assert.equal(adminWhoTeaches.role, "ADMIN", "the original is untouched");
  assert.equal(asTutor(adminOnly), null);
  assert.equal(asTutor(family), null);
  assert.equal(asTutor(learner), null);
});

test("the menu: an administrator who teaches gains the tutor tools and keeps the administrator's; one who does not, never sees them", () => {
  const hrefs = (sections) => sections.flatMap((section) => section.items.map((item) => item.href));
  const teaching = hrefs(navigationFor("ADMIN", { teaches: true }));
  assert.ok(teaching.includes("/dashboard/tutor/availability"));
  assert.ok(teaching.includes("/dashboard/students"));
  assert.ok(teaching.includes("/dashboard/admin/people/tutors"), "the administrator's screens stay");
  assert.equal(new Set(teaching).size, teaching.length, "no page twice");

  for (const links of [hrefs(navigationFor("ADMIN")), hrefs(platformNavigation({ role: "ADMIN", tuition: true, studyBuddy: false, library: false, account: true, teaches: false }))]) {
    assert.ok(!links.includes("/dashboard/tutor/availability"), "an administrator only has no availability");
    assert.ok(!links.includes("/dashboard/students"));
  }
  const shell = hrefs(platformNavigation({ role: "ADMIN", tuition: true, studyBuddy: false, library: false, account: true, teaches: true }));
  assert.ok(shell.includes("/dashboard/tutor/availability"));
  assert.deepEqual(hrefs(navigationFor("TUTOR", { teaches: true })), hrefs(navigationFor("TUTOR")), "a tutor's menu already has them");
});

test("the shortcuts follow the menu", () => {
  const keys = (targets) => targets.map((target) => target.key);
  assert.ok(keys(goToTargetsFor("ADMIN", true)).includes("v"));
  assert.ok(!keys(goToTargetsFor("ADMIN")).includes("v"));
  assert.ok(keys(goToTargetsFor("TUTOR")).includes("v"));
});

test("an account as the app's user: an administrator's tutor record becomes the capability, and only an administrator's", () => {
  const signedIn = { email: "person@accounts.learnthrivetuition.co.uk", displayName: "" };
  const env = { NODE_ENV: "production" };
  const admin = { profileId: "p-1", role: "ADMIN", displayName: "Alvi", linkedEmail: "alvi@example.test", username: "alvi" };
  const user = toPlatformUser(signedIn, admin, "tutor-7", env, "tutor-7");
  assert.equal(user.tutorId, "tutor-7");
  assert.equal(teaches(user), true);
  assert.equal(user.email, "alvi@example.test", "the linked address, never the internal one");
  assert.equal(teaches(toPlatformUser(signedIn, admin, "client-9", env, null)), false, "an administrator's family record is not a tutor record");
  assert.equal(toPlatformUser(signedIn, { ...admin, role: "CLIENT" }, "client-9", env, "tutor-7").tutorId, undefined);
  assert.equal(toPlatformUser(signedIn, { profileId: "p-2", role: "CLIENT", displayName: "", username: "kit-4821" }, null, env).name, "kit-4821", "a name is never the internal address");
});
