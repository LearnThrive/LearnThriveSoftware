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
  /**
   * B6: the charge for a repeat late cancellation. Decided 14 Nov 2026 that it IS charged, but not how much, so null = the lesson's own
   * price (the same as a repeat no-show). A number is a fixed fee instead.
   */
  repeatLateCancelFeePence: Pence | null;
  /** B6, OPEN: months after which a child's waived-first allowance starts again. null = never. */
  allowanceResetMonths: number | null;
  /** B11, OPEN: a refund of at least this many pence needs a second approver. null = one approver is enough. */
  refundSecondApprovalPence: Pence | null;
  /** How a parent pays by bank transfer (the account details and the reference to quote). Shown on their statement page. Empty until an administrator writes it. */
  paymentInstructions: string;
}

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  lateCancelNoticeHours: 24,
  siblingDiscountPercent: 10,
  repeatLateCancelFeePence: null,
  allowanceResetMonths: null,
  paymentInstructions: "",
  refundSecondApprovalPence: null,
};

/**
 * B2: what a family pays per child per hour. There is no fixed contract year any more (14 Nov 2026: three months to start with, then a
 * month's notice), so a rate applies from its start until a newer rate for the same assignment replaces it.
 */
export interface FamilyRate {
  id: string;
  clientId: string;
  assignmentId: string;
  hourlyPence: Pence;
  /** ISO dates (yyyy-mm-dd), inclusive. `contractEnd` is null while this is the current rate. */
  contractStart: string;
  contractEnd: string | null;
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

/**
 * A price set for ONE lesson, in place of the hourly rates: what each child's family is charged for it, and what its tutor is paid for it,
 * as two separate amounts (a lesson may cost a family 10 pounds and pay its tutor 5). Either side may be left to the hourly rate (null).
 * The family amount is per child on the lesson; the tutor amount is for the lesson, once. Admin only, like every rate (B17).
 */
export interface LessonPrice {
  lessonId: string;
  /** What each child's family is charged for this lesson, in place of the family's hourly rate. Null: the hourly rate applies. */
  clientPence: Pence | null;
  /** What the tutor is paid for this lesson, in place of their hourly pay. Null: the hourly pay applies. */
  tutorPence: Pence | null;
  note: string;
  setBy: string;
  setAt: string;
}

export const LESSON_PRICE_MAX_PENCE = 100_000; // 1,000 pounds for one lesson: a guard against a mistyped amount, not a price

/**
 * The same price for every lesson of one class (assignment) between two dates, whenever each lesson was booked. The amounts mean what they do
 * in a LessonPrice; a lesson with a price of its own keeps it. One class cannot have two of these for the same day.
 */
export interface RepeatingPrice {
  id: string;
  assignmentId: string;
  clientPence: Pence | null;
  tutorPence: Pence | null;
  /** yyyy-mm-dd, London, both days included. */
  startDate: string;
  endDate: string;
  note: string;
  setBy: string;
  setAt: string;
}

export const REPEATING_PRICE_MAX_DAYS = 731; // two years

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
