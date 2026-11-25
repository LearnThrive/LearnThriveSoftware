// Reads what billing needs from the tuition DataProvider (lessons, attendance, families, children) and the billing repository, and hands it to
// the pure rules. This is the only place the two meet, so the rules stay testable on plain data.

import type { DataProvider } from "../repositories";
import { buildStatement, chargeablePeriodsBefore, overdueVerdict, type OverdueVerdict, type StatementInput } from "./statement";
import { tutorPay, type TutorPayAttendance, type TutorPaySummary } from "./tutorPay";
import { londonYmd } from "./period";
import { decideRefund, isRefundApprover, type Actor, type RefundApprovers } from "./refunds";
import { deriveChargeEvents, type BillingAttendance, type BillingLesson } from "./rules";
import type { TuitionBillingRepository } from "./repository";
import { validateLessonPrice } from "./validate";
import { BillingError, type CompanyDetails, type IssuedStatement, type LessonPrice, type LineFlag, type Pence, type Payment, type RefundRequest, type StatementDraft } from "./types";

export interface BillingContext {
  data: DataProvider;
  billing: TuitionBillingRepository;
  company: CompanyDetails;
  approvers: RefundApprovers;
  /** The clock, injectable for tests. */
  now?: () => string;
}

const nowOf = (ctx: BillingContext): string => (ctx.now ?? (() => new Date().toISOString()))();

/**
 * A child linked to more than one adult is billed to ONE of them: the one with the lowest id. Who pays when there are two guardians is an
 * OPEN question (B15), so this is a stable placeholder rule, not a decision: it keeps a child from being billed twice.
 */
async function payerOf(ctx: BillingContext, studentId: string): Promise<string | null> {
  const clients = await ctx.data.students.clientsFor(studentId);
  return clients.map((c) => c.id).sort()[0] ?? null;
}

async function gather(ctx: BillingContext, clientId: string, period: string): Promise<{ input: StatementInput } | null> {
  const client = await ctx.data.clients.get(clientId);
  if (!client) return null;
  const children = [];
  for (const child of await ctx.data.students.studentsFor(clientId)) if ((await payerOf(ctx, child.id)) === clientId) children.push({ id: child.id, name: child.name });
  const lessons = await ctx.data.lessons.forClient(clientId);
  const billingLessons: BillingLesson[] = lessons.map((l) => ({
    id: l.id, assignmentId: l.assignmentId, title: l.title, studentIds: l.studentIds, startAt: l.startAt, durationMinutes: l.durationMinutes, status: l.status,
    ...(l.cancelledAt ? { cancelledAt: l.cancelledAt } : {}),
  }));
  const attendance: BillingAttendance[] = [];
  for (const lesson of lessons) for (const a of await ctx.data.attendance.forLesson(lesson.id)) attendance.push({ lessonId: a.lessonId, studentId: a.studentId, status: a.status });
  const lessonIds = lessons.map((l) => l.id);
  const [settings, rates, decisions, payments, statements, profile, lessonPrices] = await Promise.all([
    ctx.billing.settings.get(), ctx.billing.familyRates.list(clientId), ctx.billing.decisions.list(lessonIds), ctx.billing.payments.list(clientId),
    ctx.billing.statements.list(clientId), ctx.billing.profiles.get(clientId), ctx.billing.lessonPrices.list(lessonIds),
  ]);
  const before = statements.filter((s) => s.period < period);
  const previous = before[before.length - 1] ?? null;
  const input: StatementInput = {
    client: { id: client.id, name: client.name }, students: children, period, lessons: billingLessons, attendance, decisions, rates, lessonPrices, payments, profile, settings, company: ctx.company,
    asOf: nowOf(ctx), previous, countedPaymentIds: new Set(statements.flatMap((s) => s.paymentIds)),
  };
  const issued = new Set(statements.map((s) => s.period));
  input.earlierPeriodNotIssued = chargeablePeriodsBefore(input).some((p) => !issued.has(p));
  return { input };
}

/** What the statement for a family and month would say if it were issued now. Null if there is no such family. */
export async function previewStatement(ctx: BillingContext, clientId: string, period: string): Promise<StatementDraft | null> {
  const g = await gather(ctx, clientId, period);
  return g ? buildStatement(g.input) : null;
}

