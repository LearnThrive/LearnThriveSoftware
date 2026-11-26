// What a billing record has to look like before it is stored. Shared by both repositories, so the rules are the same in memory and on
// Postgres (the database has matching CHECK constraints as the last line of defence).

import { dayBefore, YMD } from "./period";
import {
  BillingError, LESSON_PRICE_MAX_PENCE, REPEATING_PRICE_MAX_DAYS, TUTOR_RATE_MAX_PENCE, TUTOR_RATE_MIN_PENCE, type BillingSettings, type FamilyRate, type LessonPrice, type Payment, type RefundRequest,
  type RepeatingPrice, type TutorRate,
} from "./types";

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
  if (!YMD.test(input.contractStart)) bad("The rate needs a start date.");
  if (input.contractEnd !== null && (!YMD.test(input.contractEnd) || input.contractEnd < input.contractStart)) bad("A rate's end date must be a date on or after its start.");
}

const FOREVER = "9999-12-31";

/**
 * What creating a rate does to the ones already there for the same family and assignment. A rate with no end replaces the current
 * open-ended one: that one is ended the day before this starts, provided this starts AFTER it did. Anything else that shares a day with
 * the new rate is refused (RATE_LOCKED): a price cannot be rewritten for dates it already covers.
 */
export function planFamilyRate(existing: Array<Pick<FamilyRate, "id" | "contractStart" | "contractEnd">>, input: Pick<FamilyRate, "contractStart" | "contractEnd">): { endId: string | null; endOn: string | null } {
  let endId: string | null = null;
  let endOn: string | null = null;
  for (const r of existing) {
    if (!rangesOverlap(r.contractStart, r.contractEnd ?? FOREVER, input.contractStart, input.contractEnd ?? FOREVER)) continue;
    if (r.contractEnd === null && input.contractEnd === null && r.contractStart < input.contractStart) {
      endId = r.id;
      endOn = dayBefore(input.contractStart);
      continue;
    }
    throw new BillingError("RATE_LOCKED", "This family already has a rate for these lessons that covers some of those dates. A new rate has to start after the current one began, and the current one then ends the day before.");
  }
  return { endId, endOn };
}

export function validateTutorRate(input: Omit<TutorRate, "id" | "createdAt">): void {
  text(input.tutorId, 1, 80, "The tutor");
  if (!isInt(input.hourlyPence) || input.hourlyPence < TUTOR_RATE_MIN_PENCE || input.hourlyPence > TUTOR_RATE_MAX_PENCE) {
    throw new BillingError("RATE_RANGE", "A tutor's pay is between 5 and 45 pounds an hour.");
  }
  if (!YMD.test(input.effectiveFrom)) bad("The tutor rate needs a start date.");
}

export function validateLessonPrice(input: Pick<LessonPrice, "lessonId" | "clientPence" | "tutorPence" | "note">): void {
  text(input.lessonId, 1, 80, "The lesson");
  validateAmounts(input);
}

/** The two sides of a set price, and its note. */
function validateAmounts(input: Pick<LessonPrice, "clientPence" | "tutorPence" | "note">): void {
  for (const [amount, what] of [[input.clientPence, "The family's price"], [input.tutorPence, "The tutor's pay"]] as const) {
    if (amount !== null && (!isInt(amount) || amount < 0 || amount > LESSON_PRICE_MAX_PENCE)) bad(`${what} for a lesson is whole pence, from nothing up to 1,000 pounds.`);
  }
  if (input.clientPence === null && input.tutorPence === null) bad("Set the family's price, the tutor's pay, or both.");
  text(input.note, 0, 500, "The note");
}

export function validateRepeatingPrice(input: Omit<RepeatingPrice, "id" | "setAt">): void {
  text(input.assignmentId, 1, 80, "The class");
  validateAmounts(input);
  const real = (d: string) => YMD.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
  if (!real(input.startDate) || !real(input.endDate)) bad("A repeating price needs a start date and an end date.");
  if (input.endDate < input.startDate) bad("The end date is before the start date.");
  if ((Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000 >= REPEATING_PRICE_MAX_DAYS) bad("A repeating price can run for up to two years.");
}

/** Refuses a repeating price that shares a day with one the class already has: which of the two applied would be a guess. */
export function checkNoOverlap(existing: Array<Pick<RepeatingPrice, "startDate" | "endDate">>, input: Pick<RepeatingPrice, "startDate" | "endDate">): void {
  const clash = existing.find((r) => rangesOverlap(r.startDate, r.endDate, input.startDate, input.endDate));
  if (clash) throw new BillingError("RATE_LOCKED", `This class already has a repeating price from ${clash.startDate} to ${clash.endDate}. Remove it first, or choose dates outside it.`);
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
  if (typeof next.paymentInstructions !== "string" || next.paymentInstructions.length > 1000) bad("The payment instructions are text of at most 1000 characters.");
}

export function validateDecision(input: { lessonId: string; party?: string; waive: boolean; note: string }): void {
  text(input.lessonId, 1, 80, "The lesson");
  if (input.party !== undefined && !["FAMILY", "TUTOR", "LEARNTHRIVE"].includes(input.party)) bad("Say who cancelled: the family, the tutor or LearnThrive.");
  if (input.party === undefined && !input.waive) bad("Record who cancelled, or that no charge is to be made.");
  text(input.note, input.waive ? 3 : 0, 500, "The note");
}

/** True when two inclusive date ranges share a day. */
export const rangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean => aStart <= bEnd && bStart <= aEnd;
