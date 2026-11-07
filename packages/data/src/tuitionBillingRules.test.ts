// The tuition charging rules, on plain data (docs/TUITION_BILLING.md). Every rule here is one the owners answered on 7 Nov 2026.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addMonths, applyAllowances, buildStatement, contractEndFor, decideRefund, DEFAULT_BILLING_SETTINGS, deriveChargeEvents, formatPence, isRefundApprover, lessonAmount, londonYmd,
  monthsBetween, overdueVerdict, parseApprovers, parsePounds, percentOf, periodBounds, previousPeriod, rateFor,
  type BillingAttendance, type BillingLesson, type BillingSettings, type ChargeDecision, type FamilyRate, type Payment, type RefundRequest, type StatementInput,
} from "./tuitionBilling";

const COMPANY = { name: "LearnThrive Tuition Ltd", companyNumber: "16680738", registeredOffice: "71-75 Shelton Street, London", email: "info@learnthrivetuition.co.uk" };
const AYAAN = { id: "s-ayaan", name: "Ayaan" };
const ZARA = { id: "s-zara", name: "Zara" };

let seq = 0;
function lesson(over: Partial<BillingLesson> & { startAt: string }): BillingLesson {
  seq += 1;
  return { id: `l-${seq}`, assignmentId: "a-maths", title: "Maths", studentIds: [AYAAN.id], durationMinutes: 60, status: "COMPLETED", ...over };
}
const rate = (hourlyPence = 3000, over: Partial<FamilyRate> = {}): FamilyRate => ({ id: "r1", clientId: "c1", assignmentId: "a-maths", hourlyPence, contractStart: "2026-01-01", contractEnd: "2026-12-31", createdBy: "u", createdAt: "x", ...over });

function input(over: Partial<StatementInput> = {}): StatementInput {
  return {
    client: { id: "c1", name: "Sarah Ahmed" }, students: [AYAAN], period: "2026-10", lessons: [], attendance: [], decisions: [], rates: [rate()], payments: [],
    profile: { clientId: "c1", siblingDiscountEligible: false }, settings: { ...DEFAULT_BILLING_SETTINGS }, company: COMPANY, asOf: "2026-11-02T09:00:00Z", previous: null,
    countedPaymentIds: new Set(), ...over,
  };
}

describe("money and dates", () => {
  test("a lesson costs the rate times the minutes, to the nearest penny", () => {
    assert.equal(lessonAmount(3000, 60), 3000);
    assert.equal(lessonAmount(3000, 45), 2250);
    assert.equal(lessonAmount(2500, 50), 2083); // 2083.33
    assert.equal(lessonAmount(3333, 30), 1667); // 1666.5 rounds up
    assert.equal(percentOf(9000, 10), 900);
  });
  test("pounds are read and shown exactly", () => {
    assert.equal(parsePounds("12"), 1200);
    assert.equal(parsePounds("£12.5"), 1250);
    assert.equal(parsePounds("1,200.05"), 120005);
    assert.equal(parsePounds("12.345"), null);
    assert.equal(parsePounds("abc"), null);
    assert.equal(formatPence(120005), "£1,200.05");
    assert.equal(formatPence(-250), "-£2.50");
  });
  test("the month of a lesson is the London month, not the UTC one", () => {
    assert.equal(londonYmd("2026-10-31T23:30:00Z"), "2026-10-31"); // London is on GMT from 25 Oct, so 23:30 UTC is still 31 Oct
    assert.equal(londonYmd("2026-10-31T23:30:00Z").slice(0, 7), "2026-10");
    assert.equal(londonYmd("2026-06-30T23:30:00Z"), "2026-07-01"); // BST makes it 1 July
    assert.deepEqual(periodBounds("2026-02"), { start: "2026-02-01", end: "2026-02-28" });
    assert.equal(previousPeriod("2026-01"), "2025-12");
    assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(monthsBetween("2026-01-15", "2026-03-14"), 1);
    assert.equal(monthsBetween("2026-01-15", "2026-03-15"), 2);
    assert.equal(contractEndFor("2026-09-01"), "2027-08-31");
  });
  test("a rate applies only inside its contract year (B3)", () => {
    const r = rate(3000, { contractStart: "2026-09-01", contractEnd: "2027-08-31" });
    assert.equal(rateFor([r], "c1", "a-maths", "2026-09-01"), r);
    assert.equal(rateFor([r], "c1", "a-maths", "2027-08-31"), r);
    assert.equal(rateFor([r], "c1", "a-maths", "2027-09-01"), null);
    assert.equal(rateFor([r], "c2", "a-maths", "2026-10-01"), null);
  });
});