/** Issues (freezes) a statement. Refused while anything blocks it: no agreed rate, a cancellation nobody has explained, an unfinished month. */
export async function issueStatement(ctx: BillingContext, clientId: string, period: string, actor: Actor): Promise<IssuedStatement> {
  const existing = await ctx.billing.statements.get(clientId, period);
  if (existing) throw new BillingError("ALREADY_ISSUED", "A statement for this family and month has already been issued.");
  const draft = await previewStatement(ctx, clientId, period);
  if (!draft) throw new BillingError("NOT_FOUND", "There is no such family.");
  if (draft.blockers.length > 0) throw new BillingError("INVALID", `This statement cannot be issued yet: ${draft.blockers.join(", ")}.`);
  const issued = await ctx.billing.statements.issue(draft, actor.id, londonYmd(nowOf(ctx)));
  await ctx.billing.audit.append({ actorId: actor.id, action: "statement.issued", subject: `${clientId}/${period}`, detail: { invoiceNumber: issued.invoiceNumber, totalChargesPence: issued.totalChargesPence, closingBalancePence: issued.closingBalancePence } });
  return issued;
}

export interface FamilyBalance {
  clientId: string;
  clientName: string;
  siblingDiscountEligible: boolean;
  lastStatementPeriod: string | null;
  /** What the family owes now: the last statement's closing balance, less payments recorded since. Negative = they are in credit. */
  balancePence: Pence;
  overdue: OverdueVerdict;
  /** Cancelled or unfinished lessons nobody has decided yet, anywhere in the family's history. */
  lessonsNeedingDecision: number;
}

/** One row per family, for the admin list. Overdue is a flag for a person to look at: nothing here pauses a lesson (B12). */
export async function familyBalances(ctx: BillingContext): Promise<FamilyBalance[]> {
  const out: FamilyBalance[] = [];
  for (const client of await ctx.data.clients.list()) {
    const [statements, payments, profile] = await Promise.all([ctx.billing.statements.list(client.id), ctx.billing.payments.list(client.id), ctx.billing.profiles.get(client.id)]);
    const counted = new Set(statements.flatMap((s) => s.paymentIds));
    const uncounted = payments.filter((p) => !counted.has(p.id)).reduce((n, p) => n + p.amountPence, 0);
    const last = statements[statements.length - 1];
    const g = await gather(ctx, client.id, last?.period ?? londonYmd(nowOf(ctx)).slice(0, 7));
    const lessonsNeedingDecision = g ? countNeedingDecision(g.input) : 0;
    out.push({
      clientId: client.id, clientName: client.name, siblingDiscountEligible: profile.siblingDiscountEligible, lastStatementPeriod: last?.period ?? null,
      balancePence: (last?.closingBalancePence ?? 0) - uncounted, overdue: overdueVerdict(statements, payments, nowOf(ctx)), lessonsNeedingDecision,
    });
  }
  return out.sort((a, b) => a.clientName.localeCompare(b.clientName));
}

/**
 * What a PARENT may see of their own family's money: the statements issued to them, what they have paid and what they owe. A projection,
 * not the stored rows: it carries no lesson or child id, no administrator's id, no internal note on a payment, and nothing about a rate
 * beyond what is printed on the statement itself. Built from the family id the caller has already resolved from the signed-in parent,
 * never from anything the parent sends.
 */
export interface ParentStatementLine { date: string; childName: string; title: string; description: string; minutes: number; amountPence: Pence }
export interface ParentStatement {
  invoiceNumber: string;
  period: string;
  issuedOn: string;
  lines: ParentStatementLine[];
  lessonChargesPence: Pence;
  missedLessonChargesPence: Pence;
  siblingDiscountPence: Pence;
  siblingDiscountPercent: number;
  siblingDiscountApplied: boolean;
  totalChargesPence: Pence;
  paymentsReceivedPence: Pence;
  openingBalancePence: Pence;
  closingBalancePence: Pence;
  company: CompanyDetails;
}
export interface ParentPayment { receivedOn: string; amountPence: Pence; method: string }
export interface ParentAccount {
  /** What the family owes now: the last statement's closing balance less payments recorded since. Negative = in credit. */
  balancePence: Pence;
  overdue: boolean;
  statements: ParentStatement[];
  payments: ParentPayment[];
  /** How to pay, written by an administrator. Empty until they have. */
  paymentInstructions: string;
}

