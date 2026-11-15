import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment, jsonRequest } from "./_routeHelpers.mjs";

// One person, several roles (docs/ROLE_PERMISSIONS.md). Page and action permissions are the UNION of the roles'; object access is never widened:
// each role reaches only the records its own relationship gives. These tests plant records a person must NOT reach and look for them.

const { getDataProvider, resetDataProvider, SEED_IDS } = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");
const roles = loadTsFrom(import.meta.url, "../../../packages/data/src/roles.ts");
const scope = loadTsFrom(import.meta.url, "../src/lib/auth/scope.ts");
const { joinRoleFor, mayActOnLesson, asTutor, teaches } = loadTsFrom(import.meta.url, "../src/lib/auth/teaching.ts");
const { visibleLessonsFor } = loadTsFrom(import.meta.url, "../src/lib/scheduling/visibleLessons.ts");
const { visibleStudentsFor, visibleReportsFor } = loadTsFrom(import.meta.url, "../src/lib/dashboard/queries.ts");
const { visibleReportFor } = loadTsFrom(import.meta.url, "../src/lib/reports/reportService.ts");
const { searchApp } = loadTsFrom(import.meta.url, "../src/lib/search/appSearch.ts");
const { changeRolesFor } = loadTsFrom(import.meta.url, "../src/lib/roles/handlers.ts");
const { navigationFor } = loadTsFrom(import.meta.url, "../src/lib/navigation/appNavigation.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");
const { MemoryAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/memoryAuth.ts");
const { SignInLockout } = loadTsFrom(import.meta.url, "../src/lib/account/lockout.ts");
const h = loadTsFrom(import.meta.url, "../src/lib/account/handlers.ts");

// ---- the people (all synthetic; the same shapes lib/access/platformUser.ts builds) --------------------------------------------------

const person = (over) => ({ id: `acct-${over.role}`, email: "x@example.test", name: "Synthetic", ...over });
const teachingAdmin = person({ role: "ADMIN", roles: ["ADMIN", "TUTOR"], id: "acct-teaching-admin", profileId: "acct-teaching-admin", tutorId: SEED_IDS.tutorMeeraShah });
const adminOnly = person({ role: "ADMIN", roles: ["ADMIN"], id: "acct-admin", profileId: "acct-admin" });
// A 17-year-old: a student AND a junior tutor, with a record for each role.
const junior = person({ role: "JUNIOR_TUTOR", roles: ["STUDENT", "JUNIOR_TUTOR"], id: "acct-junior", profileId: SEED_IDS.tutorJuniorSam, tutorId: SEED_IDS.tutorJuniorSam, studentId: SEED_IDS.studentJuniorSam });
const brian = person({ role: "STUDENT", roles: ["STUDENT"], id: "acct-brian", profileId: SEED_IDS.studentAyaanAhmed, studentId: SEED_IDS.studentAyaanAhmed });
const jamie = person({ role: "TUTOR", roles: ["TUTOR"], id: "acct-jamie", profileId: SEED_IDS.tutorJamiePatel, tutorId: SEED_IDS.tutorJamiePatel });
const juniorParent = person({ role: "CLIENT", roles: ["CLIENT"], id: "acct-parent", profileId: SEED_IDS.clientJuniorParent, clientId: SEED_IDS.clientJuniorParent });
// A tutor who is also a parent: two relationships, two sets of records.
const tutorAndParent = person({ role: "TUTOR", roles: ["TUTOR", "CLIENT"], id: "acct-tutor-parent", profileId: SEED_IDS.tutorJamiePatel, tutorId: SEED_IDS.tutorJamiePatel, clientId: SEED_IDS.clientJuniorParent });

const ids = (rows) => rows.map((r) => r.id).sort();

async function world() {
  resetDataProvider();
  const data = getDataProvider();
  // A report on the lesson where Sam is the STUDENT (the tutor is Meera): approved, with a private note.
  const learned = await data.reports.create({
    lessonId: SEED_IDS.lessonJuniorSamLearns, tutorId: SEED_IDS.tutorMeeraShah, status: "APPROVED", publicSummary: "Sam wrote a strong essay plan.",
    internalTutorNotes: "PRIVATE-NOTE-ABOUT-SAM", submittedAt: "2026-11-03T18:00:00.000Z", approvedAt: "2026-11-04T09:00:00.000Z",
  });
  // A report on the lesson Sam TEACHES Robin: a draft Sam wrote, with a private note.
  const taught = await data.reports.create({
    lessonId: SEED_IDS.lessonJuniorSamTeaches, tutorId: SEED_IDS.tutorJuniorSam, status: "DRAFT", publicSummary: "Robin read a sonnet.", internalTutorNotes: "PRIVATE-NOTE-ABOUT-ROBIN",
  });
  return { data, learned, taught, brianReport: await data.reports.get(SEED_IDS.reportApproved) };
}

// ---- permission resolution: the union --------------------------------------------------------------------------------------------------

test("permissions are the union of the roles: an administrator who teaches has both sets, and a junior tutor a subset of a tutor's", () => {
  assert.equal(scope.can(teachingAdmin, "roles.assign"), true, "from the administrator role");
  assert.equal(scope.can(teachingAdmin, "tutor.availability"), true, "from the tutor role");
  assert.equal(scope.can(teachingAdmin, "family.view"), false, "neither role is a parent");
  assert.equal(scope.can(teachingAdmin, "classroom.learn"), false, "neither role is a learner");

  // student + junior tutor: the learner's rights and the junior's, and nothing from either role's neighbours.
  assert.equal(scope.can(junior, "classroom.learn"), true);
  assert.equal(scope.can(junior, "attendance.mark"), true);
  assert.equal(scope.can(junior, "report.draft"), true);
  assert.equal(scope.can(junior, "report.submit"), false, "a junior tutor drafts; a tutor or an administrator sends a report on");
  assert.equal(scope.can(junior, "tutor.availability"), false);
  assert.equal(scope.can(junior, "roles.assign"), false);
  assert.equal(scope.can(junior, "report.approve"), false);
  assert.equal(scope.can(junior, "admin.manage"), false);

  const tutor = roles.permissionsOf(["TUTOR"]);
  for (const permission of roles.permissionsOf(["JUNIOR_TUTOR"])) assert.ok(tutor.has(permission), `${permission}: every junior permission is a tutor permission`);
  assert.ok(roles.permissionsOf(["JUNIOR_TUTOR"]).size < tutor.size, "and strictly fewer");
});

test("the menu is the union too, and never offers a junior tutor a tutor's availability page", () => {
  const hrefs = (user) => scope.rolesOf(user) && navigationFor(scope.rolesOf(user)).flatMap((s) => s.items.map((i) => i.href));
  const asJunior = hrefs(junior);
  assert.ok(asJunior.includes("/dashboard/students"), "the junior's students");
  assert.ok(asJunior.includes("/dashboard/lessons"));
  assert.ok(!asJunior.includes("/dashboard/tutor/availability"));
  assert.ok(!asJunior.some((href) => href.startsWith("/dashboard/admin")), "no administrator screens");
  const asTeachingAdmin = hrefs(teachingAdmin);
  assert.ok(asTeachingAdmin.includes("/dashboard/admin/roles"));
  assert.ok(asTeachingAdmin.includes("/dashboard/tutor/availability"));
  assert.ok(asTeachingAdmin.includes("/dashboard/students"));
  assert.equal(new Set(asTeachingAdmin).size, asTeachingAdmin.length, "no page twice");
  const labels = navigationFor(scope.rolesOf(teachingAdmin)).flatMap((s) => s.items.map((i) => i.label));
  assert.equal(new Set(labels).size, labels.length, "no two links with the same name");
  assert.ok(labels.includes("My students"), "their own students are 'My students', apart from the administrator's 'Students'");
  assert.ok(!hrefs(jamie).includes("/dashboard/admin/roles"), "a tutor is not offered the Roles screen");
});

// ---- object access is never widened: a student who is also a junior tutor ------------------------------------------------------------------

test("a student who is also a junior tutor sees their own learning and the students they are assigned: nobody else's lessons, students or reports", async () => {
  const w = await world();
  const lessons = await visibleLessonsFor(w.data, junior);
  assert.deepEqual(ids(lessons), [SEED_IDS.lessonJuniorSamLearns, SEED_IDS.lessonJuniorSamTeaches].sort(), "the lesson they attend and the lesson they teach, nothing more");
  assert.ok(!ids(lessons).includes(SEED_IDS.lessonCompleted) && !ids(lessons).includes(SEED_IDS.lessonUpcoming), "not Brian's lessons");

  const students = await visibleStudentsFor(w.data, junior);
  assert.deepEqual(ids(students), [SEED_IDS.studentJuniorSam, SEED_IDS.studentPeerRobin].sort(), "themselves and the student they teach");
  assert.ok(!ids(students).includes(SEED_IDS.studentAyaanAhmed), "not Brian");

  // Reports reach a person through the lessons they may see (visibleReportsFor): another student's report is not among them.
  const reportIds = (await visibleReportsFor(w.data, junior)).map(({ report }) => report.id);
  assert.ok(!reportIds.includes(w.brianReport.id), "another student's approved report is not theirs");
  assert.deepEqual(reportIds.sort(), [w.learned.id, w.taught.id].sort(), "the report on the lesson they attend and the draft on the lesson they teach");
  assert.equal(joinRoleFor(junior, { tutorId: SEED_IDS.tutorJamiePatel, studentIds: [SEED_IDS.studentAyaanAhmed] }), null, "they cannot join another student's classroom");
  assert.equal(mayActOnLesson(junior, { tutorId: SEED_IDS.tutorJamiePatel }), false, "nor mark another tutor's lesson");
});

test("each role keeps its own view of a report: private notes only where the person is the tutor who wrote it", async () => {
  const w = await world();
  const asStudent = visibleReportFor(junior, w.learned);
  assert.ok(asStudent, "their own approved report");
  assert.equal(asStudent.internalTutorNotes, undefined, "as a STUDENT they see the family's view: a junior tutor role does not unlock the private note about themselves");
  assert.ok(!JSON.stringify(asStudent).includes("PRIVATE-NOTE-ABOUT-SAM"));
  const asTutor_ = visibleReportFor(junior, w.taught);
  assert.equal(asTutor_?.internalTutorNotes, "PRIVATE-NOTE-ABOUT-ROBIN", "as the tutor of the lesson they wrote it for");
  // The learner-only view of the same draft: nothing, because it is not approved.
  assert.equal(visibleReportFor(brian, w.taught), null);
  assert.ok(!(await visibleReportsFor(w.data, brian)).some(({ report }) => [w.learned.id, w.taught.id].includes(report.id)), "Brian reaches no report of Sam's or Robin's lessons");
});

test("search never names another student: the palette of a student who is a junior tutor holds only their own people", async () => {
  const w = await world();
  for (const q of ["Brian", "Brian James Khalawon", "GCSE Mathematics", "Abdurrahman", "Tahasin"]) {
    const found = await searchApp(w.data, junior, q);
    assert.deepEqual(found.filter((r) => /Brian|GCSE|Abdurrahman|Tahasin/i.test(`${r.title} ${r.subtitle ?? ""}`)), [], `found something of another family for "${q}"`);
    assert.ok(!ids(found).some((id) => [SEED_IDS.studentAyaanAhmed, SEED_IDS.lessonCompleted, SEED_IDS.lessonUpcoming, SEED_IDS.clientSarahAhmed, SEED_IDS.tutorJamiePatel].includes(id)), `found another family's record for "${q}"`);
  }
  const mine = await searchApp(w.data, junior, "Robin");
  assert.ok(ids(mine).includes(SEED_IDS.studentPeerRobin), "the student they teach is findable");
  assert.ok(!(await searchApp(w.data, junior, "PRIVATE-NOTE")).length, "never by a private note");
});

test("a student who is not a tutor cannot reach the students a junior tutor can", async () => {
  const w = await world();
  assert.deepEqual(ids(await visibleStudentsFor(w.data, brian)), [SEED_IDS.studentAyaanAhmed], "only themselves");
  assert.ok(!ids(await visibleLessonsFor(w.data, brian)).includes(SEED_IDS.lessonJuniorSamTeaches));
  assert.equal(teaches(brian), false);
});

// ---- object access is never widened: an administrator who teaches, a tutor who is a parent -------------------------------------------

test("an administrator who teaches: the tutor role is still only their own lessons, and neither role gives them a family's or a learner's", async () => {
  const w = await world();
  const own = asTutor(teachingAdmin);
  assert.deepEqual(own.roles, ["TUTOR"]);
  const asTeacher = await visibleLessonsFor(w.data, own);
  assert.deepEqual(ids(asTeacher), [SEED_IDS.lessonJuniorSamLearns], "the tutor role: the lessons of their own tutor record");
  assert.ok((await visibleLessonsFor(w.data, teachingAdmin)).length > asTeacher.length, "the administrator role is what reaches the rest");

  assert.equal(joinRoleFor(teachingAdmin, { tutorId: SEED_IDS.tutorJamiePatel, studentIds: [SEED_IDS.studentAyaanAhmed] }), null, "an administrator is not another tutor's classroom tutor");
  assert.equal(joinRoleFor(teachingAdmin, { tutorId: SEED_IDS.tutorMeeraShah, studentIds: [] }), "TUTOR");
  assert.equal(scope.holdsAnyOf(teachingAdmin, ["CLIENT"]), false, "the parent pages stay shut");
  assert.equal(scope.holdsAnyOf(teachingAdmin, ["STUDENT"]), false, "and the learner's");
  assert.equal(scope.asRole(teachingAdmin, "CLIENT"), null);
  assert.equal(scope.asRole(teachingAdmin, "STUDENT"), null);

  // An administrator who does NOT hold the tutor role never teaches, whatever record they have.
  assert.equal(teaches({ ...adminOnly, tutorId: SEED_IDS.tutorMeeraShah }), false);
  assert.equal(asTutor({ ...adminOnly, tutorId: SEED_IDS.tutorMeeraShah }), null);
});

test("a tutor who is also a parent sees the lessons they teach and their own family's, and no other tutor's or family's", async () => {
  const w = await world();
  const lessons = await visibleLessonsFor(w.data, tutorAndParent);
  assert.deepEqual(
    ids(lessons),
    [SEED_IDS.lessonCompleted, SEED_IDS.lessonUpcoming, SEED_IDS.lessonJuniorSamLearns].sort(),
    "Jamie's own two lessons, and the lesson of the family they own (Sam's)",
  );
  assert.ok(!ids(lessons).includes(SEED_IDS.lessonJuniorSamTeaches), "not another tutor's lesson for another family");
  assert.deepEqual(ids(await visibleStudentsFor(w.data, tutorAndParent)), [SEED_IDS.studentAyaanAhmed, SEED_IDS.studentJuniorSam].sort());
  // The parent role gives the family's view of a report, not the private note: only the tutor role does, for lessons they wrote.
  const report = visibleReportFor(tutorAndParent, w.learned);
  assert.equal(report.internalTutorNotes, undefined);
  assert.equal(visibleReportFor(juniorParent, w.taught), null, "a parent sees nothing of a lesson that is not their child's");
});

// ---- assigning roles: administrators only, through the one handler ------------------------------------------------------------------------

const TARGET = "11111111-1111-4111-8111-111111111111";
function spyStore(result = { status: "changed", before: ["TUTOR"], after: ["ADMIN", "TUTOR"] }) {
  const calls = [];
  return { calls, changeRoles: async (input) => (calls.push(input), result) };
}

test("a non-admin cannot assign roles, whatever else they hold, and nothing reaches the store", async () => {
  for (const actor of [jamie, junior, brian, juniorParent, tutorAndParent, person({ role: "TUTOR", roles: ["TUTOR", "STUDENT"] })]) {
    const store = spyStore();
    const result = await changeRolesFor(actor, { profileId: TARGET, roles: ["ADMIN"] }, store);
    assert.equal(result.status, 403, scope.rolesOf(actor).join("+"));
    assert.equal(result.body.code, "NOT_ADMIN");
    assert.equal(store.calls.length, 0, "the store was never asked");
  }
  const none = spyStore();
  assert.equal((await changeRolesFor(null, { profileId: TARGET, roles: ["ADMIN"] }, none)).status, 401, "signed out");
  assert.equal(none.calls.length, 0);
});

test("mass assignment: only profileId and roles are read; any other field is refused and nothing is applied", async () => {
  for (const extra of [{ role: "ADMIN" }, { isAdmin: true }, { admin: true }, { id: TARGET }, { actor: "someone-else" }, { roles2: ["ADMIN"] }, { __proto__: { role: "ADMIN" }, constructor: 1 }]) {
    const store = spyStore();
    const result = await changeRolesFor(adminOnly, { profileId: TARGET, roles: ["TUTOR"], ...extra }, store);
    assert.equal(result.status, 400, JSON.stringify(Object.keys(extra)));
    assert.equal(store.calls.length, 0);
  }
  for (const bad of [null, "ADMIN", ["ADMIN"], 5, { profileId: "not-a-uuid", roles: ["TUTOR"] }, { profileId: TARGET }, { profileId: TARGET, roles: "ADMIN" }, { profileId: TARGET, roles: ["SUPERUSER"] }, { profileId: TARGET, roles: [{ role: "ADMIN" }] }, { profileId: TARGET, roles: Array(9).fill("TUTOR") }]) {
    const store = spyStore();
    assert.equal((await changeRolesFor(adminOnly, bad, store)).status, 400, JSON.stringify(bad));
    assert.equal(store.calls.length, 0);
  }
  // The actor is the SESSION's person, never anything in the body.
  const store = spyStore();
  assert.equal((await changeRolesFor(adminOnly, { profileId: TARGET, roles: ["TUTOR"] }, store)).status, 200);
  assert.equal(store.calls[0].actor, adminOnly.id);
  assert.deepEqual(Object.keys(store.calls[0]).sort(), ["actor", "now", "profileId", "roles"]);
});

test("the store's refusals come back as refusals, each with its own status: self, last administrator, unknown person, a role that needs a record", async () => {
  const cases = [["SELF", 403], ["NOT_ADMIN", 403], ["NOT_FOUND", 404], ["EXCLUSIVE", 400], ["EMPTY", 400], ["UNKNOWN_ROLE", 400], ["LAST_ADMIN", 409], ["UNCHANGED", 409], ["NEEDS_RECORD", 409]];
  for (const [reason, status] of cases) {
    const store = spyStore({ status: "refused", reason, message: "no" });
    const result = await changeRolesFor(adminOnly, { profileId: TARGET, roles: ["TUTOR"] }, store);
    assert.equal(result.status, status, reason);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.code, reason);
  }
});

