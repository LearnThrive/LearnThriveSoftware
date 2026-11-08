import type { SqlExecutor } from "../library/ports";
import { rangesOverlap, validateDecision, validateFamilyRate, validatePayment, validateRefundRequest, validateSettings, validateTutorRate } from "./validate";
import type { TuitionBillingRepository } from "./repository";
import {
  BillingError, type AuditEntry, type BillingSettings, type ChargeDecision, type FamilyBillingProfile, type FamilyRate, type IssuedStatement, type Payment,
  type RefundRequest, type TutorRate,
} from "./types";

/**
 * The Postgres implementation (migration 0021). Server only, like the lesson tables: the site's database role reads and writes these, and
 * no API role has any grant on them. Ids are uuids; an id that is not one answers "not found" rather than a database error.
 */
type Row = Record<string, any>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: string | undefined | null): v is string => typeof v === "string" && UUID.test(v);
const iso = (v: unknown): string => new Date(v as string | number | Date).toISOString();
/** A date column as yyyy-mm-dd, whatever the driver hands back (a string, or a Date at UTC midnight). */
const ymd = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : new Date(v as Date).toISOString().slice(0, 10));
/** An actor id from a session. Real sessions carry a profile uuid; anything else is stored as null on the row and kept in the audit text. */
const actorId = (v: string): string | null => (isId(v) ? v : null);

const toFamilyRate = (r: Row): FamilyRate => ({ id: r.id, clientId: r.client_id, assignmentId: r.assignment_id, hourlyPence: r.hourly_pence, contractStart: ymd(r.contract_start), contractEnd: ymd(r.contract_end), createdBy: r.created_by ?? "", createdAt: iso(r.created_at) });
const toTutorRate = (r: Row): TutorRate => ({ id: r.id, tutorId: r.tutor_id, hourlyPence: r.hourly_pence, effectiveFrom: ymd(r.effective_from), createdBy: r.created_by ?? "", createdAt: iso(r.created_at) });
const toDecision = (r: Row): ChargeDecision => ({ lessonId: r.lesson_id, ...(r.party ? { party: r.party } : {}), waive: r.waive, note: r.note, decidedBy: r.decided_by ?? "", decidedAt: iso(r.decided_at) });
const toPayment = (r: Row): Payment => ({ id: r.id, clientId: r.client_id, amountPence: r.amount_pence, receivedOn: ymd(r.received_on), method: r.method, note: r.note, recordedBy: r.recorded_by ?? "", createdAt: iso(r.created_at) });
const toRefund = (r: Row): RefundRequest => ({
  id: r.id, clientId: r.client_id, amountPence: r.amount_pence, reason: r.reason, statutory: r.statutory, status: r.status, requestedBy: r.requested_by ?? "", requestedAt: iso(r.requested_at),
  ...(r.first_approved_by ? { firstApprovedBy: r.first_approved_by } : {}), ...(r.decided_by ? { decidedBy: r.decided_by } : {}), ...(r.decided_at ? { decidedAt: iso(r.decided_at) } : {}),
  ...(r.decision_note ? { decisionNote: r.decision_note } : {}),
});
const toAudit = (r: Row): AuditEntry => ({ id: r.id, at: iso(r.at), actorId: r.actor_id, action: r.action, subject: r.subject, detail: r.detail ?? {} });
const toStatement = (r: Row): IssuedStatement => ({
  id: r.id, invoiceNumber: r.invoice_number, issuedOn: ymd(r.issued_on), issuedBy: r.issued_by ?? "", createdAt: iso(r.created_at), clientId: r.client_id, clientName: r.client_name,
  period: r.period, periodStart: ymd(r.period_start), periodEnd: ymd(r.period_end), lines: r.lines, lessonChargesPence: r.lesson_charges_pence,
  missedLessonChargesPence: r.missed_lesson_charges_pence, siblingDiscountPence: r.sibling_discount_pence, siblingDiscountPercent: r.sibling_discount_percent,
  siblingDiscountApplied: r.sibling_discount_applied, totalChargesPence: r.total_charges_pence, paymentsReceivedPence: r.payments_received_pence, paymentIds: r.payment_ids ?? [],
  openingBalancePence: r.opening_balance_pence, closingBalancePence: r.closing_balance_pence, blockers: r.blockers ?? [], company: r.company,
});
const toSettings = (r: Row): BillingSettings => ({
  lateCancelNoticeHours: r.late_cancel_notice_hours, siblingDiscountPercent: r.sibling_discount_percent, repeatLateCancelFeePence: r.repeat_late_cancel_fee_pence ?? null,
  allowanceResetMonths: r.allowance_reset_months ?? null, refundSecondApprovalPence: r.refund_second_approval_pence ?? null,
});