export async function parentAccount(ctx: BillingContext, clientId: string): Promise<ParentAccount> {
  const [statements, payments, settings] = await Promise.all([ctx.billing.statements.list(clientId), ctx.billing.payments.list(clientId), ctx.billing.settings.get()]);
  const counted = new Set(statements.flatMap((s) => s.paymentIds));
  const uncounted = payments.filter((p) => !counted.has(p.id)).reduce((n, p) => n + p.amountPence, 0);
  const last = statements[statements.length - 1];
  return {
    balancePence: (last?.closingBalancePence ?? 0) - uncounted,
    overdue: overdueVerdict(statements, payments, nowOf(ctx)).overdue,
    statements: statements.slice().reverse().map((s): ParentStatement => ({
      invoiceNumber: s.invoiceNumber, period: s.period, issuedOn: s.issuedOn,
      lines: s.lines.filter((l) => l.kind !== "NEEDS_DECISION").map((l) => ({ date: l.date, childName: l.studentName, title: l.title, description: l.description, minutes: l.minutes, amountPence: l.amountPence })),
      lessonChargesPence: s.lessonChargesPence, missedLessonChargesPence: s.missedLessonChargesPence, siblingDiscountPence: s.siblingDiscountPence,
      siblingDiscountPercent: s.siblingDiscountPercent, siblingDiscountApplied: s.siblingDiscountApplied, totalChargesPence: s.totalChargesPence,
      paymentsReceivedPence: s.paymentsReceivedPence, openingBalancePence: s.openingBalancePence, closingBalancePence: s.closingBalancePence, company: s.company,
    })),
    payments: payments.slice().sort((a, b) => b.receivedOn.localeCompare(a.receivedOn)).map((p): ParentPayment => ({ receivedOn: p.receivedOn, amountPence: p.amountPence, method: p.method })),
    paymentInstructions: settings.paymentInstructions,
  };
}

function countNeedingDecision(input: StatementInput): number {
  const mine = new Set(input.students.map((s) => s.id));
  const events = deriveChargeEvents({ lessons: input.lessons, attendance: input.attendance, decisions: input.decisions, settings: input.settings, asOf: input.asOf });
  return new Set(events.filter((e) => e.kind === "NEEDS_DECISION" && mine.has(e.studentId)).map((e) => e.lessonId)).size;
}

export interface LessonNeedingDecision {
  lessonId: string;
  title: string;
  startAt: string;
  studentName: string;
  status: string;
}

