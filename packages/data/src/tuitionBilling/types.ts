// Tuition billing: the rules Tahasin Hasan's answers of 7 Nov 2026 settled (docs/OWNER_ANSWERS_2026-11-07.md, docs/TUITION_BILLING.md).
//
// Money is ALWAYS whole pence (an integer), never a float. A rule that is still OPEN in the answers has a setting that is null until the
// owners decide: the engine then flags the line instead of guessing a number.

export type Pence = number;

/** Who ended a cancelled lesson. Decided by an admin; the lesson row itself does not say. */
export type CancelParty = "FAMILY" | "TUTOR" | "LEARNTHRIVE";

export interface BillingSettings {
  /** B6, decided: notice of at least this many hours is free. */
  lateCancelNoticeHours: number;
  /** B4, decided: percent off the monthly lesson charges of an eligible family. */
  siblingDiscountPercent: number;
  /** B6, OPEN: the charge for a repeat late cancellation. null = not decided: a repeat is flagged and priced at nothing. */
  repeatLateCancelFeePence: Pence | null;
  /** B6, OPEN: months after which a child's waived-first allowance starts again. null = never. */
  allowanceResetMonths: number | null;
  /** B11, OPEN: a refund of at least this many pence needs a second approver. null = one approver is enough. */
  refundSecondApprovalPence: Pence | null;
}

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  lateCancelNoticeHours: 24,
  siblingDiscountPercent: 10,
  repeatLateCancelFeePence: null,
  allowanceResetMonths: null,
  refundSecondApprovalPence: null,
};

/** B2: what a family pays per child per hour, fixed for the annual contract (B3). */
export interface FamilyRate {
  id: string;
  clientId: string;
  assignmentId: string;
  hourlyPence: Pence;
  /** ISO dates (yyyy-mm-dd), inclusive. A contract is a year; the rate cannot change inside it. */
  contractStart: string;
  contractEnd: string;
  createdBy: string;
  createdAt: string;
}

/** B2: what a tutor earns per hour, 5 to 45 pounds by level. Always separate from, and lower than, the family rate. Admin only. */
export interface TutorRate {
  id: string;
  tutorId: string;
  hourlyPence: Pence;
  effectiveFrom: string; // yyyy-mm-dd
  createdBy: string;
  createdAt: string;
}

export const TUTOR_RATE_MIN_PENCE = 500; // 5 pounds an hour
export const TUTOR_RATE_MAX_PENCE = 4500; // 45 pounds an hour

/** B4: the family is recorded as eligible for the sibling discount. */
export interface FamilyBillingProfile {
  clientId: string;
  siblingDiscountEligible: boolean;
  updatedBy?: string;
  updatedAt?: string;
}

/** An admin's decision about one lesson: who cancelled it, and/or that no charge is to be made (goodwill, with a note). */
export interface ChargeDecision {
  lessonId: string;
  party?: CancelParty;
  waive: boolean;
  note: string;
  decidedBy: string;
  decidedAt: string;
}

export type ChargeKind =
  | "DELIVERED" // the lesson took place and the child was there: charged
  | "LATE_CANCEL" // the family cancelled with less than the notice: first waived per child, repeats flagged or charged
  | "NO_SHOW" // the child did not come: first waived per child, repeats charged in full
  | "FREE_CANCEL" // the family cancelled with enough notice: no charge
  | "TUTOR_CANCEL" // the tutor or LearnThrive cancelled: rescheduled, never charged (B8, B9)
  | "NO_CHARGE" // excused, or waived by an admin
  | "NEEDS_DECISION" // cancelled with no one recorded, or past its time and never completed: not charged until decided
  | "NOT_YET"; // planned or under way

export interface ChargeEvent {
  lessonId: string;
  studentId: string;
  assignmentId: string;
  startAt: string;
  durationMinutes: number;
  kind: ChargeKind;
}

export type LineFlag = "NO_RATE" | "FEE_UNCONFIRMED" | "NEEDS_DECISION";

export interface StatementLine {
  lessonId: string;
  studentId: string;
  studentName: string;
  date: string; // yyyy-mm-dd, London
  title: string;
  kind: ChargeKind;
  description: string;
  minutes: number;
  ratePence: Pence | null;
  amountPence: Pence;
  waived: boolean;
  /** Counted as a missed-lesson charge rather than a delivered lesson. */
  missed: boolean;
  flag?: LineFlag;
}

export interface CompanyDetails {
  name: string;
  companyNumber: string;
  registeredOffice: string;
  email: string;
}

export type StatementBlocker = "NO_RATE" | "NEEDS_DECISION" | "FEE_UNCONFIRMED" | "EARLIER_PERIOD_NOT_ISSUED" | "PERIOD_NOT_ENDED";

export interface StatementDraft {
  clientId: string;
  clientName: string;
  period: string; // yyyy-mm
  periodStart: string;
  periodEnd: string;
  lines: StatementLine[];
  lessonChargesPence: Pence;
  missedLessonChargesPence: Pence;
  siblingDiscountPence: Pence; // shown as a positive amount, subtracted
  siblingDiscountPercent: number;
  siblingDiscountApplied: boolean;
  totalChargesPence: Pence;
  paymentsReceivedPence: Pence;
  /** The payments counted in this statement (each payment is counted once, in the first statement after it is recorded). */
  paymentIds: string[];
  openingBalancePence: Pence;
  closingBalancePence: Pence;
  /** Why this cannot be issued yet. Empty = ready. */
  blockers: StatementBlocker[];
  company: CompanyDetails;
}

export interface IssuedStatement extends StatementDraft {
  id: string;
  invoiceNumber: string;
  issuedOn: string; // yyyy-mm-dd
  issuedBy: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  clientId: string;
  amountPence: Pence;
  receivedOn: string; // yyyy-mm-dd
  /** How it arrived, in words ("Bank transfer", "Cash"). The family payment method is not decided yet, so it is free text. */
  method: string;
  note: string;
  recordedBy: string;
  createdAt: string;
}

export type RefundStatus = "REQUESTED" | "AWAITING_SECOND_APPROVAL" | "APPROVED" | "REJECTED";

export interface RefundRequest {
  id: string;
  clientId: string;
  amountPence: Pence;
  reason: string;
  /** The family is asserting a statutory right (repeat performance, price reduction, refund): approval is still needed, but it is not discretionary. */
  statutory: boolean;
  status: RefundStatus;
  requestedBy: string;
  requestedAt: string;
  firstApprovedBy?: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  action: string;
  subject: string;
  detail: Record<string, unknown>;
}

export type BillingErrorCode = "RATE_LOCKED" | "RATE_RANGE" | "ALREADY_ISSUED" | "NOT_FOUND" | "INVALID" | "ALREADY_DECIDED";

/** Thrown by the repositories for a rule they enforce. code is for the caller to turn into words. */
export class BillingError extends Error {
  readonly code: BillingErrorCode;
  constructor(code: BillingErrorCode, message: string) {
    super(message);
    this.name = "BillingError";
    this.code = code;
  }
}