const SETTINGS_COLUMNS: Record<keyof BillingSettings, string> = {
  lateCancelNoticeHours: "late_cancel_notice_hours", siblingDiscountPercent: "sibling_discount_percent", repeatLateCancelFeePence: "repeat_late_cancel_fee_pence",
  allowanceResetMonths: "allowance_reset_months", refundSecondApprovalPence: "refund_second_approval_pence",
};

const REFUND_COLUMNS: Record<string, string> = {
  status: "status", firstApprovedBy: "first_approved_by", decidedBy: "decided_by", decidedAt: "decided_at", decisionNote: "decision_note",
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export function createSqlTuitionBilling(db: SqlExecutor): TuitionBillingRepository {
  const q = <T = Row>(text: string, params?: unknown[]) => db.query<T>(text, params);
  const getSettings = async (): Promise<BillingSettings> => {
    const rows = await q("select * from public.tuition_billing_settings where singleton");
    if (!rows[0]) throw new Error("The billing settings row is missing (migration 0021).");
    return toSettings(rows[0]);
  };
  const getProfile = async (clientId: string): Promise<FamilyBillingProfile> => {
    const rows = isId(clientId) ? await q("select * from public.tuition_family_profiles where client_id = $1", [clientId]) : [];
    const r = rows[0];
    return r ? { clientId, siblingDiscountEligible: r.sibling_discount_eligible, ...(r.updated_by ? { updatedBy: r.updated_by } : {}), updatedAt: iso(r.updated_at) } : { clientId, siblingDiscountEligible: false };
  };

  return {
    settings: {
      get: getSettings,
      async update(patch, actor) {
        const current = await getSettings();
        const next = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as BillingSettings;
        validateSettings(next);
        const keys = Object.keys(SETTINGS_COLUMNS) as Array<keyof BillingSettings>;
        const sets = keys.map((k, i) => `${SETTINGS_COLUMNS[k]} = $${i + 1}`).join(", ");
        await q(`update public.tuition_billing_settings set ${sets}, updated_by = $${keys.length + 1}, updated_at = now() where singleton`, [...keys.map((k) => next[k]), actorId(actor)]);
        return next;
      },
    },
    familyRates: {
      async list(clientId) {
        const rows = clientId && !isId(clientId) ? [] : await q("select * from public.tuition_family_rates where ($1::uuid is null or client_id = $1) order by contract_start, created_at", [clientId ?? null]);
        return rows.map(toFamilyRate);
      },
      async create(input) {
        validateFamilyRate(input);
        if (!isId(input.clientId) || !isId(input.assignmentId)) throw new BillingError("INVALID", "The family or the assignment is not recognised.");
        const existing = await q("select contract_start, contract_end from public.tuition_family_rates where client_id = $1 and assignment_id = $2", [input.clientId, input.assignmentId]);
        if (existing.some((r) => rangesOverlap(ymd(r.contract_start), ymd(r.contract_end), input.contractStart, input.contractEnd))) {
          throw new BillingError("RATE_LOCKED", "This family already has an agreed rate for these lessons that covers some of those dates. The rate is fixed for the contract year.");
        }
        const [row] = await q("insert into public.tuition_family_rates (client_id, assignment_id, hourly_pence, contract_start, contract_end, created_by) values ($1, $2, $3, $4, $5, $6) returning *", [input.clientId, input.assignmentId, input.hourlyPence, input.contractStart, input.contractEnd, actorId(input.createdBy)]);
        return toFamilyRate(row!);
      },
    },
    tutorRates: {
      async list(tutorId) {
        const rows = tutorId && !isId(tutorId) ? [] : await q("select * from public.tuition_tutor_rates where ($1::uuid is null or tutor_id = $1) order by effective_from, created_at", [tutorId ?? null]);
        return rows.map(toTutorRate);
      },
      async create(input) {
        validateTutorRate(input);
        if (!isId(input.tutorId)) throw new BillingError("INVALID", "The tutor is not recognised.");
        const [row] = await q("insert into public.tuition_tutor_rates (tutor_id, hourly_pence, effective_from, created_by) values ($1, $2, $3, $4) returning *", [input.tutorId, input.hourlyPence, input.effectiveFrom, actorId(input.createdBy)]);
        return toTutorRate(row!);
      },
    },
    profiles: {
      get: getProfile,
      async setSiblingEligible(clientId, eligible, actor) {
        if (!isId(clientId)) throw new BillingError("NOT_FOUND", "There is no such family.");
        await q("insert into public.tuition_family_profiles (client_id, sibling_discount_eligible, updated_by) values ($1, $2, $3) on conflict (client_id) do update set sibling_discount_eligible = $2, updated_by = $3, updated_at = now()", [clientId, eligible, actorId(actor)]);
        return getProfile(clientId);
      },
      async list() {
        const rows = await q("select * from public.tuition_family_profiles order by client_id");
        return rows.map((r) => ({ clientId: r.client_id, siblingDiscountEligible: r.sibling_discount_eligible, ...(r.updated_by ? { updatedBy: r.updated_by } : {}), updatedAt: iso(r.updated_at) }));
      },
    },
    decisions: {
      async list(lessonIds) {
        if (lessonIds && lessonIds.length === 0) return [];
        const ids = lessonIds?.filter(isId);
        const rows = ids ? await q("select * from public.tuition_charge_decisions where lesson_id = any($1::uuid[])", [ids]) : await q("select * from public.tuition_charge_decisions");
        return rows.map(toDecision);
      },
      async upsert(decision) {
        validateDecision(decision);
        if (!isId(decision.lessonId)) throw new BillingError("NOT_FOUND", "There is no such lesson.");
        const [row] = await q(
          `insert into public.tuition_charge_decisions (lesson_id, party, waive, note, decided_by) values ($1, $2, $3, $4, $5)
           on conflict (lesson_id) do update set party = $2, waive = $3, note = $4, decided_by = $5, decided_at = now() returning *`,
          [decision.lessonId, decision.party ?? null, decision.waive, decision.note.trim(), actorId(decision.decidedBy)],
        );
        return toDecision(row!);
      },
    },
    statements: {
      async list(clientId) {
        const rows = clientId && !isId(clientId) ? [] : await q("select * from public.tuition_statements where ($1::uuid is null or client_id = $1) order by period, created_at", [clientId ?? null]);
        return rows.map(toStatement);
      },
      async get(clientId, period) {
        const rows = isId(clientId) ? await q("select * from public.tuition_statements where client_id = $1 and period = $2", [clientId, period]) : [];
        return rows[0] ? toStatement(rows[0]) : null;
      },
      async getById(id) {
        const rows = isId(id) ? await q("select * from public.tuition_statements where id = $1", [id]) : [];
        return rows[0] ? toStatement(rows[0]) : null;
      },
      async issue(draft, issuedBy, issuedOn) {
        if (!isId(draft.clientId)) throw new BillingError("NOT_FOUND", "There is no such family.");
        const [{ n }] = (await q("select nextval('public.tuition_invoice_seq')::int as n")) as Array<{ n: number }>;
        const invoiceNumber = `LT-${draft.period.replace("-", "")}-${String(n).padStart(4, "0")}`;
        try {
          const [row] = await q(
            `insert into public.tuition_statements (client_id, period, invoice_number, issued_on, issued_by, client_name, period_start, period_end, lines, lesson_charges_pence,
               missed_lesson_charges_pence, sibling_discount_pence, sibling_discount_percent, sibling_discount_applied, total_charges_pence, payments_received_pence, payment_ids,
               opening_balance_pence, closing_balance_pence, blockers, company)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::jsonb, $10, $11, $12, $13, $14, $15, $16, $17::text::jsonb, $18, $19, $20::text[], $21::text::jsonb) returning *`,
            [draft.clientId, draft.period, invoiceNumber, issuedOn, actorId(issuedBy), draft.clientName, draft.periodStart, draft.periodEnd, JSON.stringify(draft.lines), draft.lessonChargesPence,
              draft.missedLessonChargesPence, draft.siblingDiscountPence, draft.siblingDiscountPercent, draft.siblingDiscountApplied, draft.totalChargesPence, draft.paymentsReceivedPence,
              JSON.stringify(draft.paymentIds), draft.openingBalancePence, draft.closingBalancePence, draft.blockers, JSON.stringify(draft.company)],
          );
          return toStatement(row!);
        } catch (error) {
          if (isUniqueViolation(error)) throw new BillingError("ALREADY_ISSUED", "A statement for this family and month has already been issued.");
          throw error;
        }
      },
    },
    payments: {
      async list(clientId) {
        const rows = clientId && !isId(clientId) ? [] : await q("select * from public.tuition_payments where voided_at is null and ($1::uuid is null or client_id = $1) order by received_on, created_at", [clientId ?? null]);
        return rows.map(toPayment);
      },
      async record(input) {
        validatePayment(input);
        if (!isId(input.clientId)) throw new BillingError("NOT_FOUND", "There is no such family.");
        const [row] = await q("insert into public.tuition_payments (client_id, amount_pence, received_on, method, note, recorded_by) values ($1, $2, $3, $4, $5, $6) returning *", [input.clientId, input.amountPence, input.receivedOn, input.method.trim(), input.note.trim(), actorId(input.recordedBy)]);
        return toPayment(row!);
      },
      async void(id, reason, actor) {
        if (reason.trim().length < 3) throw new BillingError("INVALID", "Say why the payment is being voided.");
        const changed = isId(id) ? await q("update public.tuition_payments set voided_at = now(), voided_by = $2, void_reason = $3 where id = $1 and voided_at is null returning id", [id, actorId(actor), reason.trim()]) : [];
        if (changed.length === 0) throw new BillingError("NOT_FOUND", "There is no such payment.");
      },
    },
    refunds: {
      async list(clientId) {
        const rows = clientId && !isId(clientId) ? [] : await q("select * from public.tuition_refunds where ($1::uuid is null or client_id = $1) order by requested_at desc", [clientId ?? null]);
        return rows.map(toRefund);
      },
      async get(id) {
        const rows = isId(id) ? await q("select * from public.tuition_refunds where id = $1", [id]) : [];
        return rows[0] ? toRefund(rows[0]) : null;
      },
      async request(input) {
        validateRefundRequest(input);
        if (!isId(input.clientId)) throw new BillingError("NOT_FOUND", "There is no such family.");
        const [row] = await q("insert into public.tuition_refunds (client_id, amount_pence, reason, statutory, requested_by) values ($1, $2, $3, $4, $5) returning *", [input.clientId, input.amountPence, input.reason.trim(), input.statutory, actorId(input.requestedBy)]);
        return toRefund(row!);
      },
      async update(id, patch) {
        const sets: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(patch)) {
          const column = REFUND_COLUMNS[key];
          if (!column || value === undefined) continue;
          values.push(key === "firstApprovedBy" || key === "decidedBy" ? actorId(String(value)) : value);
          sets.push(`${column} = $${values.length + 1}`);
        }
        const rows = isId(id) ? (sets.length ? await q(`update public.tuition_refunds set ${sets.join(", ")} where id = $1 returning *`, [id, ...values]) : await q("select * from public.tuition_refunds where id = $1", [id])) : [];
        if (!rows[0]) throw new BillingError("NOT_FOUND", "There is no such refund request.");
        return toRefund(rows[0]);
      },
    },
    audit: {
      async append(entry) {
        const [row] = await q("insert into public.tuition_billing_audit (actor_id, action, subject, detail) values ($1, $2, $3, $4::text::jsonb) returning *", [entry.actorId.slice(0, 100), entry.action.slice(0, 60), entry.subject.slice(0, 200), JSON.stringify(entry.detail ?? {})]);
        return toAudit(row!);
      },
      async recent(limit) {
        return (await q("select * from public.tuition_billing_audit order by at desc limit $1", [Math.max(1, Math.min(500, limit))])).map(toAudit);
      },
    },
  };
}