describe("what a lesson turns into (B1, B6 to B9)", () => {
  const settings: BillingSettings = { ...DEFAULT_BILLING_SETTINGS };
  const kinds = (lessons: BillingLesson[], attendance: BillingAttendance[] = [], decisions: ChargeDecision[] = []) =>
    deriveChargeEvents({ lessons, attendance, decisions, settings, asOf: "2026-11-02T09:00:00Z" }).map((e) => e.kind);
  const family = (lessonId: string): ChargeDecision => ({ lessonId, party: "FAMILY", waive: false, note: "", decidedBy: "u", decidedAt: "x" });

  test("a completed lesson is delivered; an absence is a no-show; an excused absence is free", () => {
    const l = lesson({ startAt: "2026-10-05T16:00:00Z" });
    assert.deepEqual(kinds([l]), ["DELIVERED"]);
    assert.deepEqual(kinds([l], [{ lessonId: l.id, studentId: AYAAN.id, status: "ABSENT" }]), ["NO_SHOW"]);
    assert.deepEqual(kinds([l], [{ lessonId: l.id, studentId: AYAAN.id, status: "EXCUSED" }]), ["NO_CHARGE"]);
    assert.deepEqual(kinds([l], [{ lessonId: l.id, studentId: AYAAN.id, status: "LATE" }]), ["DELIVERED"]);
    assert.deepEqual(kinds([lesson({ startAt: "2026-10-05T16:00:00Z", status: "NO_SHOW" })]), ["NO_SHOW"]);
  });
  test("24 hours' notice or more is free; less is a late cancellation (B6)", () => {
    const start = "2026-10-10T16:00:00Z";
    const exactly = lesson({ startAt: start, status: "CANCELLED", cancelledAt: "2026-10-09T16:00:00Z" });
    const late = lesson({ startAt: start, status: "CANCELLED", cancelledAt: "2026-10-09T16:00:01Z" });
    assert.deepEqual(kinds([exactly], [], [family(exactly.id)]), ["FREE_CANCEL"]);
    assert.deepEqual(kinds([late], [], [family(late.id)]), ["LATE_CANCEL"]);
  });
  test("a tutor or LearnThrive cancellation is never charged; nobody recorded is asked about, not charged (B8)", () => {
    const a = lesson({ startAt: "2026-10-10T16:00:00Z", status: "CANCELLED", cancelledAt: "2026-10-10T15:00:00Z" });
    assert.deepEqual(kinds([a], [], [{ ...family(a.id), party: "TUTOR" }]), ["TUTOR_CANCEL"]);
    assert.deepEqual(kinds([a], [], [{ ...family(a.id), party: "LEARNTHRIVE" }]), ["TUTOR_CANCEL"]);
    assert.deepEqual(kinds([a]), ["NEEDS_DECISION"]);
  });
  test("a lesson past its time and never completed is asked about; one still to come is not", () => {
    assert.deepEqual(kinds([lesson({ startAt: "2026-10-10T16:00:00Z", status: "PLANNED" })]), ["NEEDS_DECISION"]);
    assert.deepEqual(kinds([lesson({ startAt: "2026-12-10T16:00:00Z", status: "PLANNED" })]), ["NOT_YET"]);
  });
  test("an admin can waive a charge, with a note, and it stays a recorded decision", () => {
    const l = lesson({ startAt: "2026-10-05T16:00:00Z", status: "NO_SHOW" });
    assert.deepEqual(kinds([l], [], [{ lessonId: l.id, waive: true, note: "illness", decidedBy: "u", decidedAt: "x" }]), ["NO_CHARGE"]);
  });
});

