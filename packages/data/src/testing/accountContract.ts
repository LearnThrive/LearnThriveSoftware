/**
 * One behavioural contract for making accounts (docs/AUTHENTICATION.md "Accounts are made, not signed up for"), run against the in-memory
 * store and the Postgres store on PGlite. The refusals are the point: a login is only ever bound once, and nobody is converted.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AccountRole, LibraryStore } from "../library";

export interface AccountHarness {
  store: LibraryStore;
  /** A brand new login, as the Auth Admin API leaves it: a profile with role CLIENT and nothing bound. */
  login(): Promise<string>;
  /** A tutor record with no login. */
  tutor(active?: boolean): Promise<string>;
  /** An existing family (with its own login) and a student in it. */
  family(): Promise<{ guardian: string; clientId: string; studentId: string }>;
  auditRows(action: string, actor: string): Promise<Array<{ clientId: string | null; studentId: string | null }>>;
}

export function accountContract(name: string, make: () => Promise<{ harness: AccountHarness; close(): Promise<void> }>): void {
  describe(`making accounts contract: ${name}`, () => {
    let h: AccountHarness;
    let close: () => Promise<void>;
    let store: LibraryStore;
    let n = 0;
    const username = () => `person-${Date.now()}-${(n += 1)}`;
    const base = (role: AccountRole) => ({ username: username(), linkedEmail: "Parent@Example.test", displayName: "  A Person  ", role, actor: null });

    test("setup", async () => {
      const made = await make();
      h = made.harness;
      close = made.close;
      store = h.store;
    });

    test("a parent's login: bound to a new family, adult, must change their password, found by username, audited", async () => {
      const profileId = await h.login();
      const actor = await h.login();
      const input = { ...base("CLIENT"), profileId, actor };
      assert.equal(await store.accounts.provision(input), "ok");
      const account = await store.accounts.getAccount(profileId);
      assert.equal(account?.role, "CLIENT");
      assert.equal(account?.username, input.username);
      assert.equal(account?.linkedEmail, "parent@example.test", "the address is kept lower case");
      assert.equal(account?.displayName, "A Person");
      assert.equal(account?.mustChangePassword, true);
      assert.equal(account?.adultConfirmed, true);
      assert.ok(account?.clientId, "the family exists");
      assert.equal(await store.accounts.domainRef(profileId) === null, false);
      assert.equal((await store.accounts.findByUsername(input.username))?.profileId, profileId);
      assert.equal(await store.accounts.getEmail(profileId), "parent@example.test", "the address to write to is the linked one");
      assert.equal((await h.auditRows("account_created", actor)).length, 1);
    });

    test("a tutor's login is bound to the record, and an inactive record does not teach", async () => {
      const profileId = await h.login();
      const tutorId = await h.tutor();
      assert.equal(await store.accounts.provision({ ...base("TUTOR"), profileId, tutorId }), "ok");
      assert.equal((await store.accounts.getAccount(profileId))?.role, "TUTOR");
      assert.equal(await store.accounts.domainRef(profileId), tutorId);
      assert.equal(await store.accounts.tutorRef(profileId), tutorId);
    });

    test("an administrator may teach or not, and stays an administrator either way", async () => {
      const teaching = await h.login();
      const tutorId = await h.tutor();
      assert.equal(await store.accounts.provision({ ...base("ADMIN"), profileId: teaching, tutorId }), "ok");
      assert.equal((await store.accounts.getAccount(teaching))?.role, "ADMIN");
      assert.equal(await store.accounts.tutorRef(teaching), tutorId);

      const adminOnly = await h.login();
      assert.equal(await store.accounts.provision({ ...base("ADMIN"), profileId: adminOnly }), "ok");
      assert.equal((await store.accounts.getAccount(adminOnly))?.role, "ADMIN");
      assert.equal(await store.accounts.tutorRef(adminOnly), null, "an administrator who does not teach has no tutor record");
    });

    test("a child's login belongs to their family, is never an adult, and takes the family's linked address from the caller", async () => {
      const f = await h.family();
      const profileId = await h.login();
      assert.equal(await store.accounts.provision({ ...base("STUDENT"), profileId, studentId: f.studentId }), "ok");
      const account = await store.accounts.getAccount(profileId);
      assert.equal(account?.role, "STUDENT");
      assert.equal(account?.adultConfirmed, false);
      assert.equal(account?.clientId, null, "a learner never holds a family account");
      assert.equal(account?.learner?.studentId, f.studentId);
      assert.equal(account?.learner?.familyClientId, f.clientId);
    });

    test("a duplicate username is refused and the new login is left untouched", async () => {
      const first = await h.login();
      const input = base("CLIENT");
      assert.equal(await store.accounts.provision({ ...input, profileId: first }), "ok");
      const second = await h.login();
      assert.equal(await store.accounts.provision({ ...input, profileId: second }), "username_taken");
      const after = await store.accounts.getAccount(second);
      assert.equal(after?.username, null);
      assert.equal(after?.clientId, null, "no family was made");
    });

    test("nobody is converted: an account already bound, a family owner, a tutor record or student already taken", async () => {
      const bound = await h.login();
      assert.equal(await store.accounts.provision({ ...base("CLIENT"), profileId: bound }), "ok");
      assert.equal(await store.accounts.provision({ ...base("CLIENT"), profileId: bound }), "not_eligible", "a second binding");

      const f = await h.family();
      assert.equal(await store.accounts.provision({ ...base("TUTOR"), profileId: f.guardian, tutorId: await h.tutor() }), "not_eligible", "a family owner");

      const tutorId = await h.tutor();
      assert.equal(await store.accounts.provision({ ...base("TUTOR"), profileId: await h.login(), tutorId }), "ok");
      assert.equal(await store.accounts.provision({ ...base("TUTOR"), profileId: await h.login(), tutorId }), "not_eligible", "a tutor who already has a login");

      assert.equal(await store.accounts.provision({ ...base("STUDENT"), profileId: await h.login(), studentId: f.studentId }), "ok");
      assert.equal(await store.accounts.provision({ ...base("STUDENT"), profileId: await h.login(), studentId: f.studentId }), "not_eligible", "a student who already has a login");
    });

    test("the role and the record must agree", async () => {
      const f = await h.family();
      assert.equal(await store.accounts.provision({ ...base("TUTOR"), profileId: await h.login() }), "not_eligible", "a tutor with no record");
      assert.equal(await store.accounts.provision({ ...base("STUDENT"), profileId: await h.login() }), "not_eligible", "a learner with no student");
      assert.equal(await store.accounts.provision({ ...base("CLIENT"), profileId: await h.login(), studentId: f.studentId }), "not_eligible", "a parent named as a student");
      assert.equal(await store.accounts.provision({ ...base("CLIENT"), profileId: await h.login(), tutorId: await h.tutor() }), "not_eligible", "a parent named as a tutor");
      assert.equal(await store.accounts.provision({ ...base("CLIENT"), profileId: "00000000-0000-4000-8000-000000000000" }), "no_profile");
    });

    test("the flags can be set and cleared, and a corrected address is what is used", async () => {
      const profileId = await h.login();
      assert.equal(await store.accounts.provision({ ...base("CLIENT"), profileId }), "ok");
      await store.accounts.setMustChangePassword(profileId, false);
      assert.equal((await store.accounts.getAccount(profileId))?.mustChangePassword, false);
      await store.accounts.setLinkedEmail(profileId, "new@example.test");
      assert.equal(await store.accounts.getEmail(profileId), "new@example.test");
      await store.accounts.setLoginDisabled(profileId, new Date());
      assert.equal((await store.accounts.getAccount(profileId))?.loginDisabled, true);
      await store.accounts.setLoginDisabled(profileId, null);
      assert.equal((await store.accounts.getAccount(profileId))?.loginDisabled, false);
    });

    test("a child's linked address follows their parent's, and only that family's", async () => {
      const f = await h.family();
      const other = await h.family();
      const child = await h.login();
      const stranger = await h.login();
      assert.equal(await store.accounts.provision({ ...base("STUDENT"), profileId: child, studentId: f.studentId }), "ok");
      assert.equal(await store.accounts.provision({ ...base("STUDENT"), profileId: stranger, studentId: other.studentId, linkedEmail: "other@example.test" }), "ok");
      await store.accounts.setLinkedEmail(f.guardian, "moved@example.test");
      assert.equal((await store.accounts.getAccount(child))?.linkedEmail, "moved@example.test");
      assert.equal((await store.accounts.getAccount(stranger))?.linkedEmail, "other@example.test");
    });

    test("teardown", async () => {
      await close();
    });
  });
}
