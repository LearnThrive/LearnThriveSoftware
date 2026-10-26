import assert from "node:assert/strict";
import { test } from "node:test";
import { directLoginAllowed, resolveActor, type AccessFacts, type Account, type LearnerContext } from "./library";

// The one decision about who is acting and whether LearnThrive AI is open to them. Pure: every combination is a table.

const none: AccessFacts = { enrolled: false, subscription: false, adminGrant: false };
const facts = (over: Partial<AccessFacts>): AccessFacts => ({ ...none, ...over });
const learner = (over: Partial<LearnerContext> = {}): LearnerContext => ({
  studentId: "stu-1", familyClientId: "fam-1", status: "active", displayName: "Kid", yearGroup: "Year 9", isMinor: true, accessMode: "direct", guardianActive: true, ...over,
});
const guardian = (over: Partial<Account> = {}): Account => ({ profileId: "p-guardian", role: "CLIENT", displayName: "G", adultConfirmed: true, clientId: "fam-1", learner: null, ...over });
const student = (l: LearnerContext | null = learner()): Account => ({ profileId: "p-learner", role: "STUDENT", displayName: "K", adultConfirmed: false, clientId: null, learner: l });
const open = { minorsApproved: true };

test("a guardian acts as themselves: own chats, adult operations, LearnThrive AI on any Library right", () => {
  const a = resolveActor({ account: guardian(), facts: facts({ subscription: true }), ...open });
  assert.equal(a.mode, "guardian");
  assert.deepEqual(a.owner, { clientId: "fam-1", studentId: null });
  assert.equal(a.adultOperations, true);
  assert.deepEqual(a.assistant, { allowed: true, reason: null });
  assert.equal(a.platform.dashboard, false);
  assert.equal(resolveActor({ account: guardian(), facts: facts({ enrolled: true }), ...open }).platform.dashboard, true);
});

test("an adult without the 18+ declaration has no adult operations and no assistant; an adult with no right gets no_access", () => {
  const noDeclaration = resolveActor({ account: guardian({ adultConfirmed: false }), facts: facts({ subscription: true }), ...open });
  assert.deepEqual(noDeclaration.assistant, { allowed: false, reason: "adult_required" });
  assert.equal(noDeclaration.adultOperations, false);
  assert.deepEqual(resolveActor({ account: guardian(), facts: none, ...open }).assistant, { allowed: false, reason: "no_access" });
});

test("a learner's own login: their chats only, never adult operations, LearnThrive AI when entitled, active, linked, enabled, and consented if a minor", () => {
  const library = facts({ subscription: true, ownTuition: false });
  const a = resolveActor({ account: student(), facts: library, learnerConsent: true, ...open });
  assert.equal(a.mode, "learner");
  assert.deepEqual(a.owner, { clientId: "fam-1", studentId: "stu-1" }, "scoped to the family AND the learner");
  assert.equal(a.adultOperations, false);
  assert.equal(a.profileId, "p-learner");
  assert.deepEqual(a.assistant, { allowed: true, reason: null });
  assert.equal(a.platform.dashboard, false, "a Library-only learner has no tuition routes");
  assert.equal(a.platform.studyBuddy, true);
  const tuition = resolveActor({ account: student(), facts: facts({ enrolled: true, ownTuition: true }), learnerConsent: true, ...open });
  assert.equal(tuition.platform.dashboard, true);
  assert.equal(tuition.assistant.allowed, true);
});

test("the learner's tuition follows their own enrolment: an enrolled sibling gives the Library benefit only", () => {
  const a = resolveActor({ account: student(), facts: facts({ enrolled: true, ownTuition: false }), learnerConsent: true, ...open });
  assert.equal(a.platform.dashboard, false);
  assert.equal(a.platform.library, true);
  assert.equal(a.platform.studyBuddy, true);
  assert.equal(a.assistant.allowed, true);
});

test("each way a learner can lose LearnThrive AI is its own reason, and the same learner with the cause removed gets it back", () => {
  const library = facts({ subscription: true, ownTuition: false });
  const cases: Array<[string, Parameters<typeof resolveActor>[0], string]> = [
    ["suspended login", { account: student(learner({ status: "suspended" })), facts: library, learnerConsent: true, ...open }, "learner_inactive"],
    ["revoked login", { account: student(learner({ status: "revoked" })), facts: library, learnerConsent: true, ...open }, "learner_inactive"],
    ["guardian link gone", { account: student(learner({ guardianActive: false })), facts: library, learnerConsent: true, ...open }, "guardian_inactive"],
    ["access mode not direct", { account: student(learner({ accessMode: "supervised" })), facts: library, learnerConsent: true, ...open }, "learner_not_enabled"],
    ["no entitlement", { account: student(), facts: none, learnerConsent: true, ...open }, "no_access"],
    ["minor, consent withdrawn", { account: student(), facts: library, learnerConsent: false, ...open }, "consent_needed"],
    ["minor, deployment not approved for children", { account: student(), facts: library, learnerConsent: true, minorsApproved: false }, "minors_closed"],
  ];
  for (const [name, input, reason] of cases) {
    const a = resolveActor(input);
    assert.deepEqual(a.assistant, { allowed: false, reason }, name);
    assert.equal(a.adultOperations, false, name);
  }
  // A suspended or revoked learner has no tuition or Library either, not just no assistant.
  const dead = resolveActor({ account: student(learner({ status: "suspended" })), facts: facts({ enrolled: true, ownTuition: true, subscription: true }), learnerConsent: true, ...open });
  assert.deepEqual(dead.platform, { tier: "none", dashboard: false, library: false, studyBuddy: false });
});

