import { SqlLibraryStore } from "./library";
import { accountContract } from "./testing/accountContract";
import { createTestDb } from "./testing/pglite";

accountContract("sql on PGlite", async () => {
  const db = await createTestDb();
  const owner = <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params));
  const store = new SqlLibraryStore({ query: (sql, params) => owner(sql, params) });
  return {
    close: () => db.close(),
    harness: {
      store,
      login: async () => db.createUser({ adult: false }),
      tutor: async (active = true) => (await owner<{ id: string }>("insert into public.tutors (display_name, active) values ('Tutor', $1) returning id", [active]))[0]!.id,
      family: async () => {
        const guardian = await db.createUser({ adult: true });
        const clientId = await store.accounts.ensureClient(guardian);
        const studentId = (await owner<{ id: string }>("insert into public.students (client_id, display_name) values ($1, 'Kid') returning id", [clientId]))[0]!.id;
        return { guardian, clientId, studentId };
      },
      auditRows: async (action, actor) =>
        (await owner<{ client_id: string | null; student_id: string | null }>("select client_id, student_id from public.identity_audit where action = $1 and actor_profile_id = $2", [action, actor]))
          .map((row) => ({ clientId: row.client_id, studentId: row.student_id })),
    },
  };
});