describe("each child's first late cancellation and first no-show are waived, separately (B6, B7)", () => {
  const settings: BillingSettings = { ...DEFAULT_BILLING_SETTINGS };
  const late = (startAt: string, studentId = AYAAN.id) => lesson({ startAt, studentIds: [studentId], status: "CANCELLED", cancelledAt: new Date(new Date(startAt).getTime() - 3_600_000).toISOString() });
  const familyDecisions = (ls: BillingLesson[]): ChargeDecision[] => ls.map((l) => ({ lessonId: l.id, party: "FAMILY", waive: false, note: "", decidedBy: "u", decidedAt: "x" }));
  const verdictFor = (ls: BillingLesson[], attendance: BillingAttendance[] = [], s: BillingSettings = settings) => {
    const events = deriveChargeEvents({ lessons: ls, attendance, decisions: familyDecisions(ls.filter((l) => l.status === "CANCELLED")), settings: s, asOf: "2026-12-31T00:00:00Z" });
    const v = applyAllowances(events, s);
    return events.map((e) => ({ kind: e.kind, student: e.studentId, ...v.get(`${e.lessonId}|${e.studentId}`) }));
  };

  test("the first is waived and the next is a repeat", () => {
    const ls = [late("2026-09-10T16:00:00Z"), late("2026-10-10T16:00:00Z"), late("2026-11-10T16:00:00Z")];
    assert.deepEqual(verdictFor(ls).map((v) => [v.waived, v.repeat]), [[true, false], [false, true], [false, true]]);
  });
  test("the count runs over the whole history, not the month", () => {
    const ls = [late("2026-09-10T16:00:00Z"), late("2026-11-10T16:00:00Z")];
    const st = buildStatement(input({ period: "2026-11", lessons: ls, decisions: familyDecisions(ls) }));
    assert.equal(st.lines.length, 1); // only November's is on the November statement
    assert.equal(st.lines[0]!.waived, false); // and it is a repeat because September's was the first
  });
  test("every child has their own allowance", () => {
    const ls = [late("2026-09-10T16:00:00Z", AYAAN.id), late("2026-09-11T16:00:00Z", ZARA.id)];
    assert.deepEqual(verdictFor(ls).map((v) => v.waived), [true, true]);
  });
  test("a no-show and a late cancellation do not share an allowance", () => {
    const ls = [late("2026-09-10T16:00:00Z"), lesson({ startAt: "2026-09-12T16:00:00Z", status: "NO_SHOW" })];
    assert.deepEqual(verdictFor(ls).map((v) => v.waived), [true, true]);
  });
  test("until the owners decide a reset, the allowance never resets; once they do it starts again", () => {
    const ls = [late("2025-01-10T16:00:00Z"), late("2025-06-10T16:00:00Z"), late("2026-02-10T16:00:00Z")];
    assert.deepEqual(verdictFor(ls).map((v) => v.waived), [true, false, false]);
    assert.deepEqual(verdictFor(ls, [], { ...settings, allowanceResetMonths: 12 }).map((v) => v.waived), [true, false, true]);
  });
});

