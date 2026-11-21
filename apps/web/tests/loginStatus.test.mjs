import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// The administrator's "Sign-in" column: who has chosen their own password after their login was made (docs/AUTHENTICATION.md, "The first sign-in").

const { loginState, LOGIN_LABELS } = loadTsFrom(import.meta.url, "../src/lib/people/loginStatus.ts");
const { SupabaseAccountAdmin } = loadTsFrom(import.meta.url, "../src/lib/account/supabaseAdmin.ts");
const { MemoryAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/memoryAuth.ts");

test("the four states: no login, never signed in, signed in on the temporary password, chose their own", () => {
  assert.equal(loginState(null, null), "none");
  assert.equal(loginState({ mustChangePassword: true }, null), "never");
  assert.equal(loginState({ mustChangePassword: true }, "2026-11-18T10:00:00Z"), "temporary");
  assert.equal(loginState({ mustChangePassword: false }, "2026-11-18T10:00:00Z"), "set");
  assert.equal(loginState({ mustChangePassword: false }, null), "set", "a person who chose a password counts even if Auth could not give a date");
  assert.deepEqual(Object.keys(LOGIN_LABELS).sort(), ["never", "none", "set", "temporary"]);
});

test("the Auth admin client reads last sign-ins page by page, skips people who never signed in, and fails to null rather than guessing", async () => {
  const page = (n, count) => ({ users: Array.from({ length: count }, (_, i) => ({ id: `u${n}-${i}`, last_sign_in_at: i % 2 ? null : "2026-11-18T09:00:00Z" })) });
  const urls = [];
  const fetchOk = async (url, init) => { urls.push(String(url)); assert.equal(init.method, "GET"); const n = Number(new URL(String(url)).searchParams.get("page")); return new Response(JSON.stringify(n === 1 ? page(1, 200) : page(2, 3)), { status: 200 }); };
  const admin = new SupabaseAccountAdmin({ url: "https://x.supabase.co", serviceKey: "sb_secret_test", fetch: fetchOk });
  const map = await admin.lastSignIns();
  assert.equal(urls.length, 2, "a short page ends the walk");
  assert.equal(map.size, 100 + 2, "only people with a time are listed");
  assert.ok(map.has("u1-0") && !map.has("u1-1"));
  const broken = new SupabaseAccountAdmin({ url: "https://x.supabase.co", serviceKey: "sb_secret_test", fetch: async () => new Response("no", { status: 500 }) });
  assert.equal(await broken.lastSignIns(), null);
});

test("the in-memory auth records a sign-in time only after a real sign-in", async () => {
  const auth = new MemoryAccountAuth({ now: () => Date.parse("2026-11-19T12:00:00Z") });
  const made = await auth.createUser({ email: "tutor@x.test", password: "A-long-enough-pass-1!", displayName: "T", adultConfirmed: true });
  assert.equal(made.ok, true);
  assert.equal((await auth.lastSignIns()).size, 0, "made, never signed in");
  await auth.signIn("tutor@x.test", "wrong password here 1!");
  assert.equal((await auth.lastSignIns()).size, 0, "a wrong password is not a sign-in");
  await auth.signIn("tutor@x.test", "A-long-enough-pass-1!");
  assert.equal((await auth.lastSignIns()).get(made.id), "2026-11-19T12:00:00.000Z");
});
