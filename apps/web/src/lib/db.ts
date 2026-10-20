import type { SqlExecutor } from "@learnthrive/data/library";

/**
 * The server's Postgres connection, as the two-line SqlExecutor the stores need. Created on first use and never at
 * import, so a build needs no database. `prepare: false` because Supabase's pooler (transaction mode) does not keep
 * prepared statements between queries. Server only, and the import tool: the URL is a secret and bypasses RLS.
 */
export async function createExecutor(url: string): Promise<{ executor: SqlExecutor; close: () => Promise<void> }> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, { max: 5, idle_timeout: 20, connect_timeout: 10, prepare: false, onnotice: () => {} });
  return {
    executor: { query: async <T,>(text: string, params?: unknown[]) => (await sql.unsafe(text, params as never[])) as unknown as T[] },
    close: () => sql.end({ timeout: 5 }),
  };
}