describe("the monthly statement (B1, B4, B14, B16)", () => {
  const delivered = (startAt: string, over: Partial<BillingLesson> = {}) => lesson({ startAt, ...over });

  test("it adds up the lessons delivered in the month and no others", () => {
    const st = buildStatement(input({ lessons: [delivered("2026-09-29T16:00:00Z"), delivered("2026-10-06T16:00:00Z"), delivered("2026-10-20T16:00:00Z", { durationMinutes: 45 }), delivered("2026-11-03T16:00:00Z", { status: "PLANNED" })] }));
    assert.equal(st.lines.length, 2);
    assert.equal(st.lessonChargesPence, 3000 + 2250);
    assert.equal(st.totalChargesPence, 5250);
    assert.equal(st.openingBalancePence, 3000); // September's lesson, not yet paid, is carried
    assert.equal(st.closingBalancePence, 8250);
    assert.deepEqual(st.blockers, []);
  });
  test("a mid-month start bills only the lessons delivered since (B14)", () => {
    const st = buildStatement(input({ lessons: [delivered("2026-10-27T16:00:00Z"), delivered("2026-10-29T16:00:00Z")] }));
    assert.equal(st.lessonChargesPence, 6000);
    assert.equal(st.openingBalancePence, 0);
  });
  test("the 10% sibling discount is on the lesson charges only, and only for a family recorded as eligible (B4)", () => {
    const ls = [delivered("2026-10-06T16:00:00Z"), delivered("2026-10-13T16:00:00Z")];
    const no = buildStatement(input({ lessons: ls }));
    const yes = buildStatement(input({ lessons: ls, profile: { clientId: "c1", siblingDiscountEligible: true } }));
    assert.equal(no.siblingDiscountPence, 0);
    assert.equal(yes.siblingDiscountPence, 600);
    assert.equal(yes.totalChargesPence, 5400);
    const withMissed = buildStatement(input({
      lessons: [...ls, lesson({ startAt: "2026-10-20T16:00:00Z", status: "NO_SHOW" }), lesson({ startAt: "2026-10-21T16:00:00Z", status: "NO_SHOW" })], profile: { clientId: "c1", siblingDiscountEligible: true },
    }));
    assert.equal(withMissed.missedLessonChargesPence, 3000); // the second no-show, in full, undiscounted
    assert.equal(withMissed.siblingDiscountPence, 600);
  });
  test("payments received reduce the balance and are counted once", () => {
    const pay: Payment = { id: "p1", clientId: "c1", amountPence: 2000, receivedOn: "2026-10-15", method: "Bank transfer", note: "Sarah", recordedBy: "u", createdAt: "x" };
    const ls = [delivered("2026-10-06T16:00:00Z")];
    const st = buildStatement(input({ lessons: ls, payments: [pay] }));
    assert.equal(st.paymentsReceivedPence, 2000);
    assert.equal(st.closingBalancePence, 1000);
    assert.deepEqual(st.paymentIds, ["p1"]);
    const next = buildStatement(input({ period: "2026-11", asOf: "2026-12-02T09:00:00Z", lessons: ls, payments: [pay], countedPaymentIds: new Set(["p1"]), previous: { ...st, id: "s1", invoiceNumber: "LT-1", issuedOn: "2026-11-02", issuedBy: "u", createdAt: "x" } }));
    assert.equal(next.paymentsReceivedPence, 0);
    assert.equal(next.openingBalancePence, 1000);
  });
  test("a missing rate, an unexplained cancellation and an unfinished month each stop it being issued", () => {
    const noRate = buildStatement(input({ rates: [], lessons: [delivered("2026-10-06T16:00:00Z")] }));
    assert.deepEqual(noRate.blockers, ["NO_RATE"]);
    assert.equal(noRate.lines[0]!.amountPence, 0);
    const undecided = buildStatement(input({ lessons: [delivered("2026-10-06T16:00:00Z", { status: "CANCELLED", cancelledAt: "2026-10-05T10:00:00Z" })] }));
    assert.deepEqual(undecided.blockers, ["NEEDS_DECISION"]);
    const early = buildStatement(input({ asOf: "2026-10-20T09:00:00Z", lessons: [delivered("2026-10-06T16:00:00Z")] }));
    assert.deepEqual(early.blockers, ["PERIOD_NOT_ENDED"]);
  });
  test("a repeat late cancellation is flagged, not priced, until the fee is decided; then it is charged", () => {
    const l1 = lesson({ startAt: "2026-10-06T16:00:00Z", status: "CANCELLED", cancelledAt: "2026-10-06T10:00:00Z" });
    const l2 = lesson({ startAt: "2026-10-13T16:00:00Z", status: "CANCELLED", cancelledAt: "2026-10-13T10:00:00Z" });
    const decisions = [l1, l2].map((l): ChargeDecision => ({ lessonId: l.id, party: "FAMILY", waive: false, note: "", decidedBy: "u", decidedAt: "x" }));
    const open = buildStatement(input({ lessons: [l1, l2], decisions }));
    assert.deepEqual(open.blockers, ["FEE_UNCONFIRMED"]);
    assert.deepEqual(open.lines.map((l) => [l.waived, l.amountPence]), [[true, 0], [false, 0]]);
    const decided = buildStatement(input({ lessons: [l1, l2], decisions, settings: { ...DEFAULT_BILLING_SETTINGS, repeatLateCancelFeePence: 1500 } }));
    assert.deepEqual(decided.blockers, []);
    assert.equal(decided.missedLessonChargesPence, 1500);
  });
  test("a repeat no-show is charged in full (B7)", () => {
    const n1 = lesson({ startAt: "2026-10-06T16:00:00Z", status: "NO_SHOW" });
    const n2 = lesson({ startAt: "2026-10-13T16:00:00Z", status: "NO_SHOW", durationMinutes: 90 });
    const st = buildStatement(input({ lessons: [n1, n2] }));
    assert.deepEqual(st.lines.map((l) => [l.waived, l.amountPence]), [[true, 0], [false, 4500]]);
  });
  test("only the children this family pays for are on it", () => {
    const shared = lesson({ startAt: "2026-10-06T16:00:00Z", studentIds: [AYAAN.id, ZARA.id] });
    const st = buildStatement(input({ lessons: [shared] }));
    assert.deepEqual(st.lines.map((l) => l.studentName), ["Ayaan"]);
  });
});

