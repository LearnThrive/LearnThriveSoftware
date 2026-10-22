import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// Which tuition data the signed-in app runs on: the Postgres provider where Supabase is configured, the seeded in-memory one only in
// development and tests, and NEVER the in-memory one (or its seed data) in production.

const { getDataProvider, resetDomainProvider } = loadTsFrom(import.meta.url, "../src/lib/data/provider.ts");
const memory = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");

const SUPABASE = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: "sb_publishable_test", DATABASE_URL: "postgresql://x:y@127.0.0.1:1/z" };

test("development and tests without Supabase get the seeded in-memory provider", () => {
  for (const env of [{ NODE_ENV: "development" }, {}, { NODE_ENV: "test" }]) assert.equal(getDataProvider(env), memory.getDataProvider(), JSON.stringify(env));
});

test("production without the Supabase settings refuses: it never falls back to the in-memory provider or its seed data", () => {
  assert.throws(() => getDataProvider({ NODE_ENV: "production" }), /never uses the development data/);
  assert.throws(() => getDataProvider({ NODE_ENV: "production", SUPABASE_URL: SUPABASE.SUPABASE_URL }), /never uses the development data/, "a partial configuration is not enough");
  assert.throws(() => getDataProvider({ NODE_ENV: "production", ...SUPABASE, DATABASE_URL: "" }));
});

test("with Supabase configured, in production or development, it is the Postgres provider and not the development one", () => {
  resetDomainProvider();
  for (const NODE_ENV of ["production", "development"]) {
    const provider = getDataProvider({ NODE_ENV, ...SUPABASE });
    assert.notEqual(provider, memory.getDataProvider(), NODE_ENV);
    for (const name of ["tutors", "clients", "students", "assignments", "lessons", "availability", "attendance", "activity", "reports", "settings", "notifications"]) assert.equal(typeof provider[name], "object", name);
  }
  assert.equal(getDataProvider({ NODE_ENV: "production", ...SUPABASE }), getDataProvider({ NODE_ENV: "production", ...SUPABASE }), "one provider, kept");
  resetDomainProvider();
});

test("the Postgres provider cannot invent a client: families come from sign-up", async () => {
  resetDomainProvider();
  const provider = getDataProvider({ NODE_ENV: "production", ...SUPABASE });
  await assert.rejects(() => provider.clients.create({ name: "X", email: "x@example.test", active: true }), /adult who signs up/);
  resetDomainProvider();
});
