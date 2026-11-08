// The tuition billing contract (launch checklist 3.10, migration 0021: the same one memory and PGlite pass) against the REAL local
// Postgres, through the production connection code (apps/web/src/lib/db.ts: the `postgres` driver, prepare: false), three ways: directly,
// through the transaction pooler as production does, and as the narrow `learnthrive_server` role the site connects as.
//
// Why it matters beyond PGlite: PGlite's harness connection is a superuser and does not go through the `postgres` driver, so a table or
// the invoice sequence the narrow role cannot reach, or a JSON column the driver stores as a string (the careers finding), shows up only
// here. The contract runs the billing service end to end on real lessons, so a whole statement, balance and refund round trip is covered.
//
// Profiles are made through the real Auth service. Skipped unless SUPABASE_LOCAL=1 and SUPABASE_LOCAL_SERIAL=1, i.e. by
//   npm run test:realstack
import { createExecutor } from "../../../apps/web/src/lib/db";
import { SqlLibraryStore } from "./library";
import { createSqlDataProvider } from "./sqlProvider";
import { ensureServerRole, ensurePlatformSettings, newUser, openDb, poolerUrl, stack } from "./testing/realstack";
import { tuitionBillingContract } from "./testing/tuitionBillingContract";
import { createSqlTuitionBilling } from "./tuitionBilling";

if (process.env.SUPABASE_LOCAL === "1" && process.env.SUPABASE_LOCAL_SERIAL === "1") {
  for (const via of ["direct", "pooler", "the narrow server role, direct"] as const) {
    tuitionBillingContract(`sql on the real local stack, ${via}`, async () => {
      const s = stack();
      const admin = openDb(s);
      // The seeded singletons (platform and billing settings): another real-stack file may have emptied the tables since.
      await ensurePlatformSettings(admin);
      const url = via === "direct" ? s.dbUrl : via === "pooler" ? poolerUrl(s) : ensureServerRole(s).directUrl;
      const { executor, close } = await createExecutor(url);
      const store = new SqlLibraryStore(executor);
      return {
        close: async () => {
          await close();
          await admin.end({ timeout: 5 });
        },
        harness: {
          repo: createSqlTuitionBilling(executor),
          provider: createSqlDataProvider(executor),
          family: async (name = "Family") => {
            const user = await newUser(s, { name });
            return { clientId: await store.accounts.ensureClient(user.id), userId: user.id };
          },
          login: async () => (await newUser(s, { name: "Login" })).id,
        },
      };
    });
  }
}
