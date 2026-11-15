import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The development accounts behind the one sign-in: the shared list, the seeding, and the mapping to the signed-in app's user.

const dev = loadTsFrom(import.meta.url, "../src/lib/dev/accounts.ts");
const { seedDevAccounts } = loadTsFrom(import.meta.url, "../src/lib/dev/seedAccounts.ts");
const { toPlatformUser } = loadTsFrom(import.meta.url, "../src/lib/access/platformUser.ts");
const { internalEmailFor, usernameError } = loadTsFrom(import.meta.url, "../src/lib/account/username.ts");
const { MemoryAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/memoryAuth.ts");
const { getAuthProvider } = loadTsFrom(import.meta.url, "../src/lib/auth/devProvider.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");
const { platformAccess } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/access.ts");

const { primaryRole, validateRoleSet } = loadTsFrom(import.meta.url, "../../../packages/data/src/roles.ts");

const byEmail = (email) => dev.DEV_ACCOUNTS.find((account) => account.email === email);

test("the list: unique ids and addresses, all on the reserved .dev domain, a role each, and the five staff-provider accounts unchanged", () => {
  const accounts = dev.DEV_ACCOUNTS;
  assert.equal(new Set(accounts.map((a) => a.id)).size, accounts.length, "ids are unique");
  assert.equal(new Set(accounts.map((a) => a.email.toLowerCase())).size, accounts.length, "addresses are unique");
  for (const a of accounts) {
    assert.match(a.email, /^[a-z-]+@learnthrive\.dev$/, a.email);
    assert.equal(usernameError(a.username), undefined, a.username);
    assert.match(a.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "a real UUID shape, so nothing that validates ids refuses it");
    assert.ok(["ADMIN", "TUTOR", "JUNIOR_TUTOR", "CLIENT", "STUDENT"].includes(a.role));
    assert.equal(a.role, primaryRole(a.roles), `${a.email}: role is the highest of roles`);
    assert.ok(a.roles.includes(a.role));
    assert.equal(validateRoleSet(a.roles).ok, true, `${a.email}: a set of roles the rules allow`);
  }
  assert.deepEqual(accounts.filter((a) => a.inDevProvider).map((a) => a.email), [
    "admin@learnthrive.dev", "tutor@learnthrive.dev", "client@learnthrive.dev", "student@learnthrive.dev", "disabled@learnthrive.dev",
  ]);
  assert.equal(byEmail("disabled@learnthrive.dev").active, false);
});

test("seeding: every account signs in (the disabled one is refused as disabled) and holds the Library standing its row names", async () => {
  const store = new InMemoryLibraryStore();
  const auth = new MemoryAccountAuth();
  await seedDevAccounts(auth, store);
  await seedDevAccounts(auth, store); // idempotent: no second copy, no throw

  const expected = {
    "admin@learnthrive.dev": "staff",
    "tutor@learnthrive.dev": "staff",
    "client@learnthrive.dev": "enrolled",
    "student@learnthrive.dev": "enrolled",
    "member@learnthrive.dev": "library",
    "visitor@learnthrive.dev": "none",
    "teaching-admin@learnthrive.dev": "staff",
    "junior-parent@learnthrive.dev": "enrolled",
    "junior@learnthrive.dev": "staff", // a junior tutor is staff: the tier is the union of the roles'
    ...Object.fromEntries(["alvi", "tahasin", "abdurrahman", "brian"].flatMap((k) => [[`team-${k}@learnthrive.dev`, "staff"], [`team-${k}-learner@learnthrive.dev`, "staff"]])),
  };
  for (const account of dev.DEV_ACCOUNTS) {
    const result = await auth.signIn(internalEmailFor(account.username), account.password);
    if (!account.active) {
      assert.equal(result.ok, false);
      assert.equal(result.reason, "account_disabled", account.email);
      continue;
    }
    assert.equal(result.ok, true, account.email);
    assert.equal(result.user.id, account.id, "the sign-in id is the list's id");
    const profile = await store.accounts.getAccount(account.id);
    assert.equal(profile.role, account.role, account.email);
    const ORDER = ["ADMIN", "TUTOR", "JUNIOR_TUTOR", "CLIENT", "STUDENT"];
    assert.deepEqual(profile.roles, [...account.roles].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)), `${account.email}: the roles seeded are the list's`);
    assert.equal(profile.adultConfirmed, true);
    // A learner's facts are their own (their own tuition, the household's Library benefit); everyone else's are the family's.
    const facts = profile.learner ? await store.access.learnerFacts(profile.learner.studentId) : profile.clientId ? await store.access.facts(profile.clientId) : { enrolled: false, subscription: false, adminGrant: false };
    assert.equal(platformAccess(profile.roles, facts).tier, expected[account.email], account.email);
  }
  const student = await store.accounts.getAccount(byEmail("student@learnthrive.dev").id);
  assert.equal(student.clientId, null, "the development student is a learner: no family account of their own");
  assert.equal(student.learner.familyClientId, (await store.accounts.getAccount(byEmail("client@learnthrive.dev").id)).clientId, "of the development client's family");
  const member = await store.accounts.getAccount(byEmail("member@learnthrive.dev").id);
  const memberAccess = platformAccess("CLIENT", await store.access.facts(member.clientId));
  assert.deepEqual(memberAccess, { tier: "library", dashboard: false, library: true, studyBuddy: true }, "a subscriber has LearnThrive AI and the Library, and no dashboard");
});

