// What each tutor is owed for a month's lessons (Tahasin, 14 Nov 2026: tutors are paid from the company bank account on the 15th of each
// month, as self-employed). This only ADDS UP; it moves no money. It is admin-only like everything else here: a tutor never sees it (B17).
//
// Rules, and what is NOT decided:
//   * a lesson is paid once, however many children are on it, when it was COMPLETED in the month (London date) and at least one child
//     was there (marked present or late, or not marked at all, the same way a family is charged);
//   * the tutor's hourly pay is the rate in force on the lesson's date (the newest rate that started on or before it), for the lesson's
//     length in minutes, rounded half up to the penny like a family's charge;
//   * a lesson where every child was absent is NOT counted: whether a tutor is paid for waiting is undecided, so it is listed apart for a
//     person to decide, not guessed;
//   * a lesson with no pay rate for that tutor yet is listed as unpriced, at nothing, never guessed.

import { lessonAmount } from "./money";
import { londonYmd, PERIOD, periodOf } from "./period";
import type { Pence, TutorRate } from "./types";

export interface TutorPayLesson {
  id: string;
  tutorId: string;
  title: string;
  startAt: string;
  durationMinutes: number;
  status: string;
  studentIds: string[];
}

export interface TutorPayAttendance {
  lessonId: string;
  studentId: string;
  status: "ATTENDED" | "ABSENT" | "LATE" | "EXCUSED";
}

export interface TutorPayLine {
  lessonId: string;
  date: string;
  title: string;
  minutes: number;
  ratePence: Pence | null;
  amountPence: Pence;
}

export interface TutorPaySummary {
  tutorId: string;
  tutorName: string;
  period: string;
  lines: TutorPayLine[];
  totalMinutes: number;
  totalPence: Pence;
  /** Completed lessons with no pay rate in force for this tutor on that date: listed at nothing. */
  unpricedLessons: number;
  /** Completed lessons where every child was absent: not counted, for a person to decide. */
  allAbsentLessons: Array<{ lessonId: string; date: string; title: string }>;
}

/** The pay rate in force on a date: the newest one that started on or before it. */
export function tutorRateOn(rates: TutorRate[], tutorId: string, ymd: string): TutorRate | null {
  let best: TutorRate | null = null;
  for (const r of rates) if (r.tutorId === tutorId && r.effectiveFrom <= ymd && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  return best;
}

export function tutorPay(input: {
  period: string;
  tutors: Array<{ id: string; name: string }>;
  lessons: TutorPayLesson[];
  attendance: TutorPayAttendance[];
  rates: TutorRate[];
}): TutorPaySummary[] {
  if (!PERIOD.test(input.period)) throw new Error("A pay period is a month, yyyy-mm.");
  const absentOnly = (lessonId: string, studentIds: string[]): boolean => {
    if (studentIds.length === 0) return false;
    return studentIds.every((studentId) => {
      const mark = input.attendance.find((a) => a.lessonId === lessonId && a.studentId === studentId)?.status;
      return mark === "ABSENT" || mark === "EXCUSED";
    });
  };
  return input.tutors.map((tutor): TutorPaySummary => {
    const lines: TutorPayLine[] = [];
    const allAbsentLessons: TutorPaySummary["allAbsentLessons"] = [];
    let unpricedLessons = 0;
    const mine = input.lessons
      .filter((l) => l.tutorId === tutor.id && l.status === "COMPLETED" && periodOf(londonYmd(l.startAt)) === input.period)
      .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
    for (const l of mine) {
      const date = londonYmd(l.startAt);
      if (absentOnly(l.id, l.studentIds)) {
        allAbsentLessons.push({ lessonId: l.id, date, title: l.title });
        continue;
      }
      const rate = tutorRateOn(input.rates, tutor.id, date);
      if (!rate) unpricedLessons += 1;
      lines.push({ lessonId: l.id, date, title: l.title, minutes: l.durationMinutes, ratePence: rate?.hourlyPence ?? null, amountPence: rate ? lessonAmount(rate.hourlyPence, l.durationMinutes) : 0 });
    }
    return {
      tutorId: tutor.id, tutorName: tutor.name, period: input.period, lines, unpricedLessons, allAbsentLessons,
      totalMinutes: lines.reduce((n, l) => n + l.minutes, 0), totalPence: lines.reduce((n, l) => n + l.amountPence, 0),
    };
  }).sort((a, b) => a.tutorName.localeCompare(b.tutorName));
}
