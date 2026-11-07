// The charging rules (docs/TUITION_BILLING.md), as pure functions: no database, no clock, no I/O. Given the same lessons, attendance,
// decisions and settings they always give the same answer, which is what makes a statement something a family can be shown and checked.
//
//   B1  charged when DELIVERED (monthly, in arrears)             B6  24 hours' notice is free; each child's first late cancellation is waived
//   B7  each child's first no-show is waived; repeats full price  B8  a tutor cancellation reschedules: never charged
//   B9  no routine make-up lessons (so there is no credit to track)

import { londonYmd, monthsBetween } from "./period";
import { lessonAmount } from "./money";
import type { BillingSettings, ChargeDecision, ChargeEvent, ChargeKind, FamilyRate, LineFlag, Pence } from "./types";

export interface BillingLesson {
  id: string;
  assignmentId: string;
  title: string;
  studentIds: string[];
  startAt: string;
  durationMinutes: number;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  cancelledAt?: string;
}

export interface BillingAttendance {
  lessonId: string;
  studentId: string;
  status: "ATTENDED" | "ABSENT" | "LATE" | "EXCUSED";
}

const HOUR_MS = 3_600_000;

/** One event per child per lesson, oldest first. */
export function deriveChargeEvents(input: {
  lessons: BillingLesson[];
  attendance: BillingAttendance[];
  decisions: ChargeDecision[];
  settings: BillingSettings;
  asOf: string;
}): ChargeEvent[] {
  const decisionOf = new Map(input.decisions.map((d) => [d.lessonId, d]));
  const attendanceOf = new Map(input.attendance.map((a) => [`${a.lessonId}|${a.studentId}`, a.status]));
  const out: ChargeEvent[] = [];
  for (const lesson of input.lessons) {
    const decision = decisionOf.get(lesson.id);
    const endMs = new Date(lesson.startAt).getTime() + lesson.durationMinutes * 60_000;
    for (const studentId of lesson.studentIds) {
      let kind: ChargeKind;
      if (lesson.status === "COMPLETED") {
        const attended = attendanceOf.get(`${lesson.id}|${studentId}`);
        // A completed lesson with no mark for this child is treated as attended: the tutor completed it, and an absence is something someone records.
        kind = attended === "ABSENT" ? "NO_SHOW" : attended === "EXCUSED" ? "NO_CHARGE" : "DELIVERED";
      } else if (lesson.status === "NO_SHOW") {
        kind = "NO_SHOW";
      } else if (lesson.status === "CANCELLED") {
        const party = decision?.party;
        if (party === "TUTOR" || party === "LEARNTHRIVE") kind = "TUTOR_CANCEL";
        else if (party === "FAMILY" && lesson.cancelledAt) {
          const noticeHours = (new Date(lesson.startAt).getTime() - new Date(lesson.cancelledAt).getTime()) / HOUR_MS;
          kind = noticeHours >= input.settings.lateCancelNoticeHours ? "FREE_CANCEL" : "LATE_CANCEL";
        } else kind = "NEEDS_DECISION"; // nobody recorded who cancelled (or when): not charged until an admin says
      } else {
        kind = endMs < new Date(input.asOf).getTime() ? "NEEDS_DECISION" : "NOT_YET"; // past its time and never completed, or still to come
      }
      if (decision?.waive && kind !== "NOT_YET") kind = "NO_CHARGE";
      out.push({ lessonId: lesson.id, studentId, assignmentId: lesson.assignmentId, startAt: lesson.startAt, durationMinutes: lesson.durationMinutes, kind });
    }
  }
  return out.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.lessonId.localeCompare(b.lessonId) || a.studentId.localeCompare(b.studentId));
}

export interface AllowanceVerdict {
  /** The first of its kind for this child in the current allowance window: waived. */
  waived: boolean;
  /** A second or later one. */
  repeat: boolean;
}

