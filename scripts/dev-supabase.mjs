#!/usr/bin/env node
// `npm run dev:supabase`: the same as `npm run dev` (it starts the model, the voice service and the local Supabase stack), but the site
// itself runs on the local Supabase stack: real accounts, Library and storage. A separate script because setting an environment
// variable in an npm script differs between Windows and Linux. The switch is read by apps/web/src/lib/dev/localSupabase.ts.
import { spawnSync } from "node:child_process";

const run = spawnSync("npm run dev", { shell: true, stdio: "inherit", env: { ...process.env, LEARNTHRIVE_SUPABASE_USE: "1" } });
process.exit(run.status ?? 1);
