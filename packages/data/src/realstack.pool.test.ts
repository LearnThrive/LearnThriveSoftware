// The production connection code (apps/web/src/lib/db.ts) through the REAL local transaction pooler (Supavisor, as on the hosted
// project's port 6543) with more queries at once than the pool has connections. The driver's default is to pipeline a query down a busy
// connection, and through Supavisor in transaction mode that query never answers: found by the tuition billing contract, whose statement
// preview runs six queries at once on a pool of five, and which hung for good. db.ts turns pipelining off (`max_pipeline: 0`); this
// fails, rather than hangs, if that ever goes away.
//
// Skipped unless SUPABASE_LOCAL=1 and SUPABASE_LOCAL_SERIAL=1, i.e. by
//   npm run test:realstack
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createExecutor } from "../../../apps/web/src/lib/db";
import { poolerUrl, stack } from "./testing/realstack";

const ENABLED = process.env.SUPABASE_LOCAL === "1" && process.env.SUPABASE_LOCAL_SERIAL === "1";

describe("the production connection through the transaction pooler", { skip: ENABLED ? false : "run by npm run test:realstack" }, () => {
  test("more queries at once than the pool holds all answer, round after round", async () => {
    const { executor, close } = await createExecutor(poolerUrl(stack()));
    // A lost query never settles, and an open connection keeps the process alive past node:test's own timeout, so the test keeps its
    // own clock and closes the pool (which ends the stuck connections) when it runs out.
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("a query through the pooler never answered (pipelining is back on?)")), 30_000);
    });
    try {
      for (let round = 1; round <= 20; round++) {
        const answers = await Promise.race([
          Promise.all(
            Array.from({ length: 30 }, (_, i) =>
              i % 2 ? executor.query<{ one: number }>("select 1 as one") : executor.query<{ i: number }>("select $1::int as i", [i])),
          ),
          deadline,
        ]);
        assert.equal(answers.length, 30, `round ${round}`);
        assert.equal((answers[4] as Array<{ i: number }>)[0]?.i, 4, `round ${round}`);
      }
    } finally {
      clearTimeout(timer);
      await close();
    }
  });
});
