import { randomUUID } from "node:crypto";
import { rangesOverlap, validateDecision, validateFamilyRate, validatePayment, validateRefundRequest, validateSettings, validateTutorRate } from "./validate";
import type { TuitionBillingRepository } from "./repository";
import {
  BillingError, DEFAULT_BILLING_SETTINGS, type AuditEntry, type BillingSettings, type ChargeDecision, type FamilyBillingProfile, type FamilyRate, type IssuedStatement,
  type Payment, type RefundRequest, type TutorRate,
} from "./types";

interface StoredPayment extends Payment {
  voidedAt?: string;
}

/** Development and tests: the same behaviour as the Postgres repository, with nothing persisted. */
export function createMemoryTuitionBilling(): TuitionBillingRepository {
  let settings: BillingSettings = { ...DEFAULT_BILLING_SETTINGS };
  const familyRates: FamilyRate[] = [];
  const tutorRates: TutorRate[] = [];
  const profiles = new Map<string, FamilyBillingProfile>();
  const decisions = new Map<string, ChargeDecision>();
  const statements: IssuedStatement[] = [];
  const payments: StoredPayment[] = [];
  const refunds: RefundRequest[] = [];
  const audit: AuditEntry[] = [];
  let invoiceSeq = 0;
  const now = () => new Date().toISOString();
  const strip = (p: StoredPayment): Payment => { const { voidedAt: _voidedAt, ...rest } = p; return rest; };

  return {
    settings: {
      async get() { return { ...settings }; },
      async update(patch) {
        const next = { ...settings, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as BillingSettings;
        validateSettings(next);
        settings = next;
        return { ...settings };
      },
    },
    familyRates: {
      async list(clientId) { return familyRates.filter((r) => !clientId || r.clientId === clientId).sort((a, b) => a.contractStart.localeCompare(b.contractStart)); },
      async create(input) {
        validateFamilyRate(input);
        const clash = familyRates.find((r) => r.clientId === input.clientId && r.assignmentId === input.assignmentId && rangesOverlap(r.contractStart, r.contractEnd, input.contractStart, input.contractEnd));
        if (clash) throw new BillingError("RATE_LOCKED", "This family already has an agreed rate for these lessons that covers some of those dates. The rate is fixed for the contract year.");
        const rate: FamilyRate = { ...input, id: randomUUID(), createdAt: now() };
        familyRates.push(rate);
        return rate;
      },
    },
    tutorRates: {
      async list(tutorId) { return tutorRates.filter((r) => !tutorId || r.tutorId === tutorId).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)); },
      async create(input) {
        validateTutorRate(input);
        const rate: TutorRate = { ...input, id: randomUUID(), createdAt: now() };
        tutorRates.push(rate);
        return rate;
      },
    },
    profiles: {
      async get(clientId) { return profiles.get(clientId) ?? { clientId, siblingDiscountEligible: false }; },
      async setSiblingEligible(clientId, eligible, actor) {
        const profile: FamilyBillingProfile = { clientId, siblingDiscountEligible: eligible, updatedBy: actor, updatedAt: now() };
        profiles.set(clientId, profile);
        return profile;
      },
      async list() { return [...profiles.values()]; },
    },
    decisions: {
      async list(lessonIds) { return [...decisions.values()].filter((d) => !lessonIds || lessonIds.includes(d.lessonId)); },
      async upsert(decision) {
        validateDecision(decision);
        const stored: ChargeDecision = { ...decision, decidedAt: now() };
        decisions.set(decision.lessonId, stored);
        return stored;
      },
    },
    statements: {
      async list(clientId) { return statements.filter((s) => !clientId || s.clientId === clientId).sort((a, b) => a.period.localeCompare(b.period)); },
      async get(clientId, period) { return statements.find((s) => s.clientId === clientId && s.period === period) ?? null; },
      async getById(id) { return statements.find((s) => s.id === id) ?? null; },
      async issue(draft, issuedBy, issuedOn) {
        if (statements.some((s) => s.clientId === draft.clientId && s.period === draft.period)) throw new BillingError("ALREADY_ISSUED", "A statement for this family and month has already been issued.");
        invoiceSeq += 1;
        const statement: IssuedStatement = { ...draft, id: randomUUID(), invoiceNumber: `LT-${draft.period.replace("-", "")}-${String(invoiceSeq).padStart(4, "0")}`, issuedOn, issuedBy, createdAt: now() };
        statements.push(statement);
        return statement;
      },
    },
    payments: {
      async list(clientId) { return payments.filter((p) => !p.voidedAt && (!clientId || p.clientId === clientId)).map(strip).sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.createdAt.localeCompare(b.createdAt)); },
      async record(input) {
        validatePayment(input);
        const payment: StoredPayment = { ...input, id: randomUUID(), createdAt: now() };
        payments.push(payment);
        return strip(payment);
      },
      async void(id, reason) {
        const payment = payments.find((p) => p.id === id && !p.voidedAt);
        if (!payment) throw new BillingError("NOT_FOUND", "There is no such payment.");
        if (reason.trim().length < 3) throw new BillingError("INVALID", "Say why the payment is being voided.");
        payment.voidedAt = now();
      },
    },
    refunds: {
      async list(clientId) { return refunds.filter((r) => !clientId || r.clientId === clientId).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)); },
      async get(id) { return refunds.find((r) => r.id === id) ?? null; },
      async request(input) {
        validateRefundRequest(input);
        const refund: RefundRequest = { ...input, id: randomUUID(), status: "REQUESTED", requestedAt: now() };
        refunds.push(refund);
        return refund;
      },
      async update(id, patch) {
        const i = refunds.findIndex((r) => r.id === id);
        const current = refunds[i];
        if (!current) throw new BillingError("NOT_FOUND", "There is no such refund request.");
        const next = { ...current, ...patch, id: current.id, clientId: current.clientId, amountPence: current.amountPence };
        refunds[i] = next;
        return next;
      },
    },
    audit: {
      async append(entry) { const e: AuditEntry = { ...entry, id: randomUUID(), at: now() }; audit.push(e); return e; },
      async recent(limit) { return [...audit].reverse().slice(0, limit); },
    },
  };
}

let shared: TuitionBillingRepository | undefined;
/** The one in-memory repository the development server shares between requests. */
export function developmentTuitionBilling(): TuitionBillingRepository {
  return (shared ??= createMemoryTuitionBilling());
}
export function resetDevelopmentTuitionBilling(): TuitionBillingRepository {
  return (shared = createMemoryTuitionBilling());
}
