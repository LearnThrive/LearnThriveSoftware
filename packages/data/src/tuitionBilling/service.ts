// Reads what billing needs from the tuition DataProvider (lessons, attendance, families, children) and the billing repository, and hands it to
// the pure rules. This is the only place the two meet, so the rules stay testable on plain data.

import type { DataProvider } from "../repositories";
import { buildStatement, chargeablePeriodsBefore, overdueVerdict, type OverdueVerdict, type StatementInput } from "./statement";
import { londonYmd } from "./period";
import { decideRefund, isRefundApprover, type Actor, type RefundApprovers } from "./refunds";
import { deriveChargeEvents, type BillingAttendance, type BillingLesson } from "./rules";
import type { TuitionBillingRepository } from "./repository";
import { BillingError, type CompanyDetails, type IssuedStatement, type Pence, type Payment, type RefundRequest, type StatementDraft } from "./types";

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
  const [settings, rates, decisions, payments, statements, profile] = await Promise.all([
    ctx.billing.settings.get(), ctx.billing.familyRates.list(clientId), ctx.billing.decisions.list(lessons.map((l) => l.id)), ctx.billing.payments.list(clientId),
    ctx.billing.statements.list(clientId), ctx.billing.profiles.get(clientId),
  ]);
  const before = statements.filter((s) => s.period < period);
  const previous = before[before.length - 1] ?? null;
  const input: StatementInput = {
    client: { id: client.id, name: client.name }, students: children, period, lessons: billingLessons, attendance, decisions, rates, payments, profile, settings, company: ctx.company,
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
