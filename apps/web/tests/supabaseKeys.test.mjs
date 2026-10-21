import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// Supabase's two key formats (plan20): a legacy JWT is sent as the apikey and the bearer; a new sb_ key is not a JWT, so it goes
// as the apikey only. A signed-in person's own token is always the bearer for a call made for them.

const keys = loadTsFrom(import.meta.url, "../src/lib/supabaseKeys.ts");
const { SupabaseAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/supabaseAuth.ts");
const { SupabaseLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");

const LEGACY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.fake-signature";
const PUBLISHABLE = "sb_publishable_FakeKeyForTests_0123456789";
const SECRET = "sb_secret_FakeKeyForTests_0123456789";

test("a legacy JWT key is recognised; an sb_ key, a token with too few parts and junk are not", () => {
  assert.equal(keys.isJwtKey(LEGACY), true);
  for (const key of [PUBLISHABLE, SECRET, "eyJhbGciOiJIUzI1NiJ9.onlytwo", "anon-key", "", "eyJ a.b.c"]) assert.equal(keys.isJwtKey(key), false, key);
});

test("headers: legacy key is apikey + bearer, new key is apikey only, a user token is always the bearer", () => {
  assert.deepEqual(keys.supabaseKeyHeaders(LEGACY), { apikey: LEGACY, Authorization: `Bearer ${LEGACY}` });
  assert.deepEqual(keys.supabaseKeyHeaders(PUBLISHABLE), { apikey: PUBLISHABLE });
  assert.deepEqual(keys.supabaseKeyHeaders(PUBLISHABLE, "user.jwt.token"), { apikey: PUBLISHABLE, Authorization: "Bearer user.jwt.token" });
  assert.deepEqual(keys.supabaseKeyHeaders(LEGACY, "user.jwt.token"), { apikey: LEGACY, Authorization: "Bearer user.jwt.token" });
});

function recorder(status = 200, body = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {}, method: init?.method });
    return new Response(JSON.stringify(body), { status });
  };
  return { fn, calls };
}

test("Auth with an sb_publishable_ key never puts the key in the Authorization header", async () => {
  const r = recorder();
  const auth = new SupabaseAccountAuth({ url: "https://p.supabase.co", anonKey: PUBLISHABLE, fetch: r.fn });
  await auth.signUp({ email: "a@example.com", password: "A-long-Password-1", displayName: "A", adultConfirmed: true });
  await auth.signIn("a@example.com", "A-long-Password-1");
  await auth.requestPasswordReset("a@example.com");
  assert.equal(r.calls.length, 3);
  for (const call of r.calls) {
    assert.equal(call.headers.apikey, PUBLISHABLE);
    assert.equal(call.headers.Authorization, undefined, `${call.url}: no bearer`);
  }
  // A call made for a signed-in person carries their token, not the project key.
  await auth.getUser("the.users.jwt");
  assert.equal(r.calls.at(-1).headers.Authorization, "Bearer the.users.jwt");
  assert.equal(r.calls.at(-1).headers.apikey, PUBLISHABLE);
});

test("Storage with an sb_secret_ key sends it as the apikey only, for every call", async () => {
  const r = recorder(200, { signedURL: "/object/sign/library/a.pdf?token=t" });
  const storage = new SupabaseLibraryStorage({ url: "https://p.supabase.co", serviceRoleKey: SECRET, fetch: r.fn });
  await storage.put("a.pdf", new Uint8Array([1]), "application/pdf");
  await storage.read("a.pdf");
  await storage.remove("a.pdf");
  assert.ok(r.calls.length >= 3);
  for (const call of r.calls.filter((c) => c.headers.apikey)) {
    assert.equal(call.headers.apikey, SECRET);
    assert.equal(call.headers.Authorization, undefined);
  }
});