describe("overdue is a flag, never an action (B12)", () => {
  const issued = (id: string, issuedOn: string, total: number, opening = 0) => ({ id, issuedOn, totalChargesPence: total, openingBalancePence: opening });

  test("unpaid for more than a month is overdue; there is no late fee and nothing is suspended", () => {
    const v = overdueVerdict([issued("s1", "2026-09-30", 5000)], [], "2026-11-02T09:00:00Z");
    assert.equal(v.overdue, true);
    assert.equal(v.amountOverduePence, 5000);
    assert.equal(v.autoSuspend, false);
    assert.equal(v.oldestUnpaidStatementId, "s1");
  });
  test("not yet a month, or paid, is not overdue", () => {
    assert.equal(overdueVerdict([issued("s1", "2026-10-15", 5000)], [], "2026-11-02T09:00:00Z").overdue, false);
    assert.equal(overdueVerdict([issued("s1", "2026-09-30", 5000)], [{ amountPence: 5000 }], "2026-11-02T09:00:00Z").overdue, false);
  });
  test("payments go to the oldest statement first", () => {
    const v = overdueVerdict([issued("s1", "2026-08-31", 4000), issued("s2", "2026-09-30", 4000), issued("s3", "2026-10-31", 4000)], [{ amountPence: 4000 }, { amountPence: 1000 }], "2026-11-02T09:00:00Z");
    assert.equal(v.amountOverduePence, 3000); // s2 is 3000 short and is a month old; s3 is not overdue yet
    assert.equal(v.oldestUnpaidStatementId, "s2");
  });
  test("a credit on the account is never overdue", () => {
    assert.equal(overdueVerdict([issued("s1", "2026-08-31", 4000)], [{ amountPence: 9000 }], "2026-11-02T09:00:00Z").overdue, false);
  });
  test("a balance brought forward is as old as the first statement we know", () => {
    const v = overdueVerdict([issued("s1", "2026-08-31", 0, 2500)], [], "2026-11-02T09:00:00Z");
    assert.equal(v.amountOverduePence, 2500);
  });
});

describe("refunds: only a named approver (B11)", () => {
  const approvers = parseApprovers("Tahasin@example.test, not an address, second@example.test");
  const tahasin = { id: "u-tahasin", email: "TAHASIN@example.test" };
  const brian = { id: "u-brian", email: "brian@example.test" };
  const request = (over: Partial<RefundRequest> = {}): RefundRequest => ({ id: "rf1", clientId: "c1", amountPence: 4000, reason: "x", statutory: false, status: "REQUESTED", requestedBy: "u-brian", requestedAt: "x", ...over });
  const settings: BillingSettings = { ...DEFAULT_BILLING_SETTINGS };
  const decide = (over: Partial<Parameters<typeof decideRefund>[0]> = {}) => decideRefund({ request: request(), actor: tahasin, approve: true, note: "", approvers, settings, now: "2026-11-07T10:00:00Z", ...over });

  test("only addresses are read, in any case", () => {
    assert.deepEqual(approvers.emails, ["tahasin@example.test", "second@example.test"]);
    assert.deepEqual(parseApprovers(undefined).emails, []);
    assert.equal(isRefundApprover(tahasin, approvers), true);
    assert.equal(isRefundApprover(brian, approvers), false);
  });
  test("with nobody configured, nobody can approve", () => {
    assert.deepEqual(decide({ approvers: parseApprovers("") }), { ok: false, reason: "not_approver" });
  });
  test("an admin who is not the approver is refused, however senior", () => {
    assert.deepEqual(decide({ actor: brian }), { ok: false, reason: "not_approver" });
  });
  test("the approver approves in one step when there is no threshold", () => {
    const r = decide();
    assert.equal(r.ok && r.status, "APPROVED");
    assert.equal(r.ok && r.patch.decidedBy, "u-tahasin");
  });
  test("a decided request cannot be decided again", () => {
    assert.deepEqual(decide({ request: request({ status: "APPROVED" }) }), { ok: false, reason: "already_decided" });
    assert.deepEqual(decide({ request: request({ status: "REJECTED" }) }), { ok: false, reason: "already_decided" });
  });
  test("a refusal needs a reason", () => {
    assert.deepEqual(decide({ approve: false }), { ok: false, reason: "needs_note" });
    const r = decide({ approve: false, note: "The lessons were delivered." });
    assert.equal(r.ok && r.status, "REJECTED");
  });
  test("at or above a threshold a second, different approver is needed", () => {
    const s: BillingSettings = { ...settings, refundSecondApprovalPence: 4000 };
    const first = decide({ settings: s });
    assert.equal(first.ok && first.status, "AWAITING_SECOND_APPROVAL");
    const parked = request({ status: "AWAITING_SECOND_APPROVAL", firstApprovedBy: "u-tahasin" });
    assert.deepEqual(decide({ settings: s, request: parked }), { ok: false, reason: "same_person" });
    const second = decide({ settings: s, request: parked, actor: { id: "u-second", email: "second@example.test" } });
    assert.equal(second.ok && second.status, "APPROVED");
    assert.equal((decide({ settings: s, request: request({ amountPence: 3999 }) }) as { status: string }).status, "APPROVED"); // below the threshold: one is enough
  });
});
