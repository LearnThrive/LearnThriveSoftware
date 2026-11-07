import { createSqlTuitionBilling, developmentTuitionBilling, parseApprovers, type BillingContext, type TuitionBillingRepository } from "@learnthrive/data/tuitionBilling";
import { accountBackend, accountRuntime } from "@/lib/account/runtime";
import { getDataProvider } from "@/lib/data/provider";
import { siteConfig } from "@/lib/site";

/**
 * The money side of tuition (docs/TUITION_BILLING.md). Same backend choice as the tuition data itself: the Postgres repository on the
 * accounts' connection, the in-memory one in development and tests, and a THROW in production without the database. Admin only, by every
 * caller: nothing a tutor can reach imports this module (tests/tuitionBillingAccess.test.mjs scans for it).
 */
const g = globalThis as unknown as { __learnthriveTuitionBilling?: TuitionBillingRepository };

export function getTuitionBilling(env: Record<string, string | undefined> = process.env): TuitionBillingRepository {
  const backend = accountBackend(env);
  if (backend === "off") throw new Error("Tuition billing is not available: production needs SUPABASE_URL, SUPABASE_ANON_KEY and DATABASE_URL. It never uses the development data.");
  if (backend === "memory") return developmentTuitionBilling();
  return (g.__learnthriveTuitionBilling ??= createSqlTuitionBilling({
    query: async <T,>(text: string, params?: unknown[]) => {
      const rt = await accountRuntime(env);
      if (!rt?.db) throw new Error("The database connection is not available.");
      return rt.db.query<T>(text, params);
    },
  }));
}

/** For tests: forget the cached SQL repository. */
export function resetTuitionBilling(): void {
  delete g.__learnthriveTuitionBilling;
}

export function billingContext(env: Record<string, string | undefined> = process.env): BillingContext {
  return {
    data: getDataProvider(env),
    billing: getTuitionBilling(env),
    company: {
      name: siteConfig.legalName,
      companyNumber: siteConfig.companyNumber,
      registeredOffice: siteConfig.correspondenceAddress,
      email: siteConfig.email,
    },
    approvers: parseApprovers(env.TUITION_REFUND_APPROVER_EMAILS),
  };
}
