// The Library store's behavioural contract (the same one the in-memory store and PGlite pass) against the REAL local Postgres, through
// the production connection code (apps/web/src/lib/db.ts: the `postgres` driver, prepare: false), twice: directly, and through the
// transaction pooler as production does. Profiles are made through the real Auth service. Skipped unless SUPABASE_LOCAL=1.
// This is the check the docs listed as "not tested against a real server": arrays, timestamps, bigint, JSON and the pooler.
//
// It EMPTIES the local public tables first (the contract assumes a fresh database), so run the real-stack files one at a time:
//   npm run test:realstack   (it sets SUPABASE_LOCAL=1 and SUPABASE_LOCAL_SERIAL=1)
import { createExecutor } from "../../../apps/web/src/lib/db";
import { SqlLibraryStore } from "./library";
import { libraryContract } from "./testing/libraryContract";
import { ensureServerRole, newUser, openDb, poolerUrl, resetPublicData, stack } from "./testing/realstack";

// SUPABASE_LOCAL_SERIAL is set only by `npm run test:realstack`, which runs the real-stack files one at a time.
if (process.env.SUPABASE_LOCAL === "1" && process.env.SUPABASE_LOCAL_SERIAL === "1") {
  // As the postgres role directly and through the pooler, and as the narrow learnthrive_server role the site is meant to use.
  for (const via of ["direct", "pooler", "the narrow server role, direct"] as const) {
    libraryContract(`sql on the real local stack, ${via}`, async () => {
      const s = stack();
      const admin = openDb(s);
      await resetPublicData(admin);
      const url = via === "direct" ? s.dbUrl : via === "pooler" ? poolerUrl(s) : ensureServerRole(s).directUrl;
      const { executor, close } = await createExecutor(url);
      const owner = async <T = Record<string, any>>(text: string, params?: unknown[]) => executor.query<T>(text, params);
      const store = new SqlLibraryStore(executor);
      const made: string[] = [];
      let tutorId: string | null = null;
      const hex = () => Math.random().toString(16).slice(2, 10);
      return {
        close: async () => {
          await close();
          await admin.end({ timeout: 5 });
        },
        harness: {
          store,
          profile: async (o) => {
            // The contract uses one fixed address; a user left over from the other run (direct, then pooler) is removed first.
            if (o?.email) await admin`delete from auth.users where email = ${o.email}`;
            const user = await newUser(s, { name: "Person", adult: o?.adult ?? true, email: o?.email });
            made.push(user.id);
            if (o?.role) await owner("update public.profiles set role = $1 where id = $2", [o.role, user.id]);
            return user.id;
          },
          student: async (profileId) => {
            const clientId = await store.accounts.ensureClient(profileId);
            return (await owner<{ id: string }>("insert into public.students (client_id, display_name) values ($1, 'Student') returning id", [clientId]))[0]!.id;
          },
          assignment: async (studentId, status = "ACTIVE") => {
            if (!tutorId) {
              const tutor = await newUser(s, { name: "Tutor" });
              made.push(tutor.id);
              await owner("update public.profiles set role = 'TUTOR' where id = $1", [tutor.id]);
              tutorId = (await owner<{ id: string }>("insert into public.tutors (profile_id, display_name) values ($1, 'Tutor') returning id", [tutor.id]))[0]!.id;
            }
            const a = (await owner<{ id: string }>("insert into public.tuition_assignments (title, subject, tutor_id, status) values ('Maths', 'Maths', $1, $2) returning id", [tutorId, status]))[0]!.id;
            await owner("insert into public.assignment_students (assignment_id, student_id) values ($1, $2)", [a, studentId]);
          },
          entitlement: async (profileId, source, startsAt, endsAt) => {
            const clientId = await store.accounts.ensureClient(profileId);
            if (source === "subscription") {
              const sub = (await owner<{ id: string }>("insert into public.subscriptions (client_id, stripe_subscription_id, stripe_price_id, status, plan_interval) values ($1, $2, 'price_test', 'active', 'month') returning id", [clientId, `sub_${hex()}${hex()}`]))[0]!.id;
              await owner("insert into public.entitlements (client_id, source, subscription_id, starts_at, ends_at) values ($1,'subscription',$2,$3,$4)", [clientId, sub, startsAt, endsAt]);
            } else {
              const grant = (await owner<{ id: string }>("insert into public.admin_grants (client_id, reason, starts_at) values ($1, 'test', $2) returning id", [clientId, startsAt]))[0]!.id;
              await owner("insert into public.entitlements (client_id, source, admin_grant_id, starts_at, ends_at) values ($1,'admin_grant',$2,$3,$4)", [clientId, grant, startsAt, endsAt]);
            }
          },
        },
      };
    });
  }
}