test("an adult learner needs neither the children's approval nor a guardian's consent", () => {
  const adult = student(learner({ isMinor: false }));
  const a = resolveActor({ account: adult, facts: facts({ subscription: true }), learnerConsent: false, minorsApproved: false });
  assert.deepEqual(a.assistant, { allowed: true, reason: null });
});

test("ASSISTANT_MINORS_APPROVED is a deployment permission, never a bypass of the per-learner checks", () => {
  const library = facts({ subscription: true });
  for (const consent of [false, true]) {
    const a = resolveActor({ account: student(learner({ status: "revoked" })), facts: library, learnerConsent: consent, minorsApproved: true });
    assert.equal(a.assistant.allowed, false, "revoked stays closed with the deployment approved");
  }
  assert.equal(resolveActor({ account: student(), facts: library, learnerConsent: false, minorsApproved: true }).assistant.allowed, false, "approved deployment, no consent");
});

test("a student profile with no learner record (never bound, or removed) has nothing", () => {
  const a = resolveActor({ account: student(null), facts: facts({ subscription: true, enrolled: true }), ...open });
  assert.equal(a.owner, null);
  assert.deepEqual(a.assistant, { allowed: false, reason: "no_access" });
  assert.deepEqual(a.platform, { tier: "none", dashboard: false, library: false, studyBuddy: false });
});

test("supervised: the actor stays the guardian, the effective learner is the student, adult operations are off", () => {
  const library = facts({ subscription: true });
  const supervised = learner({ accessMode: "supervised", isMinor: true });
  const a = resolveActor({ account: guardian(), facts: library, supervised, learnerConsent: true, ...open });
  assert.equal(a.mode, "supervised");
  assert.equal(a.profileId, "p-guardian", "the signed-in person is still the guardian");
  assert.equal(a.studentId, "stu-1");
  assert.deepEqual(a.owner, { clientId: "fam-1", studentId: "stu-1" }, "the learner's chats, not the guardian's own");
  assert.equal(a.adultOperations, false, "no paying, no portal, no managing guardians from inside a child's view");
  assert.deepEqual(a.assistant, { allowed: true, reason: null });
  assert.equal(resolveActor({ account: guardian(), facts: library, supervised, learnerConsent: false, ...open }).assistant.reason, "consent_needed");
  assert.equal(resolveActor({ account: guardian(), facts: library, supervised: learner({ accessMode: "none" }), learnerConsent: true, ...open }).assistant.reason, "learner_not_enabled");
  assert.equal(resolveActor({ account: guardian(), facts: library, supervised: learner({ accessMode: "direct" }), learnerConsent: true, ...open }).assistant.reason, "learner_not_enabled", "a learner with their own login is not impersonated");
  assert.equal(resolveActor({ account: guardian(), facts: library, supervised: learner({ accessMode: "supervised", guardianActive: false }), learnerConsent: true, ...open }).assistant.reason, "guardian_inactive");
});

test("only a guardian with a family can supervise: staff and learners ignore a supervised selection", () => {
  const ctx = learner({ accessMode: "supervised" });
  assert.equal(resolveActor({ account: guardian({ role: "ADMIN" }), facts: facts({ subscription: true }), supervised: ctx, ...open }).mode, "staff");
  assert.equal(resolveActor({ account: guardian({ clientId: null }), facts: facts({ subscription: true }), supervised: ctx, ...open }).mode, "guardian");
  assert.equal(resolveActor({ account: student(), facts: facts({ subscription: true }), supervised: learner({ studentId: "someone-else", accessMode: "supervised" }), learnerConsent: true, ...open }).studentId, "stu-1", "a learner cannot select another learner");
});

test("staff: an administrator has the Library and the dashboard, a tutor only what the facts give; neither is a learner", () => {
  const admin = resolveActor({ account: guardian({ role: "ADMIN", clientId: null }), facts: none, ...open });
  assert.equal(admin.mode, "staff");
  assert.equal(admin.owner, null);
  assert.equal(admin.assistant.allowed, true);
  const tutor = resolveActor({ account: guardian({ role: "TUTOR", clientId: null }), facts: none, ...open });
  assert.deepEqual(tutor.assistant, { allowed: false, reason: "no_access" });
  assert.equal(tutor.platform.dashboard, true);
});

test("direct sign-in age policy: an adult always; a minor from the configured year (default Year 9); unknown years supervised only", () => {
  const minor = (yearGroup: string | null) => directLoginAllowed({ isMinor: true, yearGroup });
  assert.equal(directLoginAllowed({ isMinor: false, yearGroup: null }), true);
  assert.equal(directLoginAllowed({ isMinor: false, yearGroup: "Year 1" }), true, "an adult learner, whatever they are studying");
  for (const g of ["Year 9", "year 10", "Y11", "11", "Year 13", "A Level", "a-level", "Sixth form"]) assert.equal(minor(g), true, g);
  for (const g of ["Year 1", "Year 6", "Y8", "8", "KS2", "", null, "primary", "Year 14", "Year 99"]) assert.equal(minor(g), false, String(g));
  assert.equal(directLoginAllowed({ isMinor: true, yearGroup: "Year 8" }, 8), true, "the year is configurable");
  assert.equal(directLoginAllowed({ isMinor: true, yearGroup: "Year 8" }, 10), false);
});
