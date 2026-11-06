import { createSqlCareersStore } from "./careers";
import { careersContract } from "./testing/careersContract";
import { createTestDb } from "./testing/pglite";

careersContract("sql on PGlite", async () => {
  const db = await createTestDb();
  const executor = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params)) };
  return {
    close: () => db.close(),
    harness: { store: createSqlCareersStore(executor), admin: () => db.createUser({ displayName: "Admin", adult: true }) },
  };
});
