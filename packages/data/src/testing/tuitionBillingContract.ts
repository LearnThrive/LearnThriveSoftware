/**
 * One behavioural contract for the tuition billing repository, run against the in-memory development repository and the Postgres one on
 * PGlite (and the real local stack). It also runs the billing SERVICE (statements, balances, refunds) end to end on top of each, with real
 * lessons from the tuition DataProvider, so a statement is proven against the same data the app reads.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DataProvider } from "../repositories";
import {
  BillingError, decideRefundRequest, familyBalances, issueStatement, parseApprovers, previewStatement, recordPayment, requestRefund, voidPayment,
  type BillingContext, type TuitionBillingRepository,
} from "../tuitionBilling";

export interface BillingHarness {
  repo: TuitionBillingRepository;
  provider: DataProvider;
  family(name?: string): Promise<{ clientId: string; userId: string }>;
  /** A login (a profile) an actor id can point at. */
  login(): Promise<string>;
}

const COMPANY = { name: "LearnThrive Tuition Ltd", companyNumber: "16680738", registeredOffice: "71-75 Shelton Street, London", email: "info@learnthrivetuition.co.uk" };

async function rejects(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error) => error instanceof BillingError && error.code === code, `expected a BillingError ${code}`);
}

export function tuitionBillingContract(name: string, make: () => Promise<{ harness: BillingHarness; close(): Promise<void> }>): void {
  describe(`tuition billing contract: ${name}`, () => {
    let h: BillingHarness;
    let close: () => Promise<void>;
    let repo: TuitionBillingRepository;
    let p: DataProvider;
    let admin: string;

    const tutor = () => p.tutors.create({ name: "Tutor", email: `t-${Math.random().toString(36).slice(2)}@example.test`, subjects: ["Maths"], active: true });
    const child = async (clientId: string, label = "Kid") => {
      const s = await p.students.create({ name: label, active: true, ...({ clientId } as object) });
      await p.students.linkClient(clientId, s.id);
      return s;
    };
    const assignment = async (tutorId: string, studentIds: string[]) => {
      const clientIds = [...new Set((await Promise.all(studentIds.map((id) => p.students.clientsFor(id)))).flat().map((c) => c.id))];
      return p.assignments.create({ title: "GCSE Maths", subject: "Maths", tutorId, studentIds, clientIds, status: "ACTIVE", defaultDurationMinutes: 60 });
    };
    const lesson = async (a: { id: string; tutorId: string; studentIds: string[] }, startAt: string, over: Record<string, unknown> = {}) => {
      const clientIds = [...new Set((await Promise.all(a.studentIds.map((id) => p.students.clientsFor(id)))).flat().map((c) => c.id))];
      return p.lessons.create({ assignmentId: a.id, tutorId: a.tutorId, studentIds: a.studentIds, clientIds, title: "Algebra", subject: "Maths", startAt, durationMinutes: 60, locationType: "ONLINE", reportRequired: true, status: "COMPLETED", ...over } as never);
    };
    const ctx = (approvers = "tahasin@example.test", now = "2026-11-02T09:00:00.000Z"): BillingContext => ({ data: p, billing: repo, company: COMPANY, approvers: parseApprovers(approvers), now: () => now });

    test("setup", async () => {
      ({ harness: h, close } = await make());
      repo = h.repo;
      p = h.provider;
      admin = await h.login();
    });

    test("settings: the decided rules are there; the open ones are not decided yet", async () => {
      const s = await repo.settings.get();
      assert.deepEqual(s, { lateCancelNoticeHours: 24, siblingDiscountPercent: 10, repeatLateCancelFeePence: null, allowanceResetMonths: null, refundSecondApprovalPence: null });
    });
    test("settings: updates are checked, and an open rule can be decided and un-decided", async () => {
      assert.equal((await repo.settings.update({ repeatLateCancelFeePence: 1500, allowanceResetMonths: 12 }, admin)).repeatLateCancelFeePence, 1500);
      await rejects(repo.settings.update({ siblingDiscountPercent: 150 }, admin), "INVALID");
      await rejects(repo.settings.update({ repeatLateCancelFeePence: -1 }, admin), "INVALID");
      await rejects(repo.settings.update({ allowanceResetMonths: 0 }, admin), "INVALID");
      assert.equal((await repo.settings.get()).repeatLateCancelFeePence, 1500, "a refused update changes nothing");
      const back = await repo.settings.update({ repeatLateCancelFeePence: null, allowanceResetMonths: null }, admin);
      assert.equal(back.repeatLateCancelFeePence, null);
      assert.equal(back.allowanceResetMonths, null);
    });

    test("family rates are fixed for the contract year (B3)", async () => {
      const { clientId } = await h.family("Rates");
      const kid = await child(clientId);
      const a = await assignment((await tutor()).id, [kid.id]);
      const make = (over: object) => ({ clientId, assignmentId: a.id, hourlyPence: 3000, contractStart: "2026-09-01", contractEnd: "2027-08-31", createdBy: admin, ...over });
      const first = await repo.familyRates.create(make({}));
      assert.equal(first.hourlyPence, 3000);
      await rejects(repo.familyRates.create(make({ hourlyPence: 3500, contractStart: "2027-01-01", contractEnd: "2027-12-31" })), "RATE_LOCKED");
      await rejects(repo.familyRates.create(make({ hourlyPence: 3500 })), "RATE_LOCKED");
      const renewal = await repo.familyRates.create(make({ hourlyPence: 3300, contractStart: "2027-09-01", contractEnd: "2028-08-31" }));
      assert.deepEqual((await repo.familyRates.list(clientId)).map((r) => r.id), [first.id, renewal.id]);
      await rejects(repo.familyRates.create(make({ hourlyPence: 10 })), "INVALID");
      await rejects(repo.familyRates.create(make({ contractEnd: "2026-08-31" })), "INVALID");
      const b = await assignment((await tutor()).id, [kid.id]);
      assert.ok(await repo.familyRates.create(make({ assignmentId: b.id })), "another assignment has its own rate");
    });

    test("tutor pay is 5 to 45 pounds an hour and is stored apart from what families pay (B2)", async () => {
      const t = await tutor();
      await rejects(repo.tutorRates.create({ tutorId: t.id, hourlyPence: 499, effectiveFrom: "2026-09-01", createdBy: admin }), "RATE_RANGE");
      await rejects(repo.tutorRates.create({ tutorId: t.id, hourlyPence: 4501, effectiveFrom: "2026-09-01", createdBy: admin }), "RATE_RANGE");
      const low = await repo.tutorRates.create({ tutorId: t.id, hourlyPence: 500, effectiveFrom: "2026-09-01", createdBy: admin });
      const high = await repo.tutorRates.create({ tutorId: t.id, hourlyPence: 4500, effectiveFrom: "2027-01-01", createdBy: admin });
      assert.deepEqual((await repo.tutorRates.list(t.id)).map((r) => r.id), [low.id, high.id]);
    });

    test("the sibling discount is a recorded flag on the family (B4)", async () => {
      const { clientId } = await h.family("Siblings");
      assert.equal((await repo.profiles.get(clientId)).siblingDiscountEligible, false);
      assert.equal((await repo.profiles.setSiblingEligible(clientId, true, admin)).siblingDiscountEligible, true);
      assert.equal((await repo.profiles.get(clientId)).siblingDiscountEligible, true);
      assert.ok((await repo.profiles.list()).some((x) => x.clientId === clientId && x.siblingDiscountEligible));
      assert.equal((await repo.profiles.setSiblingEligible(clientId, false, admin)).siblingDiscountEligible, false);
    });

    test("a decision about a lesson: who cancelled, or a waiver with a note", async () => {
      const { clientId } = await h.family("Decisions");
      const kid = await child(clientId);
      const a = await assignment((await tutor()).id, [kid.id]);
      const l = await lesson(a, "2026-10-05T16:00:00Z", { status: "CANCELLED" });
      await rejects(repo.decisions.upsert({ lessonId: l.id, waive: false, note: "", decidedBy: admin }), "INVALID");
      await rejects(repo.decisions.upsert({ lessonId: l.id, waive: true, note: "", decidedBy: admin }), "INVALID");
      await rejects(repo.decisions.upsert({ lessonId: l.id, party: "NOBODY" as never, waive: false, note: "", decidedBy: admin }), "INVALID");
      const d = await repo.decisions.upsert({ lessonId: l.id, party: "FAMILY", waive: false, note: "", decidedBy: admin });
      assert.equal(d.party, "FAMILY");
      const changed = await repo.decisions.upsert({ lessonId: l.id, party: "TUTOR", waive: false, note: "tutor ill", decidedBy: admin });
      assert.equal(changed.party, "TUTOR");
      assert.deepEqual((await repo.decisions.list([l.id])).map((x) => x.party), ["TUTOR"], "one decision per lesson");
      assert.deepEqual(await repo.decisions.list([]), []);
    });

    test("payments are recorded, voided with a reason, never edited", async () => {
      const { clientId } = await h.family("Payer");
      await rejects(repo.payments.record({ clientId, amountPence: 0, receivedOn: "2026-10-01", method: "Bank transfer", note: "x y z", recordedBy: admin }), "INVALID");
      await rejects(repo.payments.record({ clientId, amountPence: 1000, receivedOn: "yesterday", method: "Bank transfer", note: "x y z", recordedBy: admin }), "INVALID");
      await rejects(repo.payments.record({ clientId, amountPence: 1000, receivedOn: "2026-10-01", method: "Bank transfer", note: "", recordedBy: admin }), "INVALID");
      const one = await repo.payments.record({ clientId, amountPence: 2500, receivedOn: "2026-10-02", method: "Bank transfer", note: "Sarah, ref 1", recordedBy: admin });
      const two = await repo.payments.record({ clientId, amountPence: 1000, receivedOn: "2026-10-01", method: "Cash", note: "handed over", recordedBy: admin });
      assert.deepEqual((await repo.payments.list(clientId)).map((x) => x.id), [two.id, one.id], "oldest received first");
      await rejects(repo.payments.void(one.id, "", admin), "INVALID");
      await repo.payments.void(one.id, "Entered twice", admin);
      assert.deepEqual((await repo.payments.list(clientId)).map((x) => x.id), [two.id]);
      await rejects(repo.payments.void(one.id, "Entered twice", admin), "NOT_FOUND");
    });

    test("refund requests: filed, found, and updated", async () => {
      const { clientId } = await h.family("Refunds");
      await rejects(repo.refunds.request({ clientId, amountPence: 0, reason: "x y z", statutory: false, requestedBy: admin }), "INVALID");
      await rejects(repo.refunds.request({ clientId, amountPence: 500, reason: "", statutory: false, requestedBy: admin }), "INVALID");
      const r = await repo.refunds.request({ clientId, amountPence: 4000, reason: "Lessons not delivered", statutory: true, requestedBy: admin });
      assert.equal(r.status, "REQUESTED");
      assert.equal((await repo.refunds.get(r.id))?.statutory, true);
      const u = await repo.refunds.update(r.id, { status: "REJECTED", decidedBy: admin, decidedAt: new Date().toISOString(), decisionNote: "Delivered" });
      assert.equal(u.status, "REJECTED");
      assert.equal(u.amountPence, 4000, "the amount is not editable");
      assert.deepEqual((await repo.refunds.list(clientId)).map((x) => x.id), [r.id]);
      assert.equal(await repo.refunds.get("not-an-id"), null);
      await assert.rejects(repo.refunds.update("00000000-0000-4000-8000-000000000000", { status: "APPROVED" }), (e) => e instanceof BillingError && e.code === "NOT_FOUND");
    });

    test("the audit trail is newest first", async () => {
      await repo.audit.append({ actorId: admin, action: "test.one", subject: "a", detail: { n: 1 } });
      await repo.audit.append({ actorId: admin, action: "test.two", subject: "b", detail: { n: 2 } });
      const recent = await repo.audit.recent(2);
      assert.deepEqual(recent.map((e) => e.action), ["test.two", "test.one"]);
      assert.deepEqual(recent[0]!.detail, { n: 2 });
    });

    // ---- the service, end to end, on real lessons ------------------------------------------------------------------------------------

    test("a statement: preview, refuse while blocked, issue once, frozen, with the next number", async () => {
      const { clientId } = await h.family("Statement Family");
      const kid = await child(clientId, "Ayaan");
      const a = await assignment((await tutor()).id, [kid.id]);
      await lesson(a, "2026-10-06T16:00:00Z");
      await lesson(a, "2026-10-13T16:00:00Z", { durationMinutes: 45 });
      await lesson(a, "2026-11-03T16:00:00Z", { status: "PLANNED" });

      const blocked = await previewStatement(ctx(), clientId, "2026-10");
      assert.deepEqual(blocked?.blockers, ["NO_RATE"]);
      await assert.rejects(issueStatement(ctx(), clientId, "2026-10", { id: admin, email: "a@example.test" }), (e) => e instanceof BillingError && e.code === "INVALID");

      await repo.familyRates.create({ clientId, assignmentId: a.id, hourlyPence: 3000, contractStart: "2026-09-01", contractEnd: "2027-08-31", createdBy: admin });
      const draft = await previewStatement(ctx(), clientId, "2026-10");
      assert.equal(draft?.lessonChargesPence, 3000 + 2250);
      assert.deepEqual(draft?.blockers, []);
      assert.equal(draft?.lines.length, 2);
      assert.equal(draft?.lines[0]?.studentName, "Ayaan");

      const issued = await issueStatement(ctx(), clientId, "2026-10", { id: admin, email: "a@example.test" });
      assert.match(issued.invoiceNumber, /^LT-202610-\d{4}$/);
      assert.equal(issued.issuedOn, "2026-11-02");
      assert.equal(issued.closingBalancePence, 5250);
      assert.equal((await repo.statements.get(clientId, "2026-10"))?.id, issued.id);
      assert.equal((await repo.statements.getById(issued.id))?.invoiceNumber, issued.invoiceNumber);
      await assert.rejects(issueStatement(ctx(), clientId, "2026-10", { id: admin, email: "a@example.test" }), (e) => e instanceof BillingError && e.code === "ALREADY_ISSUED");
      assert.equal((await repo.audit.recent(1))[0]?.action, "statement.issued");

      // a payment recorded afterwards is counted once, in the next statement
      const pay = await recordPayment(ctx(), { clientId, amountPence: 5250, receivedOn: "2026-11-05", method: "Bank transfer", note: "Sarah, October" }, { id: admin, email: "a@example.test" });
      await lesson(a, "2026-11-10T16:00:00Z");
      const next = await previewStatement(ctx("tahasin@example.test", "2026-12-02T09:00:00.000Z"), clientId, "2026-11");
      assert.equal(next?.openingBalancePence, 5250);
      assert.equal(next?.paymentsReceivedPence, 5250);
      assert.deepEqual(next?.paymentIds, [pay.id]);
      assert.equal(next?.closingBalancePence, 3000);
      await voidPayment(ctx(), pay.id, "Entered against the wrong family", { id: admin, email: "a@example.test" });
      assert.equal((await previewStatement(ctx("tahasin@example.test", "2026-12-02T09:00:00.000Z"), clientId, "2026-11"))?.paymentsReceivedPence, 0);
    });

    test("an earlier month must be issued first", async () => {
      const { clientId } = await h.family("Order Family");
      const kid = await child(clientId, "Zara");
      const a = await assignment((await tutor()).id, [kid.id]);
      await repo.familyRates.create({ clientId, assignmentId: a.id, hourlyPence: 3000, contractStart: "2026-01-01", contractEnd: "2026-12-31", createdBy: admin });
      await lesson(a, "2026-09-08T16:00:00Z");
      await lesson(a, "2026-10-06T16:00:00Z");
      const later = ctx("tahasin@example.test", "2026-11-02T09:00:00.000Z");
      assert.deepEqual((await previewStatement(later, clientId, "2026-10"))?.blockers, ["EARLIER_PERIOD_NOT_ISSUED"]);
      await issueStatement(later, clientId, "2026-09", { id: admin, email: "a@example.test" });
      assert.deepEqual((await previewStatement(later, clientId, "2026-10"))?.blockers, []);
    });

    test("balances list every family and flag overdue; nothing is suspended (B12)", async () => {
      const { clientId } = await h.family("Overdue Family");
      const kid = await child(clientId, "Ben");
      const a = await assignment((await tutor()).id, [kid.id]);
      await repo.familyRates.create({ clientId, assignmentId: a.id, hourlyPence: 3000, contractStart: "2026-01-01", contractEnd: "2026-12-31", createdBy: admin });
      await lesson(a, "2026-08-04T16:00:00Z");
      await issueStatement(ctx("tahasin@example.test", "2026-09-01T09:00:00.000Z"), clientId, "2026-08", { id: admin, email: "a@example.test" });
      const rows = await familyBalances(ctx("tahasin@example.test", "2026-11-02T09:00:00.000Z"));
      const row = rows.find((r) => r.clientId === clientId)!;
      assert.equal(row.balancePence, 3000);
      assert.equal(row.overdue.overdue, true);
      assert.equal(row.overdue.autoSuspend, false);
      assert.equal((await p.assignments.get(a.id))?.status, "ACTIVE", "an overdue family's lessons are untouched");
      await recordPayment(ctx(), { clientId, amountPence: 3000, receivedOn: "2026-11-01", method: "Bank transfer", note: "Ben's parent" }, { id: admin, email: "a@example.test" });
      const paid = (await familyBalances(ctx("tahasin@example.test", "2026-11-02T09:00:00.000Z"))).find((r) => r.clientId === clientId)!;
      assert.equal(paid.balancePence, 0);
      assert.equal(paid.overdue.overdue, false);
    });

    test("refunds: only the named approver can decide, and every attempt is audited (B11)", async () => {
      const { clientId } = await h.family("Refund Family");
      const requester = { id: admin, email: "brian@example.test" };
      const approver = { id: await h.login(), email: "Tahasin@example.test" };
      const r = await requestRefund(ctx(), { clientId, amountPence: 4000, reason: "Tuition not delivered", statutory: false }, requester);
      assert.equal(r.status, "REQUESTED");
      assert.deepEqual(await decideRefundRequest(ctx(), r.id, requester, true, ""), { ok: false, reason: "not_approver" });
      assert.equal((await repo.refunds.get(r.id))?.status, "REQUESTED", "refused: nothing changed");
      assert.equal((await repo.audit.recent(1))[0]?.action, "refund.decision_refused");
      assert.deepEqual(await decideRefundRequest(ctx(), r.id, approver, false, ""), { ok: false, reason: "needs_note" });
      const approved = await decideRefundRequest(ctx(), r.id, approver, true, "Agreed");
      assert.ok(approved.ok && approved.refund.status === "APPROVED");
      assert.deepEqual(await decideRefundRequest(ctx(), r.id, approver, true, ""), { ok: false, reason: "already_decided" });
      assert.deepEqual(await decideRefundRequest(ctx(), "00000000-0000-4000-8000-000000000000", approver, true, ""), { ok: false, reason: "not_found" });
    });

    test("a second approver above the threshold (B11, when the owners set one)", async () => {
      const { clientId } = await h.family("Two Approvers");
      await repo.settings.update({ refundSecondApprovalPence: 5000 }, admin);
      const both = ctx("tahasin@example.test, abdurrahman@example.test");
      const first = { id: await h.login(), email: "tahasin@example.test" };
      const second = { id: await h.login(), email: "abdurrahman@example.test" };
      const r = await requestRefund(both, { clientId, amountPence: 6000, reason: "Large refund", statutory: false }, { id: admin, email: "brian@example.test" });
      const parked = await decideRefundRequest(both, r.id, first, true, "");
      assert.ok(parked.ok && parked.refund.status === "AWAITING_SECOND_APPROVAL");
      assert.deepEqual(await decideRefundRequest(both, r.id, first, true, ""), { ok: false, reason: "same_person" });
      const done = await decideRefundRequest(both, r.id, second, true, "");
      assert.ok(done.ok && done.refund.status === "APPROVED");
      await repo.settings.update({ refundSecondApprovalPence: null }, admin);
    });

    test("teardown", async () => {
      await close();
    });
  });
}
