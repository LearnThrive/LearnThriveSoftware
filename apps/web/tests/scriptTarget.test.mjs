import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { describeTarget } from "../scripts/_target.mjs";

// The guard that stops a script meant for the local stack from touching a real database (plan20). It looks only at the host.

test("a database is local only when it is on this machine; everything else counts as hosted", () => {
  for (const url of ["postgresql://postgres:x@127.0.0.1:54322/postgres", "postgres://u:p@localhost:5432/db", "postgresql://u:p@[::1]:5432/db", "postgresql://u:p@host.docker.internal:54322/db"]) {
    const t = describeTarget(url);
    assert.equal(t.local, true, url);
    assert.equal(t.hosted, false, url);
  }
  const direct = describeTarget("postgresql://postgres:secret@db.vwsjvdpkgjhwmqmufmrh.supabase.co:5432/postgres");
  assert.equal(direct.local, false);
  assert.equal(direct.hosted, true);
  assert.equal(direct.host, "db.vwsjvdpkgjhwmqmufmrh.supabase.co");
  assert.equal(describeTarget("postgresql://postgres.vwsjvdpkgjhwmqmufmrh:s@aws-0-eu-west-2.pooler.supabase.com:6543/postgres").hosted, true);
  // Not Supabase, not this machine: someone's real database all the same.
  assert.equal(describeTarget("postgresql://u:p@db.example.com:5432/x").hosted, true);
  // A look-alike that merely contains "localhost" is not local.
  assert.equal(describeTarget("postgresql://u:p@localhost.evil.example:5432/x").local, false);
  assert.equal(describeTarget("postgresql://u:p@db.supabase.co.evil.example:5432/x").local, false);
});

test("the description never carries the password", () => {
  const t = describeTarget("postgresql://postgres:hunter2-very-secret@db.abc.supabase.co:5432/postgres");
  assert.equal(JSON.stringify(t).includes("hunter2"), false);
  assert.equal(t.user, "postgres");
});

test("a malformed URL is an error that does not echo it", () => {
  assert.throws(() => describeTarget("not a url with a-password"), (error) => !String(error.message).includes("a-password"));
});

test("refuseUnlessLocal exits non-zero on a hosted host and passes a local one", () => {
  const run = (url) =>
    spawnSync(process.execPath, ["--input-type=module", "-e", `import { refuseUnlessLocal } from "./scripts/_target.mjs"; refuseUnlessLocal(${JSON.stringify(url)}, "wipe the data"); console.log("allowed");`], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  const hosted = run("postgresql://postgres:pw@db.abc.supabase.co:5432/postgres");
  assert.equal(hosted.status, 3);
  assert.match(hosted.stderr, /not this machine/);
  assert.equal(hosted.stderr.includes("pw@"), false, "the URL is not echoed");
  const local = run("postgresql://postgres:pw@127.0.0.1:54322/postgres");
  assert.equal(local.status, 0);
  assert.match(local.stdout, /allowed/);
});
