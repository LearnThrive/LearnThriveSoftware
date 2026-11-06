// The careers store's contract (launch checklist 3.12, migration 0020: the same one memory and PGlite pass) against the REAL local
// Postgres, through the production connection code, three ways: directly, through the transaction pooler, and as the narrow
// `learnthrive_server` role. The last is the one that matters: the five careers tables are new, and the site's role reaches a new table
// only after create-server-role.mjs has been run again, so a grant that is missing shows up here and nowhere else.
//
// Administrators are made through the real Auth service. Skipped unless SUPABASE_LOCAL=1 and SUPABASE_LOCAL_SERIAL=1, i.e. by
//   npm run test:realstack
import { createExecutor } from "../../../apps/web/src/lib/db";
import { createSqlCareersStore } from "./careers";
import { careersContract } from "./testing/careersContract";
import { ensureServerRole, newUser, poolerUrl, stack } from "./testing/realstack";

if (process.env.SUPABASE_LOCAL === "1" && process.env.SUPABASE_LOCAL_SERIAL === "1") {
  for (const via of ["direct", "pooler", "the narrow server role, direct"] as const) {
    careersContract(`sql on the real local stack, ${via}`, async () => {
      const s = stack();
      const url = via === "direct" ? s.dbUrl : via === "pooler" ? poolerUrl(s) : ensureServerRole(s).directUrl;
      const { executor, close } = await createExecutor(url);
      return {
        close,
        harness: { store: createSqlCareersStore(executor), admin: async () => (await newUser(s, { name: "Admin" })).id },
      };
    });
  }
}