test("the staff development provider uses the same ids and domain links as the one sign-in", async () => {
  const provider = getAuthProvider();
  for (const account of dev.DEV_ACCOUNTS.filter((a) => a.inDevProvider && a.active)) {
    const result = await provider.verifyCredentials(account.email, account.password);
    assert.equal(result.ok, true, account.email);
    assert.equal(result.user.id, account.id, "one person, one id, whichever way they are looked up");
    assert.equal(result.user.profileId, account.domainId);
  }
  assert.deepEqual(await provider.verifyCredentials("disabled@learnthrive.dev", "dev-disabled-pass"), { ok: false, reason: "account_disabled" });
  assert.deepEqual(await provider.verifyCredentials("member@learnthrive.dev", "dev-member-pass"), { ok: false, reason: "invalid_credentials" }, "a Library member has no way into the staff provider");
});

test("the domain link: the seeded tutor, parent and student records in development, and nothing in production or for anyone else", () => {
  assert.equal(dev.devDomainIdFor(byEmail("tutor@learnthrive.dev").id, { NODE_ENV: "development" }), "tutor-jamie-patel");
  assert.equal(dev.devDomainIdFor(byEmail("client@learnthrive.dev").id, { NODE_ENV: "development" }), "client-sarah-ahmed");
  assert.equal(dev.devDomainIdFor(byEmail("student@learnthrive.dev").id, { NODE_ENV: "test" }), "student-ayaan-ahmed");
  assert.equal(dev.devDomainIdFor(byEmail("client@learnthrive.dev").id, { NODE_ENV: "production" }), undefined, "never in production");
  assert.equal(dev.devDomainIdFor(byEmail("admin@learnthrive.dev").id, { NODE_ENV: "development" }), undefined, "an administrator has no such record");
  assert.equal(dev.devDomainIdFor("a-real-supabase-user-id", { NODE_ENV: "development" }), undefined);
});

test("only a local development server counts as development", () => {
  assert.equal(dev.isDevelopmentBuild({ NODE_ENV: "development" }), true);
  for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "test" }, {}]) assert.equal(dev.isDevelopmentBuild(env), false, JSON.stringify(env));
});

test("toPlatformUser: the account's id and role, the profile's name first, and the domain link only where one exists", () => {
  const env = { NODE_ENV: "development" };
  const client = byEmail("client@learnthrive.dev");
  assert.deepEqual(
    toPlatformUser({ email: client.email, displayName: "Signup Name" }, { profileId: client.id, role: "CLIENT", roles: ["CLIENT"], displayName: "Profile Name" }, {}, env),
    { id: client.id, email: client.email, role: "CLIENT", roles: ["CLIENT"], name: "Profile Name", profileId: "client-sarah-ahmed", clientId: "client-sarah-ahmed" },
  );
  assert.equal(toPlatformUser({ email: "a@b.co", displayName: "Signup Name" }, { profileId: "x", role: "ADMIN", roles: ["ADMIN"], displayName: "" }, {}, env).name, "Signup Name", "then the sign-up name");
  assert.equal(toPlatformUser({ email: "a@b.co", displayName: "" }, { profileId: "x", role: "ADMIN", roles: ["ADMIN"], displayName: "" }, {}, env).name, "a@b.co", "then the address");
  assert.equal(toPlatformUser({ email: "a@b.co", displayName: "" }, { profileId: "x", role: "TUTOR", roles: ["TUTOR"], displayName: "T" }, {}, env).profileId, "x", "no invented link for an account the development data does not know: its own id, which matches no record");
  // Everywhere else the link is the person's real record from the database, and the development mapping never answers in production.
  const real = "11111111-1111-4111-8111-111111111111";
  assert.equal(toPlatformUser({ email: client.email, displayName: "" }, { profileId: client.id, role: "CLIENT", roles: ["CLIENT"], displayName: "C" }, { clientId: real }, { NODE_ENV: "production" }).profileId, real);
  assert.equal(toPlatformUser({ email: client.email, displayName: "" }, { profileId: client.id, role: "CLIENT", roles: ["CLIENT"], displayName: "C" }, {}, { NODE_ENV: "production" }).profileId, client.id, "no development record in production, even for a development account's id");
});