/** The cancelled or unfinished lessons nobody has explained yet, so an admin can say who cancelled or waive the charge (B6, B8). */
export async function lessonsNeedingDecision(ctx: BillingContext, clientId: string): Promise<LessonNeedingDecision[]> {
  const g = await gather(ctx, clientId, londonYmd(nowOf(ctx)).slice(0, 7));
  if (!g) return [];
  const { input } = g;
  const mine = new Map(input.students.map((s) => [s.id, s.name]));
  const lessons = new Map(input.lessons.map((l) => [l.id, l]));
  const events = deriveChargeEvents({ lessons: input.lessons, attendance: input.attendance, decisions: input.decisions, settings: input.settings, asOf: input.asOf });
  const seen = new Set<string>();
  const out: LessonNeedingDecision[] = [];
  for (const e of events) {
    if (e.kind !== "NEEDS_DECISION" || !mine.has(e.studentId) || seen.has(e.lessonId)) continue;
    seen.add(e.lessonId);
    const l = lessons.get(e.lessonId)!;
    out.push({ lessonId: l.id, title: l.title, startAt: l.startAt, studentName: mine.get(e.studentId)!, status: l.status });
  }
  return out.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** What each tutor is owed for a month's lessons (admin only; see tutorPay.ts for the rules and what is left undecided). */
export async function tutorPayFor(ctx: BillingContext, period: string): Promise<TutorPaySummary[]> {
  const [tutors, lessons, rates] = await Promise.all([ctx.data.tutors.list(), ctx.data.lessons.list(), ctx.billing.tutorRates.list()]);
  const attendance: TutorPayAttendance[] = [];
  const paid: string[] = [];
  for (const l of lessons) {
    if (l.status !== "COMPLETED" || londonYmd(l.startAt).slice(0, 7) !== period) continue;
    paid.push(l.id);
    for (const a of await ctx.data.attendance.forLesson(l.id)) attendance.push({ lessonId: a.lessonId, studentId: a.studentId, status: a.status });
  }
  const lessonPrices = await ctx.billing.lessonPrices.list(paid);
  return tutorPay({ period, tutors: tutors.filter((t) => t.id !== ARCHIVED_TUTOR_ID).map((t) => ({ id: t.id, name: t.name })), lessons, attendance, rates, lessonPrices });
}

/**
 * Sets one lesson's own price: what each child's family is charged for it and/or what its tutor is paid, in place of the hourly rates. The
 * family's price cannot change once the lesson is on an issued statement (a statement is frozen: the family has been told what they owe);
 * the tutor's pay still can, since nothing here pays a tutor. Audited.
 */
export async function setLessonPrice(ctx: BillingContext, input: { lessonId: string; clientPence: Pence | null; tutorPence: Pence | null; note: string }, actor: Actor): Promise<LessonPrice> {
  validateLessonPrice(input);
  const lesson = await ctx.data.lessons.get(input.lessonId);
  if (!lesson) throw new BillingError("NOT_FOUND", "There is no such lesson.");
  const [before] = await ctx.billing.lessonPrices.list([lesson.id]);
  if ((before?.clientPence ?? null) !== input.clientPence) await refuseIfInvoiced(ctx, lesson.id);
  const price = await ctx.billing.lessonPrices.set({ ...input, setBy: actor.id });
  await ctx.billing.audit.append({
    actorId: actor.id, action: "lesson_price.set", subject: lesson.id,
    detail: { clientPence: price.clientPence, tutorPence: price.tutorPence, previousClientPence: before?.clientPence ?? null, previousTutorPence: before?.tutorPence ?? null, note: price.note },
  });
  return price;
}

/** Puts a lesson back on the hourly rates. Refused, like a change, if its family price is already on an issued statement. Audited. */
export async function clearLessonPrice(ctx: BillingContext, lessonId: string, actor: Actor): Promise<void> {
  const [before] = await ctx.billing.lessonPrices.list([lessonId]);
  if (!before) return;
  if (before.clientPence !== null) await refuseIfInvoiced(ctx, lessonId);
  await ctx.billing.lessonPrices.clear(lessonId);
  await ctx.billing.audit.append({ actorId: actor.id, action: "lesson_price.cleared", subject: lessonId, detail: { clientPence: before.clientPence, tutorPence: before.tutorPence } });
}

async function refuseIfInvoiced(ctx: BillingContext, lessonId: string): Promise<void> {
  const on = (await ctx.billing.statements.list()).find((s) => s.lines.some((l) => l.lessonId === lessonId));
  if (on) throw new BillingError("INVALID", `This lesson is already on statement ${on.invoiceNumber}, which has been issued, so what the family pays for it can no longer change.`);
}

/** One lesson in a month, with what the families owe for it and what its tutor is paid for it, side by side (admin only). */
export interface LessonMoney {
  lessonId: string;
  startAt: string;
  date: string;
  title: string;
  tutorName: string;
  status: string;
  minutes: number;
  /** What the families are charged for this lesson, all children together, before any sibling discount (that is taken off the month). */
  clientOwedPence: Pence;
  /** What the tutor is paid for it. Null while it is not paid: not completed, or every child was absent (undecided). */
  tutorPayPence: Pence | null;
  /** Client owed less tutor pay, when the tutor is paid. */
  marginPence: Pence | null;
  /** The lesson's own price, if an administrator set one. */
  price: LessonPrice | null;
  /** On an issued (frozen) statement: the family price can no longer change. */
  invoiced: boolean;
  flags: LineFlag[];
}

/** Every lesson in a month with the family side and the tutor side kept apart, so each lesson's price and pay can be read and set. */
export async function lessonMoneyFor(ctx: BillingContext, period: string): Promise<LessonMoney[]> {
  const [lessons, tutors, clients, pay] = await Promise.all([ctx.data.lessons.list(), ctx.data.tutors.list(), ctx.data.clients.list(), tutorPayFor(ctx, period)]);
  const inMonth = lessons.filter((l) => londonYmd(l.startAt).slice(0, 7) === period);
  if (inMonth.length === 0) return [];
  const owed = new Map<string, Pence>();
  const flags = new Map<string, Set<LineFlag>>();
  const invoiced = new Set<string>();
  for (const client of clients) {
    const issued = await ctx.billing.statements.get(client.id, period);
    const lines = issued ? issued.lines : (await previewStatement(ctx, client.id, period))?.lines ?? [];
    for (const line of lines) {
      owed.set(line.lessonId, (owed.get(line.lessonId) ?? 0) + line.amountPence);
      if (line.flag) flags.set(line.lessonId, (flags.get(line.lessonId) ?? new Set()).add(line.flag));
      if (issued) invoiced.add(line.lessonId);
    }
  }
  const paidFor = new Map(pay.flatMap((s) => s.lines).map((l) => [l.lessonId, l.amountPence]));
  const prices = new Map((await ctx.billing.lessonPrices.list(inMonth.map((l) => l.id))).map((p) => [p.lessonId, p]));
  const tutorName = new Map(tutors.map((t) => [t.id, t.name]));
  return inMonth.map((l): LessonMoney => {
    const clientOwedPence = owed.get(l.id) ?? 0;
    const tutorPayPence = paidFor.get(l.id) ?? null;
    return {
      lessonId: l.id, startAt: l.startAt, date: londonYmd(l.startAt), title: l.title, tutorName: tutorName.get(l.tutorId) ?? "", status: l.status, minutes: l.durationMinutes,
      clientOwedPence, tutorPayPence, marginPence: tutorPayPence === null ? null : clientOwedPence - tutorPayPence, price: prices.get(l.id) ?? null,
      invoiced: invoiced.has(l.id), flags: [...(flags.get(l.id) ?? [])],
    };
  }).sort((a, b) => a.startAt.localeCompare(b.startAt) || a.lessonId.localeCompare(b.lessonId));
}

/** The archived "Former tutor" a purge moves history to: nobody is paid through it. */
const ARCHIVED_TUTOR_ID = "00000000-0000-4000-8000-0000000000fe";

export async function recordPayment(ctx: BillingContext, input: Omit<Payment, "id" | "createdAt" | "recordedBy">, actor: Actor): Promise<Payment> {
  const payment = await ctx.billing.payments.record({ ...input, recordedBy: actor.id });
  await ctx.billing.audit.append({ actorId: actor.id, action: "payment.recorded", subject: input.clientId, detail: { paymentId: payment.id, amountPence: payment.amountPence, method: payment.method, receivedOn: payment.receivedOn } });
  return payment;
}

export async function voidPayment(ctx: BillingContext, paymentId: string, reason: string, actor: Actor): Promise<void> {
  await ctx.billing.payments.void(paymentId, reason, actor.id);
  await ctx.billing.audit.append({ actorId: actor.id, action: "payment.voided", subject: paymentId, detail: { reason: reason.trim() } });
}

export async function requestRefund(ctx: BillingContext, input: { clientId: string; amountPence: Pence; reason: string; statutory: boolean }, actor: Actor): Promise<RefundRequest> {
  const refund = await ctx.billing.refunds.request({ ...input, requestedBy: actor.id });
  await ctx.billing.audit.append({ actorId: actor.id, action: "refund.requested", subject: refund.id, detail: { clientId: input.clientId, amountPence: input.amountPence, statutory: input.statutory } });
  return refund;
}

export type RefundDecisionOutcome = { ok: true; refund: RefundRequest } | { ok: false; reason: "not_approver" | "already_decided" | "same_person" | "needs_note" | "not_found" };

/** Only a named approver gets past here (B11). Everything, including a refusal to act, is audited. */
export async function decideRefundRequest(ctx: BillingContext, refundId: string, actor: Actor, approve: boolean, note: string): Promise<RefundDecisionOutcome> {
  const request = await ctx.billing.refunds.get(refundId);
  if (!request) return { ok: false, reason: "not_found" };
  const settings = await ctx.billing.settings.get();
  const result = decideRefund({ request, actor, approve, note, approvers: ctx.approvers, settings, now: nowOf(ctx) });
  if (!result.ok) {
    await ctx.billing.audit.append({ actorId: actor.id, action: "refund.decision_refused", subject: refundId, detail: { reason: result.reason, approverCheck: isRefundApprover(actor, ctx.approvers) } });
    return result;
  }
  const refund = await ctx.billing.refunds.update(refundId, result.patch);
  await ctx.billing.audit.append({ actorId: actor.id, action: `refund.${result.status.toLowerCase()}`, subject: refundId, detail: { clientId: request.clientId, amountPence: request.amountPence } });
  return { ok: true, refund };
}
