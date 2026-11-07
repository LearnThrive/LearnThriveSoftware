// The monthly statement (B1, B14, B16): what a family owes for the lessons delivered in a calendar month, plus any chargeable missed lessons,
// less the sibling discount, with the payments received and the balance. Pure: the caller passes in everything it reads.

import { applyAllowances, deriveChargeEvents, priceEvent, rateFor, type BillingAttendance, type BillingLesson } from "./rules";
import { percentOf } from "./money";
import { addMonths, londonYmd, periodBounds, periodOf } from "./period";
import type {
  BillingSettings, ChargeDecision, CompanyDetails, FamilyBillingProfile, FamilyRate, IssuedStatement, Pence, Payment, StatementBlocker, StatementDraft, StatementLine,
} from "./types";

export interface StatementInput {
  client: { id: string; name: string };
  /** The children this family pays for (a child linked to more than one adult is billed to ONE of them: see service.ts). */
  students: Array<{ id: string; name: string }>;
  period: string; // yyyy-mm
  lessons: BillingLesson[];
  attendance: BillingAttendance[];
  decisions: ChargeDecision[];
  rates: FamilyRate[];
  payments: Payment[];
  profile: FamilyBillingProfile;
  settings: BillingSettings;
  company: CompanyDetails;
  /** "Now": what is past its time and never completed is asked about rather than charged. */
  asOf: string;
  /** The last statement already issued before this period, if any. */
  previous: IssuedStatement | null;
  /** Payments already counted in an issued statement (they are never counted twice). */
  countedPaymentIds: ReadonlySet<string>;
  /** Set by the caller when an earlier month had chargeable events and no statement was issued for it. */
  earlierPeriodNotIssued?: boolean;
}

interface PeriodTotals {
  lines: StatementLine[];
  lessonChargesPence: Pence;
  missedLessonChargesPence: Pence;
  siblingDiscountPence: Pence;
  totalChargesPence: Pence;
}

/** All the lines for every event (the whole history), grouped by the month they fall in. */
function linesByPeriod(input: StatementInput): Map<string, StatementLine[]> {
  const names = new Map(input.students.map((s) => [s.id, s.name]));
  const mine = new Set(input.students.map((s) => s.id));
  const titles = new Map(input.lessons.map((l) => [l.id, l.title]));
  const events = deriveChargeEvents({ lessons: input.lessons, attendance: input.attendance, decisions: input.decisions, settings: input.settings, asOf: input.asOf }).filter((e) => mine.has(e.studentId));
  const verdicts = applyAllowances(events, input.settings);
  const out = new Map<string, StatementLine[]>();
  for (const e of events) {
    const date = londonYmd(e.startAt);
    const priced = priceEvent(e, rateFor(input.rates, input.client.id, e.assignmentId, date), verdicts.get(`${e.lessonId}|${e.studentId}`), input.settings);
    if (!priced.listed) continue;
    const line: StatementLine = {
      lessonId: e.lessonId, studentId: e.studentId, studentName: names.get(e.studentId) ?? "", date, title: titles.get(e.lessonId) ?? "Lesson",
      kind: e.kind, description: priced.description, minutes: e.durationMinutes, ratePence: priced.ratePence, amountPence: priced.amountPence,
      waived: priced.waived, missed: priced.missed, ...(priced.flag ? { flag: priced.flag } : {}),
    };
    const list = out.get(periodOf(date)) ?? [];
    list.push(line);
    out.set(periodOf(date), list);
  }
  return out;
}

function totalsOf(lines: StatementLine[], input: StatementInput): PeriodTotals {
  const lessonChargesPence = lines.filter((l) => !l.missed).reduce((n, l) => n + l.amountPence, 0);
  const missedLessonChargesPence = lines.filter((l) => l.missed).reduce((n, l) => n + l.amountPence, 0);
  // B4: the discount is on the monthly LESSON charges (delivered lessons), not on a missed-lesson charge.
  const siblingDiscountPence = input.profile.siblingDiscountEligible ? percentOf(lessonChargesPence, input.settings.siblingDiscountPercent) : 0;
  return { lines, lessonChargesPence, missedLessonChargesPence, siblingDiscountPence, totalChargesPence: lessonChargesPence + missedLessonChargesPence - siblingDiscountPence };
}

