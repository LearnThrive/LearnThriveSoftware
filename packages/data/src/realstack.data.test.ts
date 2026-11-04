// The tuition domain provider's contract (lessons, assignments, attendance, reports, availability, notifications, settings: the same
// one the in-memory provider and PGlite pass) against the REAL local Postgres, through the production connection code
// (apps/web/src/lib/db.ts: the `postgres` driver, prepare: false), three ways: directly, through the transaction pooler as
// production does, and as the narrow `learnthrive_server` role the site is meant to connect as.
//
// Why it matters beyond PGlite: the tuition tables (migration 0011) hold arrays (subjects, tags), `time` columns (availability),
// `timestamptz` round trips and a bigint identity; the pooler runs every statement on its own connection; and PGlite's harness
// connection is a superuser, so a table or sequence the narrow role cannot reach can only show up here.
//
// Profiles are made through the real Auth service. Skipped unless SUPABASE_LOCAL=1 and SUPABASE_LOCAL_SERIAL=1, i.e. by
//   npm run test:realstack
import { createExecutor } from "../../../apps/web/src/lib/db";
import { SqlLibraryStore } from "./library";
import { createSqlDataProvider } from "./sqlProvider";
import { dataProviderContract } from "./testing/dataProviderContract";
import { ensureServerRole, ensurePlatformSettings, newUser, openDb, poolerUrl, stack } from "./testing/realstack";

// SUPABASE_LOCAL_SERIAL is set only by `npm run test:realstack`, which runs the real-stack files one at a time.
if (process.env.SUPABASE_LOCAL === "1" && process.env.SUPABASE_LOCAL_SERIAL === "1") {
  for (const via of ["direct", "pooler", "the narrow server role, direct"] as const) {
    dataProviderContract(`sql on the real local stack, ${via}`, async () => {
      const s = stack();
      const admin = openDb(s);
      // The single settings row the migrations seed: another real-stack file may have emptied the tables since.
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
          provider: createSqlDataProvider(executor),
          derivesFamilies: true,
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
