import type {
  AuditEntry, BillingSettings, ChargeDecision, FamilyBillingProfile, FamilyRate, IssuedStatement, LessonPrice, Payment, RefundRequest, RepeatingPrice, StatementDraft, TutorRate,
} from "./types";

/**
 * Where the tuition billing records live. Two implementations behind one interface, held to the same behaviour by one contract test
 * (testing/tuitionBillingContract.ts): in memory for development and tests, Postgres for production (migration 0021).
 *
 * Money and the people it concerns are NEVER on the DataProvider the tutor screens use: nothing in apps/web that a tutor can reach imports
 * this (tests/tuitionBillingAccess.test.mjs holds that line).
 */
export interface TuitionBillingRepository {
  settings: {
    get(): Promise<BillingSettings>;
    update(patch: Partial<BillingSettings>, actor: string): Promise<BillingSettings>;
  };
  familyRates: {
    list(clientId?: string): Promise<FamilyRate[]>;
    /** Throws BillingError RATE_LOCKED if the family already has a rate for that assignment that overlaps the contract dates (B3). */
    create(input: Omit<FamilyRate, "id" | "createdAt">): Promise<FamilyRate>;
  };
  tutorRates: {
    list(tutorId?: string): Promise<TutorRate[]>;
    /** Throws BillingError RATE_RANGE outside 5 to 45 pounds an hour (B2). */
    create(input: Omit<TutorRate, "id" | "createdAt">): Promise<TutorRate>;
  };
  profiles: {
    get(clientId: string): Promise<FamilyBillingProfile>;
    setSiblingEligible(clientId: string, eligible: boolean, actor: string): Promise<FamilyBillingProfile>;
    /** Every family with a profile row (so the billing list can show who is eligible). */
    list(): Promise<FamilyBillingProfile[]>;
  };
  /** A price set for one lesson, in place of the hourly rates (migration 0033). One per lesson; setting it again replaces it. */
  lessonPrices: {
    list(lessonIds?: string[]): Promise<LessonPrice[]>;
    set(input: Omit<LessonPrice, "setAt">): Promise<LessonPrice>;
    /** Back to the hourly rates. Nothing happens if the lesson had no price of its own. */
    clear(lessonId: string): Promise<void>;
  };
  /** A price repeated across a class's lessons between two dates (migration 0034). */
  repeatingPrices: {
    list(assignmentIds?: string[]): Promise<RepeatingPrice[]>;
    /** Throws BillingError RATE_LOCKED if the class already has one for any of those days. */
    create(input: Omit<RepeatingPrice, "id" | "setAt">): Promise<RepeatingPrice>;
    /** Nothing happens if there is no such price. */
    remove(id: string): Promise<void>;
  };
  decisions: {
    list(lessonIds?: string[]): Promise<ChargeDecision[]>;
    upsert(decision: Omit<ChargeDecision, "decidedAt">): Promise<ChargeDecision>;
  };
  statements: {
    list(clientId?: string): Promise<IssuedStatement[]>;
    get(clientId: string, period: string): Promise<IssuedStatement | null>;
    getById(id: string): Promise<IssuedStatement | null>;
    /** Issues a statement: freezes it, gives it the next invoice number. Throws ALREADY_ISSUED for a family and month that has one. */
    issue(draft: StatementDraft, issuedBy: string, issuedOn: string): Promise<IssuedStatement>;
  };
  payments: {
    list(clientId?: string): Promise<Payment[]>;
    record(input: Omit<Payment, "id" | "createdAt">): Promise<Payment>;
    /** A mistake is voided with a reason, never edited or deleted: it stays in the audit trail and drops out of the balance. */
    void(id: string, reason: string, actor: string): Promise<void>;
  };
  refunds: {
    list(clientId?: string): Promise<RefundRequest[]>;
    get(id: string): Promise<RefundRequest | null>;
    request(input: Omit<RefundRequest, "id" | "status" | "requestedAt">): Promise<RefundRequest>;
    update(id: string, patch: Partial<RefundRequest>): Promise<RefundRequest>;
  };
  audit: {
    append(entry: Omit<AuditEntry, "id" | "at">): Promise<AuditEntry>;
    recent(limit: number): Promise<AuditEntry[]>;
  };
}
