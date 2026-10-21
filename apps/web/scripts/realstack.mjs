#!/usr/bin/env node
// Runs the site's tests that need the real local Supabase stack (npm run supabase:start first), one file at a time.
import { spawnSync } from "node:child_process";

const run = spawnSync(process.execPath, ["--test", "--test-concurrency=1", "tests/realstack.app.test.mjs", "tests/realstack.library.test.mjs", "tests/realstack.admin.test.mjs"], {
  stdio: "inherit",
  env: { ...process.env, SUPABASE_LOCAL: "1" },
});
process.exit(run.status ?? 1);
