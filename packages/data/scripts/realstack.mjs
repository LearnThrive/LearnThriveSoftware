#!/usr/bin/env node
// Runs the tests that need the real local Supabase stack, one file at a time (the store test empties the local tables, so it must
// never run beside the others). Start the stack first: `npm run supabase:start` from the repo root.
import { spawnSync } from "node:child_process";

const run = spawnSync("npx", ["tsx", "--test", "--test-concurrency=1", "src/realstack.test.ts", "src/realstack.store.test.ts", "src/realstack.role.test.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, SUPABASE_LOCAL: "1", SUPABASE_LOCAL_SERIAL: "1" },
});
process.exit(run.status ?? 1);
