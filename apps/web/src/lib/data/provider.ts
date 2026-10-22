import type { DataProvider } from "@learnthrive/data/repositories";
import { getDataProvider as developmentProvider } from "@learnthrive/data/inMemoryProvider";
import { createSqlDataProvider } from "@learnthrive/data/sqlProvider";
import { accountBackend, accountRuntime } from "@/lib/account/runtime";

/**
 * Which tuition data the signed-in app runs on (docs/IDENTITY.md, docs/DOMAIN_MODEL.md). One deliberate boundary instead of 37 pages
 * importing the development provider:
 *
 *   supabase  the Postgres provider, on the same connection as the accounts (SUPABASE_URL, SUPABASE_ANON_KEY and DATABASE_URL set)
 *   memory    development and tests only: the seeded in-memory provider
 *   off       production without those settings: a call THROWS. Production never falls back to the in-memory provider or its seed data
 *
 * Synchronous on purpose (every page calls it inline): the SQL provider asks for its connection on first use, not at import, so a build
 * needs no database. Cached on globalThis for the same Fast Refresh reason as the account runtime.
 */
const g = globalThis as unknown as { __learnthriveDomain?: DataProvider };

export function getDataProvider(env: Record<string, string | undefined> = process.env): DataProvider {
  const backend = accountBackend(env);
  if (backend === "off") throw new Error("The tuition data is not available: production needs SUPABASE_URL, SUPABASE_ANON_KEY and DATABASE_URL. It never uses the development data.");
  if (backend === "memory") return developmentProvider();
  return (g.__learnthriveDomain ??= createSqlDataProvider({
    query: async <T,>(text: string, params?: unknown[]) => {
      const rt = await accountRuntime(env);
      if (!rt?.db) throw new Error("The database connection is not available.");
      return rt.db.query<T>(text, params);
    },
  }));
}

/** For tests: forget the cached SQL provider. */
export function resetDomainProvider(): void {
  delete g.__learnthriveDomain;
}
