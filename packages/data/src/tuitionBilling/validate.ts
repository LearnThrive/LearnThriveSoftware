// What a billing record has to look like before it is stored. Shared by both repositories, so the rules are the same in memory and on
// Postgres (the database has matching CHECK constraints as the last line of defence).

import { YMD } from "./period";
import { BillingError, TUTOR_RATE_MAX_PENCE, TUTOR_RATE_MIN_PENCE, type BillingSettings, type FamilyRate, type Payment, type RefundRequest, type TutorRate } from "./types";

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
const bad = (message: string): never => { throw new BillingError("INVALID", message); };
const text = (value: unknown, min: number, max: number, what: string): string => {
  const t = typeof value === "string" ? value.trim() : "";
  if (t.length < min || t.length > max) bad(`${what} must be ${min === max ? `${min}` : `${min} to ${max}`} characters.`);
  return t;
};

export const FAMILY_RATE_MIN_PENCE = 100; // 1 pound an hour: a guard against a mistyped decimal, not a price
export const FAMILY_RATE_MAX_PENCE = 20000;

export function validateFamilyRate(input: Omit<FamilyRate, "id" | "createdAt">): void {
  text(input.clientId, 1, 80, "The family");
  text(input.assignmentId, 1, 80, "The assignment");
  if (!isInt(input.hourlyPence) || input.hourlyPence < FAMILY_RATE_MIN_PENCE || input.hourlyPence > FAMILY_RATE_MAX_PENCE) bad("The hourly rate must be a whole number of pence between 1 and 200 pounds.");
  if (!YMD.test(input.contractStart) || !YMD.test(input.contractEnd) || input.contractEnd < input.contractStart) bad("The contract needs a start date and an end date after it.");
}

export function validateTutorRate(input: Omit<TutorRate, "id" | "createdAt">): void {
  text(input.tutorId, 1, 80, "The tutor");
  if (!isInt(input.hourlyPence) || input.hourlyPence < TUTOR_RATE_MIN_PENCE || input.hourlyPence > TUTOR_RATE_MAX_PENCE) {
    throw new BillingError("RATE_RANGE", "A tutor's pay is between 5 and 45 pounds an hour.");
  }
  if (!YMD.test(input.effectiveFrom)) bad("The tutor rate needs a start date.");
}

export function validatePayment(input: Omit<Payment, "id" | "createdAt">): void {
  text(input.clientId, 1, 80, "The family");
  if (!isInt(input.amountPence) || input.amountPence < 1 || input.amountPence > 10_000_000) bad("A payment is a whole number of pence, more than nothing.");
  if (!YMD.test(input.receivedOn)) bad("The payment needs the date it was received.");
  text(input.method, 1, 40, "How the payment arrived");
  text(input.note, 3, 500, "The note (who paid and any reference)");
}

export function validateRefundRequest(input: Pick<RefundRequest, "clientId" | "amountPence" | "reason">): void {
  text(input.clientId, 1, 80, "The family");
  if (!isInt(input.amountPence) || input.amountPence < 1 || input.amountPence > 10_000_000) bad("A refund is a whole number of pence, more than nothing.");
  text(input.reason, 3, 1000, "The reason");
}

export function validateSettings(next: BillingSettings): void {
  if (!isInt(next.lateCancelNoticeHours) || next.lateCancelNoticeHours < 0 || next.lateCancelNoticeHours > 720) bad("The notice period is 0 to 720 hours.");
  if (!isInt(next.siblingDiscountPercent) || next.siblingDiscountPercent < 0 || next.siblingDiscountPercent > 100) bad("The sibling discount is a whole percent from 0 to 100.");
  if (next.repeatLateCancelFeePence !== null && (!isInt(next.repeatLateCancelFeePence) || next.repeatLateCancelFeePence < 0 || next.repeatLateCancelFeePence > 100_000)) bad("The repeat late-cancellation fee is whole pence, up to 1,000 pounds, or not decided.");
  if (next.allowanceResetMonths !== null && (!isInt(next.allowanceResetMonths) || next.allowanceResetMonths < 1 || next.allowanceResetMonths > 60)) bad("The allowance reset is 1 to 60 months, or never.");
  if (next.refundSecondApprovalPence !== null && (!isInt(next.refundSecondApprovalPence) || next.refundSecondApprovalPence < 1)) bad("The second-approval threshold is whole pence, or none.");
}

export function validateDecision(input: { lessonId: string; party?: string; waive: boolean; note: string }): void {
  text(input.lessonId, 1, 80, "The lesson");
  if (input.party !== undefined && !["FAMILY", "TUTOR", "LEARNTHRIVE"].includes(input.party)) bad("Say who cancelled: the family, the tutor or LearnThrive.");
  if (input.party === undefined && !input.waive) bad("Record who cancelled, or that no charge is to be made.");
  text(input.note, input.waive ? 3 : 0, 500, "The note");
}

/** True when two inclusive date ranges share a day. */
export const rangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean => aStart <= bEnd && bStart <= aEnd;
