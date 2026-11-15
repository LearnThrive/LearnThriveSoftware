/**
 * One behavioural contract for a person holding several roles, run against the in-memory store and Postgres on PGlite. It proves the store
 * side of the rules in roles.ts: who may change roles, what is refused and that a refusal changes and audits nothing, the records a person
 * with several roles has, and that nothing a person can send sets a role.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LibraryStore } from "../library";
import type { Role } from "../roles";

export interface RolesHarness {
  store: LibraryStore;
  /** A person holding exactly these roles, with the records those roles need (a tutor record for a tutor, a learner login for a student). */
  person(roles: Role[]): Promise<{ profileId: string; tutorId: string | null; studentId: string | null }>;
  /** A person holding exactly these roles and NO records (so a role that needs one cannot be added to them). */
  bare(roles: Role[]): Promise<string>;
}

export function rolesContract(name: string, make: () => Promise<{ harness: RolesHarness; close(): Promise<void> }>): void {
  describe(`roles contract: ${name}`, () => {
    let h: RolesHarness;
    let close: () => Promise<void>;
    let store: LibraryStore;
    const now = new Date("2026-11-15T10:00:00Z");

    test("setup", async () => {
      ({ harness: h, close } = await make());
      store = h.store;
    });

    const rolesOf = async (id: string) => (await store.accounts.getAccount(id))!.roles;
    const historyCount = async () => (await store.accounts.roleHistory(undefined, 500)).length;

    test("an account carries every role it holds, in order, and its primary role is the highest", async () => {
      const both = await h.person(["ADMIN", "TUTOR"]);
      const account = (await store.accounts.getAccount(both.profileId))!;
      assert.deepEqual(account.roles, ["ADMIN", "TUTOR"]);
      assert.equal(account.role, "ADMIN");
      const learnerTutor = await h.person(["JUNIOR_TUTOR", "STUDENT"]);
      const second = (await store.accounts.getAccount(learnerTutor.profileId))!;
      assert.deepEqual(second.roles, ["JUNIOR_TUTOR", "STUDENT"]);
      assert.equal(second.role, "JUNIOR_TUTOR");
      assert.ok(second.learner, "the learner context is there because they are a student too, whatever their primary role");
    });

    test("a person with several roles has EACH of their records, not one", async () => {
      const p = await h.person(["JUNIOR_TUTOR", "STUDENT"]);
      const records = await store.accounts.records(p.profileId);
      assert.equal(records.tutorId, p.tutorId);
      assert.equal(records.studentId, p.studentId);
      assert.equal(records.clientId, null, "and no family, because they are not a parent");
      assert.deepEqual(await store.accounts.records((await h.bare(["CLIENT"]))), { tutorId: null, clientId: null, studentId: null });
    });

    test("an administrator adds a role to someone else; it is audited with who, when, before and after", async () => {
      const admin = await h.person(["ADMIN"]);
      const withRecord = await h.person(["TUTOR"]);
      const before = await historyCount();
      const result = await store.accounts.changeRoles({ actor: admin.profileId, profileId: withRecord.profileId, roles: ["ADMIN", "TUTOR"], now });
      assert.deepEqual(result, { status: "changed", before: ["TUTOR"], after: ["ADMIN", "TUTOR"] });
      assert.deepEqual(await rolesOf(withRecord.profileId), ["ADMIN", "TUTOR"]);
      const [entry] = await store.accounts.roleHistory(withRecord.profileId);
      assert.equal(await historyCount(), before + 1);
      assert.equal(entry!.actorProfileId, admin.profileId);
      assert.equal(entry!.targetProfileId, withRecord.profileId);
      assert.deepEqual([entry!.before, entry!.after], [["TUTOR"], ["ADMIN", "TUTOR"]]);
      assert.equal(entry!.at.toISOString(), now.toISOString());
    });

    test("a role is removed the same way, and a person can change from tutor to junior tutor in one step", async () => {
      const admin = await h.person(["ADMIN"]);
      const t = await h.person(["ADMIN", "TUTOR"]);
      assert.deepEqual((await store.accounts.changeRoles({ actor: admin.profileId, profileId: t.profileId, roles: ["TUTOR"], now })).status, "changed");
      assert.deepEqual(await rolesOf(t.profileId), ["TUTOR"]);
      const swap = await store.accounts.changeRoles({ actor: admin.profileId, profileId: t.profileId, roles: ["JUNIOR_TUTOR"], now });
      assert.deepEqual(swap, { status: "changed", before: ["TUTOR"], after: ["JUNIOR_TUTOR"] });
    });

    test("a refusal changes nothing and writes no audit row", async () => {
      const admin = await h.person(["ADMIN"]);
      const tutor = await h.person(["TUTOR"]);
      const student = await h.person(["STUDENT"]);
      const before = await historyCount();
      const refusal = async (actor: string, target: string, roles: readonly unknown[]) => {
        const r = await store.accounts.changeRoles({ actor, profileId: target, roles, now });
        assert.equal(r.status, "refused");
        return r.status === "refused" ? r.reason : "";
      };
      assert.equal(await refusal(tutor.profileId, student.profileId, ["STUDENT", "ADMIN"]), "NOT_ADMIN", "a tutor cannot assign roles");
      assert.equal(await refusal(student.profileId, student.profileId, ["STUDENT", "ADMIN"]), "NOT_ADMIN", "a student cannot make themselves anything");
      assert.equal(await refusal(admin.profileId, admin.profileId, ["ADMIN", "TUTOR"]), "SELF", "not even an administrator can change their own roles");
      assert.equal(await refusal(admin.profileId, tutor.profileId, ["TUTOR", "JUNIOR_TUTOR"]), "EXCLUSIVE", "tutor and junior tutor cannot coexist");
      assert.equal(await refusal(admin.profileId, tutor.profileId, []), "EMPTY");
      assert.equal(await refusal(admin.profileId, tutor.profileId, ["TUTOR", "OWNER"]), "UNKNOWN_ROLE");
      assert.equal(await refusal(admin.profileId, tutor.profileId, [{ role: "ADMIN" }]), "UNKNOWN_ROLE", "an object is not a role");
      assert.equal(await refusal(admin.profileId, tutor.profileId, ["TUTOR"]), "UNCHANGED");
      assert.equal(await refusal(admin.profileId, "00000000-0000-4000-8000-000000000000", ["CLIENT"]), "NOT_FOUND");
      assert.deepEqual(await rolesOf(tutor.profileId), ["TUTOR"]);
      assert.deepEqual(await rolesOf(student.profileId), ["STUDENT"]);
      assert.deepEqual(await rolesOf(admin.profileId), ["ADMIN"]);
      assert.equal(await historyCount(), before, "nothing was audited because nothing happened");
    });

    test("a role that means 'this person's own record' cannot be given to someone who has no such record", async () => {
      const admin = await h.person(["ADMIN"]);
      const bare = await h.bare(["CLIENT"]);
      const noRecord = await store.accounts.changeRoles({ actor: admin.profileId, profileId: bare, roles: ["CLIENT", "TUTOR"], now });
      assert.deepEqual(noRecord.status === "refused" && noRecord.reason, "NEEDS_RECORD");
      const noLearner = await store.accounts.changeRoles({ actor: admin.profileId, profileId: await h.bare(["TUTOR"]), roles: ["TUTOR", "STUDENT"], now });
      assert.deepEqual(noLearner.status === "refused" && noLearner.reason, "NEEDS_RECORD");
      assert.deepEqual(await rolesOf(bare), ["CLIENT"]);
    });

    test("the last administrator keeps the role: nobody else can remove it and they cannot remove it themselves", async () => {
      const sole = await h.person(["ADMIN"]);
      // Only an administrator can change a role, and not their own, so the one remaining administrator is out of everyone's reach.
      const admins = (await store.accounts.listProfiles()).filter((p) => p.roles.includes("ADMIN"));
      const others = admins.filter((p) => p.profileId !== sole.profileId);
      // Remove every other administrator through the sole one, so that exactly one is left.
      for (const other of others) await store.accounts.changeRoles({ actor: sole.profileId, profileId: other.profileId, roles: other.roles.filter((r) => r !== "ADMIN").length ? other.roles.filter((r) => r !== "ADMIN") : ["CLIENT"], now });
      assert.deepEqual((await store.accounts.listProfiles()).filter((p) => p.roles.includes("ADMIN")).map((p) => p.profileId), [sole.profileId]);
      const self = await store.accounts.changeRoles({ actor: sole.profileId, profileId: sole.profileId, roles: ["CLIENT"], now });
      assert.deepEqual(self.status === "refused" && self.reason, "SELF");
      const tutor = await h.person(["TUTOR"]);
      const byTutor = await store.accounts.changeRoles({ actor: tutor.profileId, profileId: sole.profileId, roles: ["CLIENT"], now });
      assert.deepEqual(byTutor.status === "refused" && byTutor.reason, "NOT_ADMIN");
      assert.deepEqual(await rolesOf(sole.profileId), ["ADMIN"], "still an administrator");
    });

    test("the roles screen's list shows each person once with all their roles, and nothing private", async () => {
      const p = await h.person(["ADMIN", "TUTOR"]);
      const listed = (await store.accounts.listProfiles()).find((x) => x.profileId === p.profileId)!;
      assert.deepEqual(listed.roles, ["ADMIN", "TUTOR"]);
      assert.deepEqual(Object.keys(listed).sort(), ["displayName", "loginDisabled", "profileId", "roles", "username"]);
    });

    test("teardown", async () => {
      await close();
    });
  });
}
