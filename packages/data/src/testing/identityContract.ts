/**
 * One behavioural contract for learner identity (docs/IDENTITY.md), run against the in-memory store, the Postgres store on PGlite and
 * the real local Supabase stack. The adversarial cases are the point: cross-family, replay, expiry, revocation, forged eligibility.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import type { AccountRole, LibraryStore, LinkStatus } from "../library";

export interface IdentityHarness {
  store: LibraryStore;
  /** An auth user with a profile (role CLIENT). Adult declaration on by default; a learner signs up without it. */
  profile(options?: { adult?: boolean; email?: string; role?: AccountRole }): Promise<string>;
  /** A student under the profile's family account (the family is created if needed). */
  student(profileId: string, options?: { displayName?: string; yearGroup?: string | null; isMinor?: boolean }): Promise<string>;
  /** A second guardian: this profile's family is linked to the student. */
  guardianLink(studentId: string, profileId: string, status?: LinkStatus): Promise<void>;
  /** An assignment (any status) with this student on it; returns its id. */
  assignment(studentId: string, status?: "ACTIVE" | "PAUSED" | "ENDED"): Promise<string>;
  setAssignment(assignmentId: string, status: "ACTIVE" | "PAUSED" | "ENDED"): Promise<void>;
  entitlement(profileId: string, source: "subscription" | "admin_grant", startsAt: Date, endsAt: Date | null): Promise<void>;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const token = () => randomBytes(24).toString("base64url");
const HOUR = 3_600_000;
const SHA64 = "b".repeat(64);