/** The real in-memory store, with people holding exactly these roles. */
function realStore() {
  const store = new InMemoryLibraryStore();
  const make = (id, rolesHeld, tutorId) => {
    store.seedProfile({ id, roles: rolesHeld, displayName: id });
    if (tutorId) store.seedTutorRef(id, tutorId);
  };
  return { store, make };
}
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const as = (id, held) => ({ id, role: roles.primaryRole(held), roles: held });

test("self-assignment fails: an administrator cannot change their own roles, even to add one", async () => {
  const { store, make } = realStore();
  make(A, ["ADMIN"]);
  const before = (await store.accounts.roleHistory(undefined, 50)).length;
  const result = await changeRolesFor(as(A, ["ADMIN"]), { profileId: A, roles: ["ADMIN", "STUDENT"] }, store.accounts);
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "SELF");
  assert.deepEqual((await store.accounts.getAccount(A)).roles, ["ADMIN"], "nothing changed");
  assert.equal((await store.accounts.roleHistory(undefined, 50)).length, before, "and nothing was audited as a change");
});

test("the last administrator cannot lose the role: the plan refuses it, and the only administrator has no one else who could try", async () => {
  const plan = roles.planRoleChange({ actorId: "x", actorRoles: ["ADMIN"], targetId: "y", targetRoles: ["ADMIN"], requested: ["TUTOR"], adminCount: 1 });
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, "LAST_ADMIN");

  const { store, make } = realStore();
  make(A, ["ADMIN"]);
  make(B, ["ADMIN"]);
  // Two administrators: one may demote the other...
  const first = await changeRolesFor(as(B, ["ADMIN"]), { profileId: A, roles: ["CLIENT"] }, store.accounts);
  assert.equal(first.status, 200);
  // ...and then the remaining one is the last: they cannot demote themselves (self), and the one demoted is no administrator any more.
  assert.equal((await changeRolesFor(as(B, ["ADMIN"]), { profileId: B, roles: ["CLIENT"] }, store.accounts)).body.code, "SELF");
  assert.equal((await changeRolesFor(as(A, ["CLIENT"]), { profileId: B, roles: ["CLIENT"] }, store.accounts)).status, 403, "a demoted administrator cannot demote the last one");
  assert.deepEqual((await store.accounts.getAccount(B)).roles, ["ADMIN"], "the last administrator is still one");
});

