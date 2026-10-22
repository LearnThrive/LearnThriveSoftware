import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The development accounts behind the one sign-in: the shared list, the seeding, and the mapping to the signed-in app's user.

const dev = loadTsFrom(import.meta.url, "../src/lib/dev/accounts.ts");
const { seedDevAccounts } = loadTsFrom(import.meta.url, "../src/lib/dev/seedAccounts.ts");
const { toPlatformUser } = loadTsFrom(import.meta.url, "../src/lib/access/platformUser.ts");
const { MemoryAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/memoryAuth.ts");
const { getAuthProvider } = loadTsFrom(import.meta.url, "../src/lib/auth/devProvider.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");
const { platformAccess } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/access.ts");

const byEmail = (email) => dev.DEV_ACCOUNTS.find((account) => account.email === email);

test("the list: unique ids and addresses, all on the reserved .dev domain, a role each, and the five staff-provider accounts unchanged", () => {
  const accounts = dev.DEV_ACCOUNTS;
  assert.equal(new Set(accounts.map((a) => a.id)).size, accounts.length, "ids are unique");
  assert.equal(new Set(accounts.map((a) => a.email.toLowerCase())).size, accounts.length, "addresses are unique");
  for (const a of accounts) {
    assert.match(a.email, /^[a-z]+@learnthrive\.dev$/, a.email);
    assert.match(a.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "a real UUID shape, so nothing that validates ids refuses it");
    assert.ok(["ADMIN", "TUTOR", "CLIENT", "STUDENT"].includes(a.role));
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
  };
  for (const account of dev.DEV_ACCOUNTS) {
    const result = await auth.signIn(account.email, account.password);
    if (!account.active) {
      assert.equal(result.ok, false);
      assert.equal(result.reason, "account_disabled", account.email);
      continue;
    }
    assert.equal(result.ok, true, account.email);
    assert.equal(result.user.id, account.id, "the sign-in id is the list's id");
    const profile = await store.accounts.getAccount(account.id);
    assert.equal(profile.role, account.role, account.email);
    assert.equal(profile.adultConfirmed, true);
    // A learner's facts are their own (their own tuition, the household's Library benefit); everyone else's are the family's.
    const facts = profile.learner ? await store.access.learnerFacts(profile.learner.studentId) : profile.clientId ? await store.access.facts(profile.clientId) : { enrolled: false, subscription: false, adminGrant: false };
    assert.equal(platformAccess(profile.role, facts).tier, expected[account.email], account.email);
  }
  const student = await store.accounts.getAccount(byEmail("student@learnthrive.dev").id);
  assert.equal(student.clientId, null, "the development student is a learner: no family account of their own");
  assert.equal(student.learner.familyClientId, (await store.accounts.getAccount(byEmail("client@learnthrive.dev").id)).clientId, "of the development client's family");
  const member = await store.accounts.getAccount(byEmail("member@learnthrive.dev").id);
  const memberAccess = platformAccess("CLIENT", await store.access.facts(member.clientId));
  assert.deepEqual(memberAccess, { tier: "library", dashboard: false, library: true, studyBuddy: true }, "a subscriber has Study Buddy and the Library, and no dashboard");
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
    toPlatformUser({ email: client.email, displayName: "Signup Name" }, { profileId: client.id, role: "CLIENT", displayName: "Profile Name" }, env),
    { id: client.id, email: client.email, role: "CLIENT", name: "Profile Name", profileId: "client-sarah-ahmed" },
  );
  assert.equal(toPlatformUser({ email: "a@b.co", displayName: "Signup Name" }, { profileId: "x", role: "ADMIN", displayName: "" }, env).name, "Signup Name", "then the sign-up name");
  assert.equal(toPlatformUser({ email: "a@b.co", displayName: "" }, { profileId: "x", role: "ADMIN", displayName: "" }, env).name, "a@b.co", "then the address");
  assert.equal(toPlatformUser({ email: "a@b.co", displayName: "" }, { profileId: "x", role: "TUTOR", displayName: "T" }, env).profileId, undefined, "no invented link for an account the development data does not know");
  assert.equal(toPlatformUser({ email: client.email, displayName: "" }, { profileId: client.id, role: "CLIENT", displayName: "C" }, { NODE_ENV: "production" }).profileId, undefined);
});