export function identityContract(name: string, make: () => Promise<{ harness: IdentityHarness; close(): Promise<void> }>): void {
  describe(`learner identity contract: ${name}`, () => {
    let h: IdentityHarness;
    let close: () => Promise<void>;
    let store: LibraryStore;
    const now = () => new Date();
    let n = 0;
    const email = () => `learner-${Date.now()}-${(n += 1)}@example.test`;

    async function family(studentOptions?: { yearGroup?: string | null; isMinor?: boolean }) {
      const guardian = await h.profile({ adult: true });
      const clientId = await store.accounts.ensureClient(guardian);
      const studentId = await h.student(guardian, { displayName: "Kid", ...studentOptions });
      return { guardian, clientId, studentId };
    }

    /** Invites and returns the plain token (only its hash goes to the store). */
    async function invite(f: { guardian: string; clientId: string; studentId: string }, over: { email?: string | null; expiresInMs?: number; maxPerDay?: number; at?: Date } = {}) {
      const plain = token();
      const at = over.at ?? now();
      const made = await store.identity.createInvitation({
        clientId: f.clientId, studentId: f.studentId, invitedBy: f.guardian, email: over.email === undefined ? null : over.email,
        tokenHash: sha(plain), expiresAt: new Date(at.getTime() + (over.expiresInMs ?? 72 * HOUR)), maxPerDay: over.maxPerDay ?? 5, now: at,
      });
      return { plain, made };
    }

    const accept = (plain: string, profileId: string, address: string, at = now()) => store.identity.acceptInvitation({ tokenHash: sha(plain), profileId, email: address, now: at });

    test("setup", async () => {
      ({ harness: h, close } = await make());
      store = h.store;
    });

    test("a guardian invites a student, the learner accepts: one login, role STUDENT, no family account of their own", async () => {
      const f = await family({ yearGroup: "Year 9" });
      const { plain, made } = await invite(f, { email: "Kid@Example.Test" });
      assert.equal(made.ok, true);
      if (!made.ok) return;
      assert.equal(made.invitation.email, "kid@example.test", "kept in lower case");
      assert.equal(made.invitation.acceptedAt, null);
      const learnerProfile = await h.profile({ adult: false, email: "kid@example.test" });
      assert.equal((await store.accounts.getAccount(learnerProfile))?.learner, null, "not a learner yet");
      const done = await accept(plain, learnerProfile, "KID@example.test");
      assert.deepEqual(done, { ok: true, studentId: f.studentId, clientId: f.clientId }, "the address matches whatever its case");
      const account = await store.accounts.getAccount(learnerProfile);
      assert.equal(account?.role, "STUDENT");
      assert.equal(account?.clientId, null, "a learner never has a family account of their own");
      assert.equal(account?.adultConfirmed, false, "never marked as an adult");
      assert.deepEqual(account?.learner, { studentId: f.studentId, familyClientId: f.clientId, status: "active", displayName: "Kid", yearGroup: "Year 9", isMinor: true, accessMode: "direct", guardianActive: true });
      assert.equal((await store.identity.getLearner(learnerProfile))?.studentId, f.studentId);
      assert.equal((await store.identity.getLearnerByStudent(f.studentId))?.status, "active");
      await assert.rejects(store.accounts.ensureClient(learnerProfile), /./, "a learner cannot become a paying family account");
      assert.equal((await store.accounts.getAccount(learnerProfile))?.clientId, null);
      const listed = await store.identity.listFamilyStudents(f.clientId);
      assert.deepEqual(listed.map((s) => [s.displayName, s.learnerStatus, s.invitationOpen, s.accessMode]), [["Kid", "active", false, "direct"]]);
    });

    test("an invitation is single use: replaying it, even by the same person, fails", async () => {
      const f = await family();
      const { plain } = await invite(f);
      const first = await h.profile({ adult: false });
      assert.equal((await accept(plain, first, email())).ok, true);
      const other = await h.profile({ adult: false });
      assert.deepEqual(await accept(plain, other, email()), { ok: false, reason: "used" });
      assert.deepEqual(await accept(plain, first, email()), { ok: false, reason: "used" });
      assert.equal((await store.accounts.getAccount(other))?.role, "CLIENT", "the second account gained nothing");
      assert.equal((await store.accounts.getAccount(other))?.learner, null);
    });

    test("two accounts racing for one invitation: exactly one wins", async () => {
      const f = await family();
      const { plain } = await invite(f);
      const a = await h.profile({ adult: false });
      const b = await h.profile({ adult: false });
      const results = await Promise.all([accept(plain, a, email()), accept(plain, b, email())]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.equal((await store.identity.getLearnerByStudent(f.studentId)) !== null, true);
    });

    test("an unknown token, an expired one and a revoked one fail with distinct reasons and change nothing", async () => {
      const f = await family();
      const probe = await h.profile({ adult: false });
      assert.deepEqual(await accept(token(), probe, email()), { ok: false, reason: "invalid" });
      const past = new Date(Date.now() - 100 * HOUR);
      const { plain: old } = await invite(f, { at: past, expiresInMs: HOUR });
      assert.deepEqual(await accept(old, probe, email()), { ok: false, reason: "expired" });
      const { plain: fresh, made } = await invite(f);
      assert.ok(made.ok);
      if (!made.ok) return;
      assert.equal(await store.identity.revokeInvitation(f.clientId, made.invitation.id, f.guardian, now()), true);
      assert.deepEqual(await accept(fresh, probe, email()), { ok: false, reason: "revoked" });
      assert.equal(await store.identity.revokeInvitation(f.clientId, made.invitation.id, f.guardian, now()), false, "already revoked");
      assert.equal((await store.accounts.getAccount(probe))?.role, "CLIENT");
      assert.equal(await store.identity.getLearnerByStudent(f.studentId), null);
    });

    test("re-inviting replaces the open invitation: the old link stops working, the new one works", async () => {
      const f = await family();
      const first = await invite(f);
      const second = await invite(f);
      const learner = await h.profile({ adult: false });
      assert.deepEqual(await accept(first.plain, learner, email()), { ok: false, reason: "revoked" });
      assert.equal((await accept(second.plain, learner, email())).ok, true);
      const invitations = await store.identity.listInvitations(f.clientId, f.studentId);
      assert.equal(invitations.length, 2);
      assert.equal(invitations.filter((i) => i.acceptedAt).length, 1);
      assert.equal(JSON.stringify(invitations).includes("tokenHash"), false, "a listing never carries the token hash");
    });

    test("peeking at an invitation reads its state without spending it", async () => {
      const f = await family();
      const { plain, made } = await invite(f, { email: "peek@example.test" });
      assert.ok(made.ok);
      if (!made.ok) return;
      assert.deepEqual(await store.identity.peekInvitation(sha(plain), now()), { state: "open", email: "peek@example.test" });
      assert.deepEqual(await store.identity.peekInvitation(sha(plain), now()), { state: "open", email: "peek@example.test" }, "reading it twice changes nothing");
      assert.deepEqual(await store.identity.peekInvitation(sha(token()), now()), { state: "invalid" });
      assert.deepEqual(await store.identity.peekInvitation(sha(plain), new Date(Date.now() + 100 * HOUR)), { state: "expired" });
      await store.identity.revokeInvitation(f.clientId, made.invitation.id, f.guardian, now());
      assert.deepEqual(await store.identity.peekInvitation(sha(plain), now()), { state: "revoked" });
      const g = await family();
      const second = await invite(g);
      const learner = await h.profile({ adult: false });
      await accept(second.plain, learner, email());
      assert.deepEqual(await store.identity.peekInvitation(sha(second.plain), now()), { state: "used" });
    });

    test("an invitation tied to an address is accepted only by that address", async () => {
      const f = await family();
      const { plain } = await invite(f, { email: "right@example.test" });
      const wrong = await h.profile({ adult: false });
      assert.deepEqual(await accept(plain, wrong, "wrong@example.test"), { ok: false, reason: "email_mismatch" });
      assert.equal(await store.identity.getLearnerByStudent(f.studentId), null);
      const right = await h.profile({ adult: false });
      assert.equal((await accept(plain, right, "RIGHT@example.test")).ok, true);
    });

    test("another family cannot invite, revoke, list or even see this student", async () => {
      const a = await family();
      const b = await family();
      const crossed = await store.identity.createInvitation({ clientId: b.clientId, studentId: a.studentId, invitedBy: b.guardian, email: null, tokenHash: sha(token()), expiresAt: new Date(Date.now() + HOUR), maxPerDay: 5, now: now() });
      assert.deepEqual(crossed, { ok: false, reason: "not_found" });
      const { made } = await invite(a);
      assert.ok(made.ok);
      if (!made.ok) return;
      assert.equal(await store.identity.revokeInvitation(b.clientId, made.invitation.id, b.guardian, now()), false);
      assert.deepEqual(await store.identity.listInvitations(b.clientId, a.studentId), []);
      assert.equal(await store.identity.getFamilyStudent(b.clientId, a.studentId), null);
      assert.deepEqual((await store.identity.listFamilyStudents(b.clientId)).map((s) => s.id), [b.studentId]);
      assert.equal(await store.identity.setAccessMode(b.clientId, a.studentId, "supervised", b.guardian, now()), false);
      assert.equal(await store.identity.setLearnerStatus({ studentId: a.studentId, clientId: b.clientId, status: "suspended", actor: b.guardian, now: now() }), false);
    });

    test("who can become a learner: a plain account only. Not a family owner, not staff, not someone who already is one", async () => {
      const f = await family();
      const { plain } = await invite(f);
      const owner = await h.profile({ adult: true });
      await store.accounts.ensureClient(owner);
      assert.deepEqual(await accept(plain, owner, email()), { ok: false, reason: "not_eligible" }, "an account that pays for a family");
      for (const role of ["ADMIN", "TUTOR"] as const) {
        const staff = await h.profile({ adult: true, role });
        assert.deepEqual(await accept(plain, staff, email()), { ok: false, reason: "not_eligible" }, role);
        assert.equal((await store.accounts.getAccount(staff))?.role, role, "the role is untouched");
      }
      const g = await family();
      const { plain: otherToken } = await invite(g);
      const existing = await h.profile({ adult: false });
      assert.equal((await accept(otherToken, existing, email())).ok, true);
      const { plain: third } = await invite(f);
      assert.deepEqual(await accept(third, existing, email()), { ok: false, reason: "not_eligible" }, "one login for one student");
      assert.equal(await store.identity.getLearnerByStudent(f.studentId), null, "the student was not bound to the wrong person");
    });

    test("a student with a live login cannot be invited again; at most N invitations a day", async () => {
      const f = await family();
      const { plain } = await invite(f);
      const learner = await h.profile({ adult: false });
      assert.equal((await accept(plain, learner, email())).ok, true);
      const again = await invite(f);
      assert.deepEqual(again.made, { ok: false, reason: "already_learner" });

      const g = await family();
      for (let i = 0; i < 3; i += 1) assert.equal((await invite(g, { maxPerDay: 3 })).made.ok, true);
      assert.deepEqual((await invite(g, { maxPerDay: 3 })).made, { ok: false, reason: "limit" });
    });

    test("suspending, restoring and revoking a learner is audited and takes effect at once; revoked can be re-invited", async () => {
      const f = await family();
      const { plain } = await invite(f);
      const learner = await h.profile({ adult: false });
      assert.equal((await accept(plain, learner, email())).ok, true);
      const set = (status: LinkStatus, who: string | null = f.clientId) => store.identity.setLearnerStatus({ studentId: f.studentId, clientId: who, status, actor: f.guardian, now: now() });
      assert.equal(await set("suspended"), true);
      assert.equal((await store.accounts.getAccount(learner))?.learner?.status, "suspended");
      assert.equal(await set("active"), true);
      assert.equal((await store.accounts.getAccount(learner))?.learner?.status, "active");
      assert.equal(await set("revoked", null), true, "staff (no family) may too");
      const after = await store.accounts.getAccount(learner);
      assert.equal(after?.learner?.status, "revoked");
      assert.equal(after?.learner?.accessMode, "none", "revoking the login closes the way in");
      assert.deepEqual((await store.identity.auditFor(f.studentId)).map((a) => a.action), ["learner_revoked", "learner_restored", "learner_suspended", "invitation_accepted", "invitation_created"]);
      assert.equal(JSON.stringify(await store.identity.auditFor(f.studentId)).includes("@"), false, "the audit trail holds ids and actions, never an address");
      // The student can be invited again and bound to a NEW login; the revoked one stays revoked and cannot be reused.
      const next = await invite(f);
      assert.equal(next.made.ok, true);
      const fresh = await h.profile({ adult: false });
      assert.equal((await accept(next.plain, fresh, email())).ok, true);
      assert.equal((await store.accounts.getAccount(fresh))?.learner?.status, "active");
      const reuse = await invite(f);
      assert.deepEqual(reuse.made, { ok: false, reason: "already_learner" });
    });

    test("access mode: supervised for anyone, direct only once there is a login, and only the owning family sets it", async () => {
      const f = await family();
      assert.equal(await store.identity.setAccessMode(f.clientId, f.studentId, "direct", f.guardian, now()), false, "no login yet");
      assert.equal(await store.identity.setAccessMode(f.clientId, f.studentId, "supervised", f.guardian, now()), true);
      assert.equal((await store.identity.getFamilyStudent(f.clientId, f.studentId))?.accessMode, "supervised");
      assert.equal(await store.identity.setAccessMode(f.clientId, f.studentId, "none", f.guardian, now()), true);
    });

    test("tuition follows each learner's own enrolment; the household benefit follows the family; both end with the assignment", async () => {
      const f = await family();
      const sibling = await h.student(f.guardian, { displayName: "Sib" });
      const none = await store.access.learnerFacts(f.studentId);
      assert.deepEqual(none, { enrolled: false, subscription: false, adminGrant: false, ownTuition: false });
      const a = await h.assignment(sibling, "ACTIVE");
      const mine = await store.access.learnerFacts(f.studentId);
      assert.equal(mine.enrolled, true, "the household is enrolled, so the family's Library benefit reaches this learner");
      assert.equal(mine.ownTuition, false, "but the sibling's lessons are not this learner's");
      assert.equal((await store.access.learnerFacts(sibling)).ownTuition, true);
      assert.equal((await store.access.facts(f.clientId)).enrolled, true);
      await h.setAssignment(a, "ENDED");
      assert.deepEqual(await store.access.learnerFacts(sibling), { enrolled: false, subscription: false, adminGrant: false, ownTuition: false });
      // A separately paid Library subscription is independent of tuition and survives its end.
      await h.entitlement(f.guardian, "subscription", new Date(Date.now() - HOUR), null);
      const sub = await store.access.learnerFacts(f.studentId);
      assert.equal(sub.subscription, true);
      assert.equal(sub.ownTuition, false);
    });

    test("a revoked or suspended guardian link gives a second guardian nothing, and ends the benefit for the learner it was theirs through", async () => {
      const f = await family();
      const second = await h.profile({ adult: true });
      const secondClient = await store.accounts.ensureClient(second);
      await h.guardianLink(f.studentId, second);
      await h.assignment(f.studentId, "ACTIVE");
      assert.equal((await store.access.facts(secondClient)).enrolled, true, "enrolment reaches a second guardian through an active link");
      assert.equal((await store.identity.getFamilyStudent(secondClient, f.studentId))?.id, f.studentId);
      for (const status of ["suspended", "revoked"] as const) {
        assert.equal(await store.identity.setGuardianLinkStatus({ ownerClientId: f.clientId, studentId: f.studentId, guardianClientId: secondClient, status, actor: f.guardian, now: now() }), true);
        assert.equal((await store.access.facts(secondClient)).enrolled, false, status);
        assert.equal(await store.identity.getFamilyStudent(secondClient, f.studentId), null, status);
        assert.deepEqual((await store.identity.listFamilyStudents(secondClient)).length, 0, status);
      }
      assert.equal(await store.identity.setGuardianLinkStatus({ ownerClientId: f.clientId, studentId: f.studentId, guardianClientId: f.clientId, status: "revoked", actor: f.guardian, now: now() }), false, "the owning family's link cannot be revoked here");
      assert.equal((await store.access.facts(f.clientId)).enrolled, true);
      const stranger = await family();
      assert.equal(await store.identity.setGuardianLinkStatus({ ownerClientId: stranger.clientId, studentId: f.studentId, guardianClientId: secondClient, status: "active", actor: stranger.guardian, now: now() }), false, "only the owner's family manages the link");
    });

    test("a learner's context carries their live state and their own tuition facts", async () => {
      const f = await family();
      const { plain } = await invite(f);
      const learner = await h.profile({ adult: false });
      assert.equal((await accept(plain, learner, email())).ok, true);
      await h.assignment(f.studentId, "ACTIVE");
      assert.equal((await store.access.learnerFacts(f.studentId)).ownTuition, true);
      assert.equal((await store.accounts.getAccount(learner))?.learner?.guardianActive, true);
    });

    test("guardian consent for Study Buddy: given by a linked guardian, withdrawn at once, and void when that guardian's link is revoked", async () => {
      const f = await family();
      assert.equal(await store.identity.hasLearnerConsent(f.studentId), false);
      const stranger = await family();
      assert.equal(await store.identity.grantLearnerConsent({ studentId: f.studentId, guardianProfileId: stranger.guardian, version: "1", textSha256: SHA64, now: now() }), false, "another family's adult cannot consent");
      assert.equal(await store.identity.grantLearnerConsent({ studentId: f.studentId, guardianProfileId: f.guardian, version: "1", textSha256: SHA64, now: now() }), true);
      assert.equal(await store.identity.hasLearnerConsent(f.studentId), true);
      assert.equal(await store.identity.withdrawLearnerConsent(f.studentId, now()), 1);
      assert.equal(await store.identity.hasLearnerConsent(f.studentId), false, "withdrawal closes it");
      assert.equal(await store.identity.withdrawLearnerConsent(f.studentId, now()), 0);
      // A second guardian's consent counts only while their link is active.
      const second = await h.profile({ adult: true });
      const secondClient = await store.accounts.ensureClient(second);
      await h.guardianLink(f.studentId, second);
      assert.equal(await store.identity.grantLearnerConsent({ studentId: f.studentId, guardianProfileId: second, version: "1", textSha256: SHA64, now: now() }), true);
      assert.equal(await store.identity.hasLearnerConsent(f.studentId), true);
      await store.identity.setGuardianLinkStatus({ ownerClientId: f.clientId, studentId: f.studentId, guardianClientId: secondClient, status: "revoked", actor: f.guardian, now: now() });
      assert.equal(await store.identity.hasLearnerConsent(f.studentId), false, "their consent lapses with their link");
    });

    test("a supervised view: only a guardian's own, for a student set to supervised, ended by leaving, expiry, mode change or a lost link", async () => {
      const f = await family({ yearGroup: "Year 2" });
      const stranger = await family();
      const supervised = await store.identity.setAccessMode(f.clientId, f.studentId, "supervised", f.guardian, now());
      assert.equal(supervised, true);
      const plain = token();
      const start = (over: { guardian?: string; clientId?: string; studentId?: string; plain?: string; expiresInMs?: number } = {}) =>
        store.identity.startSupervised({ clientId: over.clientId ?? f.clientId, guardianProfileId: over.guardian ?? f.guardian, studentId: over.studentId ?? f.studentId, tokenHash: sha(over.plain ?? plain), expiresAt: new Date(Date.now() + (over.expiresInMs ?? HOUR)), now: now() });
      assert.equal(await start({ guardian: stranger.guardian, clientId: stranger.clientId }), false, "another family's guardian cannot view this learner");
      assert.equal(await start({ guardian: stranger.guardian }), false, "nor can one claim another family's client id");
      assert.equal(await start(), true);
      const ctx = await store.identity.getSupervised(sha(plain), f.guardian, now());
      assert.deepEqual(ctx, { studentId: f.studentId, familyClientId: f.clientId, status: "active", displayName: "Kid", yearGroup: "Year 2", isMinor: true, accessMode: "supervised", guardianActive: true });
      assert.equal(await store.identity.getSupervised(sha(plain), stranger.guardian, now()), null, "another guardian cannot use the token");
      assert.equal(await store.identity.getSupervised(sha(token()), f.guardian, now()), null, "an unknown token");
      assert.equal(await store.identity.getSupervised(sha(plain), f.guardian, new Date(Date.now() + 2 * HOUR)), null, "expired");

      // A new view replaces the old one.
      const next = token();
      assert.equal(await start({ plain: next }), true);
      assert.equal(await store.identity.getSupervised(sha(plain), f.guardian, now()), null, "the earlier view ended");
      assert.notEqual(await store.identity.getSupervised(sha(next), f.guardian, now()), null);
      // Leaving ends it, once.
      assert.equal(await store.identity.endSupervised(sha(next), stranger.guardian, now()), false, "only its own guardian can leave it");
      assert.equal(await store.identity.endSupervised(sha(next), f.guardian, now()), true);
      assert.equal(await store.identity.endSupervised(sha(next), f.guardian, now()), false);
      assert.equal(await store.identity.getSupervised(sha(next), f.guardian, now()), null);
      // Changing the way in closes any view at once.
      const again = token();
      assert.equal(await start({ plain: again }), true);
      await store.identity.setAccessMode(f.clientId, f.studentId, "none", f.guardian, now());
      assert.equal(await store.identity.getSupervised(sha(again), f.guardian, now()), null, "mode no longer supervised");
      assert.equal(await start({ plain: token() }), false, "and none can start while it is none");
      assert.ok((await store.identity.auditFor(f.studentId)).some((x) => x.action === "supervised_started"));
    });

    test("teardown", async () => {
      await close();
    });
  });
}