test("tutor and junior tutor cannot coexist: added to either, the change is refused whole", async () => {
  const { store, make } = realStore();
  make(A, ["ADMIN"]);
  make(B, ["TUTOR"], "tutor-b");
  make(C, ["JUNIOR_TUTOR"], "tutor-c");
  const admin = as(A, ["ADMIN"]);
  const one = await changeRolesFor(admin, { profileId: B, roles: ["TUTOR", "JUNIOR_TUTOR"] }, store.accounts);
  assert.equal(one.status, 400);
  assert.equal(one.body.code, "EXCLUSIVE");
  const two = await changeRolesFor(admin, { profileId: C, roles: ["JUNIOR_TUTOR", "TUTOR"] }, store.accounts);
  assert.equal(two.body.code, "EXCLUSIVE");
  assert.deepEqual((await store.accounts.getAccount(B)).roles, ["TUTOR"]);
  assert.deepEqual((await store.accounts.getAccount(C)).roles, ["JUNIOR_TUTOR"]);
  // Replacing one with the other in a single change is allowed: the union never holds both.
  const swap = await changeRolesFor(admin, { profileId: B, roles: ["JUNIOR_TUTOR"] }, store.accounts);
  assert.equal(swap.status, 200);
  assert.deepEqual((await store.accounts.getAccount(B)).roles, ["JUNIOR_TUTOR"]);
});

