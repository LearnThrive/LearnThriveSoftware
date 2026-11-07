// The learner-identity contract (the same one the in-memory store and PGlite pass) against the REAL local Postgres, through the
// production connection code (apps/web/src/lib/db.ts: the `postgres` driver, prepare: false), three ways: directly, through the
// transaction pooler as production does, and as the narrow `learnthrive_server` role the site is meant to connect as.
//
// Why it matters beyond PGlite: the invitation create and accept are SECURITY DEFINER functions (migration 0010) that the narrow
// role has to be granted, PGlite's harness connection is a superuser (so it can never show a missing grant), and the accept race
// relies on real row locks in real Postgres rather than PGlite's single in-process connection.
//
// Profiles are made through the real Auth service. Skipped unless SUPABASE_LOCAL=1 and SUPABASE_LOCAL_SERIAL=1, i.e. by
//   npm run test:realstack
import { createExecutor } from "../../../apps/web/src/lib/db";
import { SqlLibraryStore } from "./library";
import { identityContract } from "./testing/identityContract";
import { ensureServerRole, newUser, openDb, poolerUrl, stack } from "./testing/realstack";

// SUPABASE_LOCAL_SERIAL is set only by `npm run test:realstack`, which runs the real-stack files one at a time.
if (process.env.SUPABASE_LOCAL === "1" && process.env.SUPABASE_LOCAL_SERIAL === "1") {
  for (const via of ["direct", "pooler", "the narrow server role, direct"] as const) {
    identityContract(`sql on the real local stack, ${via}`, async () => {
      const s = stack();
      const admin = openDb(s);
      const url = via === "direct" ? s.dbUrl : via === "pooler" ? poolerUrl(s) : ensureServerRole(s).directUrl;
      const { executor, close } = await createExecutor(url);
      const owner = async <T = Record<string, any>>(text: string, params?: unknown[]) => executor.query<T>(text, params);
      const store = new SqlLibraryStore(executor);
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
            // The contract uses a few fixed addresses; a user left over from an earlier run (direct, then pooler, then the role) is removed first.
            if (o?.email) await admin`delete from auth.users where email = ${o.email}`;
            const user = await newUser(s, { name: "Person", adult: o?.adult ?? true, email: o?.email });
            if (o?.role) await owner("update public.profiles set role = $1 where id = $2", [o.role, user.id]);
            return user.id;
          },
          student: async (profileId, o) => {
            const clientId = await store.accounts.ensureClient(profileId);
            return (
              await owner<{ id: string }>("insert into public.students (client_id, display_name, year_group, is_minor) values ($1, $2, $3, $4) returning id", [
                clientId,
                o?.displayName ?? "Student",
                o?.yearGroup ?? null,
                o?.isMinor ?? true,
              ])
            )[0]!.id;
          },
          guardianLink: async (studentId, profileId, status = "active") => {
            const clientId = await store.accounts.ensureClient(profileId);
            await owner("insert into public.client_students (client_id, student_id, status) values ($1, $2, $3) on conflict (client_id, student_id) do update set status = excluded.status", [
              clientId,
              studentId,
              status,
            ]);
          },
          assignment: async (studentId, status = "ACTIVE") => {
            if (!tutorId) {
              const tutor = await newUser(s, { name: "Tutor" });
              await owner("update public.profiles set role = 'TUTOR' where id = $1", [tutor.id]);
              tutorId = (await owner<{ id: string }>("insert into public.tutors (profile_id, display_name) values ($1, 'Tutor') returning id", [tutor.id]))[0]!.id;
            }
            const id = (await owner<{ id: string }>("insert into public.tuition_assignments (title, subject, tutor_id, status) values ('Maths', 'Maths', $1, $2) returning id", [tutorId, status]))[0]!.id;
            await owner("insert into public.assignment_students (assignment_id, student_id) values ($1, $2)", [id, studentId]);
            return id;
          },
          setAssignment: async (id, status) => void (await owner("update public.tuition_assignments set status = $2 where id = $1", [id, status])),
          entitlement: async (profileId, source, startsAt, endsAt) => {
            const clientId = await store.accounts.ensureClient(profileId);
            if (source === "subscription") {
              const sub = (
                await owner<{ id: string }>(
                  "insert into public.subscriptions (client_id, stripe_subscription_id, stripe_price_id, status, plan_interval) values ($1, $2, 'price_test', 'active', 'month') returning id",
                  [clientId, `sub_${hex()}${hex()}`],
                )
              )[0]!.id;
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