/**
 * Each child's FIRST late cancellation and FIRST no-show are waived, counted separately (B6, B7: the working interpretation, "not a shared
 * allowance"). The counts run over the child's whole history in date order, not just the month being billed, so a repeat in November
 * stays a repeat even though the first was in September. If the owners decide on a reset (settings.allowanceResetMonths) the count starts
 * again that many months after the child's first one of that kind.
 */
export function applyAllowances(events: ChargeEvent[], settings: BillingSettings): Map<string, AllowanceVerdict> {
  const verdicts = new Map<string, AllowanceVerdict>();
  const seen = new Map<string, number>(); // `${student}|${kind}|${window}` -> how many so far
  const firstDate = new Map<string, string>(); // `${student}|${kind}` -> the date of the first
  for (const e of events) {
    if (e.kind !== "LATE_CANCEL" && e.kind !== "NO_SHOW") continue;
    const date = londonYmd(e.startAt);
    const first = firstDate.get(`${e.studentId}|${e.kind}`) ?? (firstDate.set(`${e.studentId}|${e.kind}`, date), date);
    const window = settings.allowanceResetMonths ? Math.floor(monthsBetween(first, date) / settings.allowanceResetMonths) : 0;
    const key = `${e.studentId}|${e.kind}|${window}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    verdicts.set(`${e.lessonId}|${e.studentId}`, { waived: n === 1, repeat: n > 1 });
  }
  return verdicts;
}

/** The family rate in force on a date for an assignment, or null. */
export function rateFor(rates: FamilyRate[], clientId: string, assignmentId: string, ymd: string): FamilyRate | null {
  return rates.find((r) => r.clientId === clientId && r.assignmentId === assignmentId && r.contractStart <= ymd && ymd <= r.contractEnd) ?? null;
}

export interface PricedEvent {
  amountPence: Pence;
  ratePence: Pence | null;
  waived: boolean;
  missed: boolean;
  description: string;
  flag?: LineFlag;
  /** false for an event that has no line on a statement (a free cancellation, a tutor cancellation, a lesson to come). */
  listed: boolean;
}

/** What one event costs, and why. */
export function priceEvent(event: ChargeEvent, rate: FamilyRate | null, verdict: AllowanceVerdict | undefined, settings: BillingSettings): PricedEvent {
  const ratePence = rate?.hourlyPence ?? null;
  const full: Pence | null = ratePence === null ? null : lessonAmount(ratePence, event.durationMinutes);
  const noRate = (description: string, missed: boolean): PricedEvent => ({ amountPence: 0, ratePence: null, waived: false, missed, description, flag: "NO_RATE", listed: true });
  switch (event.kind) {
    case "DELIVERED":
      return full === null ? noRate("Lesson delivered (no agreed rate recorded)", false) : { amountPence: full, ratePence, waived: false, missed: false, description: "Lesson delivered", listed: true };
    case "NO_SHOW":
      if (verdict?.waived) return { amountPence: 0, ratePence, waived: true, missed: true, description: "Missed lesson: first no-show, waived", listed: true };
      return full === null ? noRate("Missed lesson: repeat no-show (no agreed rate recorded)", true) : { amountPence: full, ratePence, waived: false, missed: true, description: "Missed lesson: repeat no-show, charged in full", listed: true };
    case "LATE_CANCEL":
      if (verdict?.waived) return { amountPence: 0, ratePence, waived: true, missed: true, description: "Late cancellation: first one, waived", listed: true };
      if (settings.repeatLateCancelFeePence === null) return { amountPence: 0, ratePence, waived: false, missed: true, description: "Late cancellation: repeat (the charge is not decided yet)", flag: "FEE_UNCONFIRMED", listed: true };
      return { amountPence: settings.repeatLateCancelFeePence, ratePence, waived: false, missed: true, description: "Late cancellation: repeat", listed: true };
    case "NEEDS_DECISION":
      return { amountPence: 0, ratePence, waived: false, missed: false, description: "Needs a decision before it can be charged", flag: "NEEDS_DECISION", listed: true };
    default:
      return { amountPence: 0, ratePence, waived: false, missed: false, description: "", listed: false };
  }
}