export function buildStatement(input: StatementInput): StatementDraft {
  const { start, end } = periodBounds(input.period);
  const byPeriod = linesByPeriod(input);
  const mine = totalsOf((byPeriod.get(input.period) ?? []).sort((a, b) => a.date.localeCompare(b.date) || a.studentName.localeCompare(b.studentName)), input);

  // Where the balance starts: the last issued statement's closing balance, else everything charged in the months before this one (B14: a
  // mid-month start needs nothing special; charges follow lessons delivered).
  let openingBalancePence = 0;
  if (input.previous) openingBalancePence = input.previous.closingBalancePence;
  else for (const [period, lines] of byPeriod) if (period < input.period) openingBalancePence += totalsOf(lines, input).totalChargesPence;

  const counted = input.payments.filter((p) => !input.countedPaymentIds.has(p.id) && p.receivedOn <= end);
  const paymentsReceivedPence = counted.reduce((n, p) => n + p.amountPence, 0);

  const blockers = new Set<StatementBlocker>();
  for (const line of mine.lines) if (line.flag) blockers.add(line.flag);
  if (input.earlierPeriodNotIssued) blockers.add("EARLIER_PERIOD_NOT_ISSUED");
  if (londonYmd(input.asOf) <= end) blockers.add("PERIOD_NOT_ENDED"); // the statement is for the month just finished, issued at month-end (B1)

  return {
    clientId: input.client.id, clientName: input.client.name, period: input.period, periodStart: start, periodEnd: end, lines: mine.lines,
    lessonChargesPence: mine.lessonChargesPence, missedLessonChargesPence: mine.missedLessonChargesPence, siblingDiscountPence: mine.siblingDiscountPence,
    siblingDiscountPercent: input.settings.siblingDiscountPercent, siblingDiscountApplied: input.profile.siblingDiscountEligible,
    totalChargesPence: mine.totalChargesPence, paymentsReceivedPence, paymentIds: counted.map((p) => p.id).sort(), openingBalancePence,
    closingBalancePence: openingBalancePence + mine.totalChargesPence - paymentsReceivedPence, blockers: [...blockers].sort(), company: input.company,
  };
}

/** The months (yyyy-mm) before a period in which a family has anything to bill: used to ask for earlier statements first. */
export function chargeablePeriodsBefore(input: StatementInput): string[] {
  return [...linesByPeriod(input).entries()].filter(([p, lines]) => p < input.period && lines.some((l) => l.amountPence !== 0 || l.flag)).map(([p]) => p).sort();
}

// ---- overdue (B12) ---------------------------------------------------------------------------------------------------------------------

export interface OverdueVerdict {
  /** A balance has been unpaid for more than one month. A flag for a person to look at. */
  overdue: boolean;
  amountOverduePence: Pence;
  oldestUnpaidStatementId: string | null;
  oldestUnpaidIssuedOn: string | null;
  /** Always false. Pausing lessons is a person's decision (B12): "keep automated suspension off until the trigger is confirmed". */
  autoSuspend: false;
}

/**
 * Payments are applied to the OLDEST statement first. A statement is overdue when part of it is still unpaid and it was issued more than one
 * calendar month ago. The clock starts at the statement's issue date: the owners have not said when it should start (OPEN), so this is the
 * working rule and it lives in this one function. No late fee is ever added (B12).
 */
export function overdueVerdict(statements: Array<Pick<IssuedStatement, "id" | "issuedOn" | "totalChargesPence" | "openingBalancePence">>, payments: Array<Pick<Payment, "amountPence">>, asOf: string): OverdueVerdict {
  const ordered = [...statements].sort((a, b) => a.issuedOn.localeCompare(b.issuedOn));
  let credit = payments.reduce((n, p) => n + p.amountPence, 0);
  // A balance brought forward from before the first statement we know about is owed too, and is as old as that statement.
  const owed = ordered.map((s, i) => ({ id: s.id, issuedOn: s.issuedOn, amount: s.totalChargesPence + (i === 0 ? Math.max(0, s.openingBalancePence) : 0) }));
  const today = londonYmd(asOf);
  let overdueAmount = 0;
  let oldest: { id: string; issuedOn: string } | null = null;
  for (const o of owed) {
    const paid = Math.min(Math.max(0, credit), Math.max(0, o.amount));
    credit -= paid;
    const unpaid = Math.max(0, o.amount) - paid;
    if (unpaid > 0 && addMonths(o.issuedOn, 1) < today) {
      overdueAmount += unpaid;
      oldest ??= { id: o.id, issuedOn: o.issuedOn };
    }
  }
  return { overdue: overdueAmount > 0, amountOverduePence: overdueAmount, oldestUnpaidStatementId: oldest?.id ?? null, oldestUnpaidIssuedOn: oldest?.issuedOn ?? null, autoSuspend: false };
}