test("the multi-role development accounts: a teaching administrator, and a 17-year-old student who is a junior tutor with their parent", () => {
  const env = { NODE_ENV: "development" };
  const teachingAdmin = byEmail("teaching-admin@learnthrive.dev");
  assert.deepEqual([...teachingAdmin.roles], ["ADMIN", "TUTOR"]);
  assert.deepEqual(dev.devRecordsFor(teachingAdmin.id, env), { tutorId: "tutor-meera-shah" });
  const junior = byEmail("junior@learnthrive.dev");
  const parent = byEmail("junior-parent@learnthrive.dev");
  assert.deepEqual([...junior.roles], ["STUDENT", "JUNIOR_TUTOR"]);
  assert.deepEqual(dev.devRecordsFor(junior.id, env), { tutorId: "tutor-junior-sam", studentId: "student-junior-sam" });
  assert.deepEqual(dev.devRecordsFor(parent.id, env), { clientId: "client-junior-parent" });
  assert.equal(junior.learnerOf, parent.id, "their parent's family");
  assert.equal(dev.devRecordsFor(junior.id, { NODE_ENV: "production" }), undefined, "never in production");
  const user = toPlatformUser({ email: junior.email, displayName: "" }, { profileId: junior.id, role: junior.role, roles: junior.roles, displayName: "S" }, {}, env);
  assert.equal(user.tutorId, "tutor-junior-sam");
  assert.equal(user.studentId, "student-junior-sam");
  assert.equal(user.clientId, undefined, "a student is never also a parent");
});

test("the team: four people, two logins each, which together hold every role; no one login holds them all, because the rules forbid it", async () => {
  const { TEAM, getDataProvider, resetDataProvider } = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");
  const { validateRoleSet, ROLES } = loadTsFrom(import.meta.url, "../../../packages/data/src/roles.ts");
  const names = ["Alvi Hossain", "Tahasin Hasan", "Abdurrahman Mustafa", "Brian James Khalawon"];
  assert.deepEqual(TEAM.map((p) => p.name), names);
  for (const person of TEAM) {
    const main = byEmail(`team-${person.key}@learnthrive.dev`);
    const learner = byEmail(`team-${person.key}-learner@learnthrive.dev`);
    assert.equal(main.name, person.name);
    assert.deepEqual([...main.roles], ["ADMIN", "TUTOR", "CLIENT"]);
    assert.deepEqual([...learner.roles], ["STUDENT", "JUNIOR_TUTOR"]);
    assert.deepEqual([...new Set([...main.roles, ...learner.roles])].sort(), [...ROLES].sort(), `${person.name}: the two logins together hold every role`);
    assert.equal(validateRoleSet([...main.roles, ...learner.roles]).ok, false, "but not as one login: tutor and junior tutor, parent and student, exclude each other");
    assert.equal(validateRoleSet(main.roles).ok, true);
    assert.equal(validateRoleSet(learner.roles).ok, true);
    assert.equal(learner.learnerOf, main.id, "the learner belongs to the person's own family");
    assert.deepEqual(dev.devRecordsFor(main.id, { NODE_ENV: "development" }), { tutorId: person.tutor, clientId: person.client });
    assert.deepEqual(dev.devRecordsFor(learner.id, { NODE_ENV: "development" }), { tutorId: person.juniorTutor, studentId: person.student });
    assert.equal(dev.devRecordsFor(main.id, { NODE_ENV: "production" }), undefined, "never in production");
  }
  // Every record the logins name exists, and each person's learner is taught by the NEXT person's tutor in a lesson that is on now.
  resetDataProvider();
  const data = getDataProvider();
  for (const person of TEAM) {
    for (const id of [person.tutor, person.juniorTutor]) assert.ok(await data.tutors.get(id), id);
    assert.ok(await data.clients.get(person.client));
    assert.ok(await data.students.get(person.student));
    const lesson = await data.lessons.get(`lesson-team-${person.key}-now`);
    const teacher = TEAM.find((t) => t.key === person.taughtBy);
    assert.equal(lesson.tutorId, teacher.tutor);
    assert.deepEqual(lesson.studentIds, [person.student]);
    const start = Date.parse(lesson.startAt);
    assert.ok(start <= Date.now() && Date.now() < start + lesson.durationMinutes * 60_000, "on right now, so the lesson chat can be tried at once");
    const juniorLesson = await data.lessons.get(`lesson-team-${person.key}-tomorrow`);
    assert.equal(juniorLesson.tutorId, person.juniorTutor, "the junior tutor record is assigned to a learner");
  }
  assert.equal(new Set(TEAM.map((p) => p.taughtBy)).size, 4, "everyone teaches someone, so no one is only talking to themselves");
});