test("an administrator adds and removes roles, and each change is audited with who, when, before and after", async () => {
  const { store, make } = realStore();
  make(A, ["ADMIN"]);
  make(B, ["CLIENT"]);
  const at = new Date("2026-11-15T09:30:00Z");
  const admin = as(A, ["ADMIN"]);
  assert.equal((await changeRolesFor(admin, { profileId: B, roles: ["CLIENT", "ADMIN"] }, store.accounts, () => at)).status, 200);
  assert.equal((await changeRolesFor(admin, { profileId: B, roles: ["CLIENT"] }, store.accounts, () => new Date("2026-11-15T09:45:00Z"))).status, 200);
  const history = await store.accounts.roleHistory(B, 10);
  assert.equal(history.length, 2);
  const added = history.find((entry) => entry.after.includes("ADMIN"));
  assert.equal(added.actorProfileId, A);
  assert.equal(added.targetProfileId, B);
  assert.deepEqual(added.before, ["CLIENT"]);
  assert.deepEqual(added.after, ["ADMIN", "CLIENT"]);
  assert.equal(added.at.toISOString(), at.toISOString());
  const removed = history.find((entry) => !entry.after.includes("ADMIN"));
  assert.deepEqual(removed.before, ["ADMIN", "CLIENT"]);
  assert.deepEqual(removed.after, ["CLIENT"]);
});

