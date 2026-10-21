import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// apps/web/src/lib/dev/localSupabase.ts: how the dev server points itself at the local Supabase stack, and every case where it must not.

const { applyLocalSupabaseEnv } = loadTsFrom(import.meta.url, "../src/lib/dev/localSupabase.ts");

const LOCAL = { API_URL: "http://127.0.0.1:54321", DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres", PUBLISHABLE_KEY: "sb_publishable_localtestvalue", SECRET_KEY: "sb_secret_localtestvalue" };
const never = () => assert.fail("the stack status must not even be read");

test("it does nothing unless asked: no switch, no status read, no change", () => {
  const env = {};
  assert.deepEqual(applyLocalSupabaseEnv(env, never), { applied: false, message: "" });
  assert.deepEqual(env, {});
  assert.equal(applyLocalSupabaseEnv({ LEARNTHRIVE_SUPABASE_USE: "0" }, never).applied, false);
  assert.equal(applyLocalSupabaseEnv({ LEARNTHRIVE_SUPABASE_USE: "true" }, never).applied, false, "only exactly 1");
});

test("it never runs in production, even if asked", () => {
  const env = { NODE_ENV: "production", LEARNTHRIVE_SUPABASE_USE: "1" };
  assert.deepEqual(applyLocalSupabaseEnv(env, never), { applied: false, message: "" });
  assert.equal(env.SUPABASE_URL, undefined);
});

test("asked for, with the local stack up, it sets the four settings from the stack's own status", () => {
  const env = { LEARNTHRIVE_SUPABASE_USE: "1" };
  const result = applyLocalSupabaseEnv(env, () => LOCAL);
  assert.equal(result.applied, true);
  assert.equal(env.SUPABASE_URL, LOCAL.API_URL);
  assert.equal(env.SUPABASE_ANON_KEY, LOCAL.PUBLISHABLE_KEY);
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, LOCAL.SECRET_KEY);
  assert.equal(env.DATABASE_URL, LOCAL.DB_URL);
  assert.match(result.message, /LOCAL Supabase stack/);
  assert.ok(!result.message.includes("sb_") && !result.message.includes("postgres:"), "the message shows no key or connection string");
});

test("it leaves settings already in the environment alone, whatever they are", () => {
  for (const key of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "DATABASE_URL"]) {
    const env = { LEARNTHRIVE_SUPABASE_USE: "1", [key]: "already-set" };
    const result = applyLocalSupabaseEnv(env, never);
    assert.equal(result.applied, false, key);
    assert.match(result.message, /already in the environment/);
    assert.equal(env[key], "already-set");
  }
});

test("a stack that is not running, or not local, or incomplete, is not used, and nothing is set", () => {
  const cases = {
    "not running": () => null,
    "no API address": () => ({ ...LOCAL, API_URL: undefined }),
    "a hosted API address": () => ({ ...LOCAL, API_URL: "https://abcdefghijklmnopqrst.supabase.co" }),
    "a hosted database": () => ({ ...LOCAL, DB_URL: "postgresql://postgres:x@db.abcdefghijklmnopqrst.supabase.co:5432/postgres" }),
    "look-alike host": () => ({ ...LOCAL, API_URL: "http://localhost.evil.example:54321" }),
    "no keys": () => ({ API_URL: LOCAL.API_URL, DB_URL: LOCAL.DB_URL }),
    "garbage": () => ({ API_URL: "not a url", DB_URL: "nope" }),
  };
  for (const [name, status] of Object.entries(cases)) {
    const env = { LEARNTHRIVE_SUPABASE_USE: "1" };
    const result = applyLocalSupabaseEnv(env, status);
    assert.equal(result.applied, false, name);
    assert.deepEqual(Object.keys(env), ["LEARNTHRIVE_SUPABASE_USE"], `${name}: nothing was set`);
  }
});
