import { randomBytes } from "node:crypto";
import { SqlLibraryStore } from "./library";
import { identityContract } from "./testing/identityContract";
import { createTestDb } from "./testing/pglite";

identityContract("sql on PGlite", async () => {
  const db = await createTestDb();
  const owner = <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params));
  const store = new SqlLibraryStore({ query: (sql, params) => owner(sql, params) });
  let tutorId: string | null = null;
  const hex = (n: number) => randomBytes(n).toString("hex");
  return {
    close: () => db.close(),
    harness: {
      store,
      profile: async (o) => db.createUser({ adult: o?.adult ?? true, role: o?.role, email: o?.email }),
      student: async (profileId, o) => {
        const clientId = await store.accounts.ensureClient(profileId);
        return (await owner<{ id: string }>("insert into public.students (client_id, display_name, year_group, is_minor) values ($1, $2, $3, $4) returning id", [clientId, o?.displayName ?? "Student", o?.yearGroup ?? null, o?.isMinor ?? true]))[0]!.id;
      },
      guardianLink: async (studentId, profileId, status = "active") => {
        const clientId = await store.accounts.ensureClient(profileId);
        await owner("insert into public.client_students (client_id, student_id, status) values ($1, $2, $3) on conflict (client_id, student_id) do update set status = excluded.status", [clientId, studentId, status]);
      },
      assignment: async (studentId, status = "ACTIVE") => {
        if (!tutorId) {
          const tutorUser = await db.createUser({ displayName: "Tutor", adult: true, role: "TUTOR" });
          tutorId = (await owner<{ id: string }>("insert into public.tutors (profile_id, display_name) values ($1, 'Tutor') returning id", [tutorUser]))[0]!.id;
        }
        const id = (await owner<{ id: string }>("insert into public.tuition_assignments (title, subject, tutor_id, status) values ('Maths', 'Maths', $1, $2) returning id", [tutorId, status]))[0]!.id;
        await owner("insert into public.assignment_students (assignment_id, student_id) values ($1, $2)", [id, studentId]);
        return id;
      },
      setAssignment: async (id, status) => void (await owner("update public.tuition_assignments set status = $2 where id = $1", [id, status])),
      entitlement: async (profileId, source, startsAt, endsAt) => {
        const clientId = await store.accounts.ensureClient(profileId);
        if (source === "subscription") {
          const sub = (await owner<{ id: string }>("insert into public.subscriptions (client_id, stripe_subscription_id, stripe_price_id, status, plan_interval) values ($1, $2, 'price_test', 'active', 'month') returning id", [clientId, `sub_${hex(8)}`]))[0]!.id;
          await owner("insert into public.entitlements (client_id, source, subscription_id, starts_at, ends_at) values ($1,'subscription',$2,$3,$4)", [clientId, sub, startsAt, endsAt]);
        } else {
          const grant = (await owner<{ id: string }>("insert into public.admin_grants (client_id, reason, starts_at) values ($1, 'test', $2) returning id", [clientId, startsAt]))[0]!.id;
          await owner("insert into public.entitlements (client_id, source, admin_grant_id, starts_at, ends_at) values ($1,'admin_grant',$2,$3,$4)", [clientId, grant, startsAt, endsAt]);
        }
      },
    },
  };
});
