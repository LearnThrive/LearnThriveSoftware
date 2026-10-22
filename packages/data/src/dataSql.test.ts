import { SqlLibraryStore } from "./library";
import { createSqlDataProvider } from "./sqlProvider";
import { dataProviderContract } from "./testing/dataProviderContract";
import { createTestDb } from "./testing/pglite";

dataProviderContract("sql on PGlite", async () => {
  const db = await createTestDb();
  const executor = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params)) };
  const store = new SqlLibraryStore(executor);
  return {
    close: () => db.close(),
    harness: {
      provider: createSqlDataProvider(executor),
      derivesFamilies: true,
      family: async (name = "Family") => {
        const userId = await db.createUser({ displayName: name, adult: true });
        return { clientId: await store.accounts.ensureClient(userId), userId };
      },
      login: async () => db.createUser({ displayName: "Login", adult: true }),
    },
  };
});