// ---- nothing else a person can submit sets a role ---------------------------------------------------------------------------------------

function jar() {
  const values = new Map();
  return { values, get: (name) => values.get(name), set: (name, value) => values.set(name, value), delete: (name) => values.delete(name) };
}

test("sign-up and profile requests cannot set roles, whatever fields they carry", async (t) => {
  environment(t, {});
  h.resetAccountLimiters();
  const store = new InMemoryLibraryStore();
  const auth = new MemoryAccountAuth({ onUserCreated: (u) => store.seedProfile({ id: u.id, displayName: u.displayName }) });
  const rt = { backend: "memory", auth, store, lockout: new SignInLockout(), outbox: auth.outbox, memory: store };
  const c = jar();
  const url = "http://localhost:3100/api/account";
  const sneaky = { role: "ADMIN", roles: ["ADMIN", "TUTOR"], isAdmin: true, profileRoles: ["ADMIN"], admin: true };
  const email = "mass@example.com";
  await h.handleSignUp(jsonRequest(`${url}/signup`, {}, { email, password: "correct horse battery staple", displayName: "Pat", confirmAdult: true, ...sneaky }), { rt, jar: c });
  const link = rt.outbox.findLast((m) => m.to === email && m.kind === "signup");
  const verified = await h.handleVerify(jsonRequest(`${url}/verify`, {}, { tokenHash: link.tokenHash, type: "signup", ...sneaky }), { rt, jar: c });
  assert.equal(verified.status, 200);
  const people = await store.accounts.listProfiles();
  assert.equal(people.length, 1);
  assert.deepEqual(people[0].roles, ["CLIENT"], "a new account is a plain account, whatever the sign-up said");
  const renamed = await h.handleSetName(jsonRequest(`${url}/profile`, {}, { displayName: "Pat Q", ...sneaky }), { rt, jar: c });
  assert.equal(renamed.status, 200);
  assert.deepEqual((await store.accounts.listProfiles())[0].roles, ["CLIENT"], "nor can a rename");
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

test("the only code that changes roles is the role handler, and the only form field that names roles is the Roles screen's", () => {
  const src = join(import.meta.dirname, "..", "src");
  const callers = [];
  const readers = [];
  for (const file of walk(src)) {
    const text = readFileSync(file, "utf8");
    const rel = relative(src, file).replaceAll("\\", "/");
    if (/\.changeRoles\(/.test(text) && !/^lib\/roles\//.test(rel)) callers.push(rel);
    if (/\.(get|getAll)\(\s*["'`]roles?["'`]\s*\)/.test(text) || /\b(body|fields|payload)\.roles?\b/.test(text)) readers.push(rel);
    // Where a login is made, its role is a literal in the code, never a value read from the form.
    if (!/^lib\/account\/provision/.test(rel) && /createLogin\(rt, \{[^}]*\brole: (?!")/.test(text)) readers.push(`${rel} (createLogin role)`);
  }
  assert.deepEqual(callers, [], "changeRoles is called only through lib/roles/handlers.ts");
  // The careers form's `role` is the JOB applied for; the one other reader is the admin Roles action.
  assert.deepEqual(readers.filter((r) => !/careers/.test(r) && !["lib/actions/roles.ts", "lib/roles/handlers.ts"].includes(r)), [], "no other code reads a role from a request");
});
