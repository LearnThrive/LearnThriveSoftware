import type { SqlExecutor } from "@learnthrive/data/library";

/**
 * The server's Postgres connection, as the two-line SqlExecutor the stores need. Created on first use and never at
 * import, so a build needs no database. `prepare: false` because Supabase's pooler (transaction mode) does not keep
 * prepared statements between queries. `max_pipeline: 0` because the same pooler loses pipelined queries: when every
 * connection is busy, the driver by default writes the next query down a busy connection before the last one has answered,
 * and through Supavisor in transaction mode that query's answer never arrives, so the request hangs for good. Measured on the
 * local stack (Supavisor 2.9.13): more queries at once than `max` hung within a few rounds; with pipelining off, 30 at once
 * ran 40 rounds clean. A query now waits for a free connection instead. Server only, and the import tool: the URL is a
 * secret and bypasses RLS.
 */
export async function createExecutor(url: string): Promise<{ executor: SqlExecutor; close: () => Promise<void> }> {
  const { default: postgres } = await import("postgres");
  // `max_pipeline` is a real option of postgres 3.4 (src/connection.js) that its type definitions leave out, so the options are
  // passed as a variable rather than a literal. packages/data/src/realstack.pool.test.ts proves it takes effect.
  const options = { max: 5, max_pipeline: 0, idle_timeout: 20, connect_timeout: 10, prepare: false, onnotice: () => {} };
  const sql = postgres(url, options);
  return {
    executor: { query: async <T,>(text: string, params?: unknown[]) => (await sql.unsafe(text, params as never[])) as unknown as T[] },
    close: () => sql.end({ timeout: 5 }),
  };
}
