import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// supabase-smoke must reach its cleanup however a run goes wrong. On 9 Nov 2026 an error escaped from inside the database driver as an
// unhandled rejection, Node stopped mid-run, and the hosted project kept the run's test login. This injects a stray rejection of the
// same kind (on the run's first network call, after the script has started) and checks the run still finishes: the stray error is a
// FAIL, the cleanup block and the summary are reached, and the exit code says it failed. Nothing listens on the ports used, so nothing
// is written anywhere.

const WEB = fileURLToPath(new URL("..", import.meta.url));
const STRAY = `data:text/javascript,${encodeURIComponent(`
  const realFetch = globalThis.fetch;
  let fired = false;
  globalThis.fetch = (...args) => {
    if (!fired) { fired = true; Promise.reject(new Error("stray driver error")); }
    return realFetch(...args);
  };
`)}`;

test("a rejection nobody awaits is reported as a failure and the run still reaches its cleanup and summary", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "--import", STRAY, "scripts/supabase-smoke.mjs"], {
    cwd: WEB,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      SUPABASE_URL: "http://127.0.0.1:9",
      SUPABASE_ANON_KEY: "not-a-real-key",
      SUPABASE_SERVICE_ROLE_KEY: "not-a-real-secret",
      DATABASE_URL: "postgresql://nobody:nothing@127.0.0.1:9/postgres",
    },
  });
  const output = r.stdout + r.stderr;
  assert.match(r.stdout, /^FAIL {2}an error outside any step {2}\(stray driver error\)$/m, output);
  assert.match(r.stdout, /\n\d+ of \d+ steps passed, \d+ FAILED\.\n/, `the run reached its summary, after the cleanup block:\n${output}`);
  assert.ok(!/triggerUncaughtException|Unhandled|ERR_UNHANDLED_REJECTION/.test(r.stderr), `Node did not stop on the rejection:\n${r.stderr}`);
  assert.equal(r.status, 1);
});
