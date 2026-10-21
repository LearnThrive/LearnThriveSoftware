import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment, jsonRequest, nextIp, quiet } from "./_routeHelpers.mjs";

// Account sign-in (plan19 phase C): validation, lockout, the in-memory and Supabase providers, and the route logic.

const v = loadTsFrom(import.meta.url, "../src/lib/account/validation.ts");
const { SignInLockout } = loadTsFrom(import.meta.url, "../src/lib/account/lockout.ts");
const { MemoryAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/memoryAuth.ts");
const { SupabaseAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/supabaseAuth.ts");
const session = loadTsFrom(import.meta.url, "../src/lib/account/session.ts");
const h = loadTsFrom(import.meta.url, "../src/lib/account/handlers.ts");
const { accountBackend } = loadTsFrom(import.meta.url, "../src/lib/account/runtime.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

const GOOD = "correct horse battery staple";

test("validation: emails, passwords, link tokens and the next path", () => {
  assert.equal(v.emailError("a@b.co"), undefined);
  for (const bad of ["", "a", "a@b", "a@b.com,c@d.com", "Name <a@b.com>", "a@b.com\n", `${"x".repeat(160)}@b.com`]) assert.ok(v.emailError(bad), bad);
  assert.equal(v.parseEmail("  Family@Example.COM "), "family@example.com");
  assert.equal(v.passwordError("x".repeat(v.PASSWORD_MIN)), undefined);
  assert.ok(v.passwordError("x".repeat(v.PASSWORD_MIN - 1)));
  assert.ok(v.passwordError("x".repeat(v.PASSWORD_MAX + 1)));
  assert.equal(v.passwordError("x".repeat(v.PASSWORD_MAX)), undefined, "72 bytes is allowed");
  assert.ok(v.passwordError("é".repeat(37)), "37 two-byte letters are 74 bytes: refused although only 37 characters");
  assert.equal(v.passwordError("é".repeat(36)), undefined, "36 two-byte letters are exactly 72 bytes");
  assert.equal(v.passwordError("  spaces are allowed  "), undefined);
  assert.equal(v.parseTokenHash("abcDEF123_-xyz"), "abcDEF123_-xyz");
  for (const bad of ["", "short", "has space in it here", "x".repeat(201), "../../etc/passwd", 5, null]) assert.equal(v.parseTokenHash(bad), null);
  assert.deepEqual(Object.keys(v.validateSignUp({ email: "bad", password: "short", displayName: "", confirmAdult: false })).sort(), ["confirmAdult", "email", "password"]);
  assert.deepEqual(v.validateSignUp({ email: "a@b.co", password: GOOD, displayName: "", confirmAdult: true }), {});
  assert.equal(session.safeNextPath("/library/x"), "/library/x");
  for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "library", "", null, undefined, "/a\nb"]) assert.equal(session.safeNextPath(bad), "/account", String(bad));
});

test("lockout counts failures only, per account and per address, and forgets after the window", () => {
  const rules = { perAccount: { max: 3, windowMs: 1000 }, perAddress: { max: 5, windowMs: 1000 } };
  const lock = new SignInLockout(rules);
  for (let i = 0; i < 2; i += 1) lock.recordFailure("a@x.co", "1.1.1.1", 0);
  assert.equal(lock.locked("a@x.co", "1.1.1.1", 1), false);
  lock.recordFailure("a@x.co", "2.2.2.2", 2);
  assert.equal(lock.locked("a@x.co", "9.9.9.9", 3), true, "the account is locked from any address");
  assert.equal(lock.locked("b@x.co", "9.9.9.9", 3), false, "another account is not");
  assert.equal(lock.locked("a@x.co", "9.9.9.9", 1500), false, "the window passes");
  lock.recordFailure("a@x.co", "2.2.2.2", 2000);
  lock.recordSuccess("a@x.co");
  assert.equal(lock.locked("a@x.co", "9.9.9.9", 2001), false, "a good sign-in clears the account");
  for (let i = 0; i < 5; i += 1) lock.recordFailure(`u${i}@x.co`, "3.3.3.3", 3000);
  assert.equal(lock.locked("fresh@x.co", "3.3.3.3", 3001), true, "one address cannot try many accounts");
});

function memory(extra = {}) {
  let clock = 1_000_000;
  const created = [];
  const auth = new MemoryAccountAuth({ now: () => clock, onUserCreated: (u) => created.push(u), ...extra });
  return { auth, created, advance: (ms) => (clock += ms) };
}
const signUp = (auth, email = "p@example.com") => auth.signUp({ email, password: GOOD, displayName: "Pat", adultConfirmed: true });

test("memory provider: sign-up needs a verified email, links are one use and expire, nothing reveals which addresses exist", async () => {
  const { auth, created, advance } = memory();
  assert.deepEqual(await signUp(auth), { ok: true });
  assert.equal(created.length, 1);
  assert.equal(auth.outbox.length, 1);
  assert.deepEqual(await auth.signIn("p@example.com", "wrong password here"), { ok: false, reason: "invalid_credentials" });
  assert.deepEqual(await auth.signIn("nobody@example.com", GOOD), { ok: false, reason: "invalid_credentials" });
  assert.deepEqual(await auth.signIn("p@example.com", GOOD), { ok: false, reason: "email_not_confirmed" });

  assert.deepEqual(await signUp(auth), { ok: true }, "signing up again looks the same");
  assert.equal(created.length, 1, "and makes no second account");
  assert.equal(auth.outbox.length, 2, "an unconfirmed account is sent a fresh link");

  const [first, second] = auth.outbox;
  assert.deepEqual(await auth.verifyEmailLink(second.tokenHash, "recovery"), { ok: false, reason: "invalid_token" }, "a signup link is not a recovery link");
  assert.deepEqual(await auth.verifyEmailLink(second.tokenHash, "signup"), { ok: false, reason: "invalid_token" }, "and a wrong-kind try still spends it");
  advance(61 * 60 * 1000);
  assert.deepEqual(await auth.verifyEmailLink(first.tokenHash, "signup"), { ok: false, reason: "invalid_token" }, "expired");

  await auth.resendVerification("p@example.com");
  const fresh = auth.outbox.at(-1);
  const ok = await auth.verifyEmailLink(fresh.tokenHash, "signup");
  assert.equal(ok.ok, true);
  assert.equal(ok.user.email, "p@example.com");
  assert.deepEqual(await auth.verifyEmailLink(fresh.tokenHash, "signup"), { ok: false, reason: "invalid_token" }, "one use");
  assert.equal((await auth.signIn("p@example.com", GOOD)).ok, true);

  const before = auth.outbox.length;
  assert.deepEqual(await signUp(auth), { ok: true });
  assert.equal(auth.outbox.length, before, "a confirmed account is sent nothing");
  assert.deepEqual(await auth.requestPasswordReset("nobody@example.com"), { ok: true });
  assert.equal(auth.outbox.length, before, "an unknown address is sent nothing, and is told the same thing");
});

test("memory provider: weak passwords, sessions, refresh rotation, sign-out and password change", async () => {
  const { auth, advance } = memory();
  assert.deepEqual(await auth.signUp({ email: "w@example.com", password: "short", displayName: "", adultConfirmed: true }), { ok: false, reason: "weak_password" });
  await signUp(auth, "s@example.com");
  await auth.verifyEmailLink(auth.outbox.at(-1).tokenHash, "signup");
  const one = await auth.signIn("s@example.com", GOOD);
  assert.equal((await auth.getUser(one.tokens.accessToken)).email, "s@example.com");
  assert.equal(await auth.getUser("at_made_up"), null);
  const renewed = await auth.refresh(one.tokens.refreshToken);
  assert.ok(renewed);
  assert.equal(await auth.refresh(one.tokens.refreshToken), null, "a refresh token works once");

  const two = await auth.signIn("s@example.com", GOOD);
  assert.deepEqual(await auth.updatePassword(two.tokens.accessToken, "short"), { ok: false, reason: "weak_password" });
  assert.deepEqual(await auth.updatePassword("at_made_up", "another long password"), { ok: false, reason: "invalid_token" });
  assert.deepEqual(await auth.updatePassword(two.tokens.accessToken, "another long password"), { ok: true });
  assert.equal(await auth.getUser(renewed.accessToken), null, "other sessions end when the password changes");
  assert.ok(await auth.getUser(two.tokens.accessToken), "this one stays");
  assert.equal((await auth.signIn("s@example.com", GOOD)).ok, false);
  const three = await auth.signIn("s@example.com", "another long password");
  assert.equal(three.ok, true);

  await auth.signOut(three.tokens.accessToken);
  assert.equal(await auth.getUser(three.tokens.accessToken), null);
  assert.equal(await auth.refresh(three.tokens.refreshToken), null);
  advance(2 * 60 * 60 * 1000);
  const four = await auth.signIn("s@example.com", "another long password");
  advance(61 * 60 * 1000);
  assert.equal(await auth.getUser(four.tokens.accessToken), null, "an access token expires");
});

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method: init.method, headers: init.headers, body });
    const out = handler(String(url), init.method, body, init.headers);
    if (out instanceof Error) throw out;
    return new Response(out.body === undefined ? "" : JSON.stringify(out.body), { status: out.status });
  };
  return { fn, calls };
}
const SESSION = { access_token: "jwt-a", refresh_token: "ref-1", expires_in: 3600, user: { id: "11111111-1111-4111-8111-111111111111", email: "p@example.com", user_metadata: { display_name: "Pat" } } };
// A legacy-format key (a JWT: three dot-separated parts), which is sent as the apikey AND the bearer; see the sb_publishable_ test below.
const LEGACY_ANON = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.fake-signature-anon";
const supabase = (handler, anonKey = LEGACY_ANON) => {
  const f = fakeFetch(handler);
  return { auth: new SupabaseAccountAuth({ url: "https://proj.supabase.co/", anonKey, fetch: f.fn, timeoutMs: 500 }), calls: f.calls };
};

test("supabase provider: request shapes and the key goes only where it should", async () => {
  const { auth, calls } = supabase((url) => (url.includes("/user") ? { status: 200, body: SESSION.user } : { status: 200, body: SESSION }));
  await auth.signUp({ email: "p@example.com", password: GOOD, displayName: "Pat", adultConfirmed: true });
  assert.equal(calls[0].url, "https://proj.supabase.co/auth/v1/signup");
  assert.deepEqual(calls[0].body, { email: "p@example.com", password: GOOD, data: { display_name: "Pat", adult_confirmed: true } });
  assert.equal(calls[0].headers.apikey, LEGACY_ANON);
  assert.equal(calls[0].headers.Authorization, `Bearer ${LEGACY_ANON}`);

  const signedIn = await auth.signIn("p@example.com", GOOD);
  assert.equal(calls[1].url, "https://proj.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(signedIn.ok, true);
  assert.equal(signedIn.user.displayName, "Pat");
  assert.equal(signedIn.tokens.accessToken, "jwt-a");
  assert.ok(signedIn.tokens.expiresAt > Date.now());

  assert.equal((await auth.verifyEmailLink("abcdefgh12345", "recovery")).ok, true);
  assert.deepEqual(calls[2].body, { type: "recovery", token_hash: "abcdefgh12345" });
  await auth.requestPasswordReset("p@example.com");
  assert.equal(calls[3].url, "https://proj.supabase.co/auth/v1/recover");
  await auth.resendVerification("p@example.com");
  assert.deepEqual(calls[4].body, { type: "signup", email: "p@example.com" });
  assert.equal((await auth.updatePassword("jwt-a", "x".repeat(14))).ok, true);
  assert.equal(calls[5].method, "PUT");
  assert.equal(calls[5].headers.Authorization, "Bearer jwt-a", "the user's token, not the anon key, on a user call");
  assert.equal((await auth.getUser("jwt-a")).id, SESSION.user.id);
  assert.equal(calls[6].method, "GET");
  assert.equal((await auth.refresh("ref-1")).refreshToken, "ref-1");
  assert.equal(calls[7].url, "https://proj.supabase.co/auth/v1/token?grant_type=refresh_token");
  await auth.signOut("jwt-a");
  assert.equal(calls[8].url, "https://proj.supabase.co/auth/v1/logout");
});

test("supabase provider: error codes map to the same reasons as the memory provider, and outages are 'unavailable'", async () => {
  const replies = (status, error_code) => supabase(() => ({ status, body: { error_code, msg: "x" } })).auth;
  assert.deepEqual(await replies(422, "weak_password").signUp({ email: "a@b.co", password: "p", displayName: "", adultConfirmed: true }), { ok: false, reason: "weak_password" });
  assert.deepEqual(await replies(400, "email_address_invalid").signUp({ email: "a@b.co", password: "p", displayName: "", adultConfirmed: true }), { ok: false, reason: "invalid_email" });
  // What the real service answers for a password it cannot hash (over 72 bytes): a password problem, never "invalid email".
  const tooLong = supabase(() => ({ status: 400, body: { error_code: "validation_failed", msg: "Password cannot be longer than 72 characters" } })).auth;
  assert.deepEqual(await tooLong.signUp({ email: "a@b.co", password: "p", displayName: "", adultConfirmed: true }), { ok: false, reason: "weak_password" });
  assert.deepEqual(await tooLong.updatePassword("t", "p"), { ok: false, reason: "weak_password" });
  const otherInvalid = supabase(() => ({ status: 400, body: { error_code: "validation_failed", msg: "Signup requires a valid email" } })).auth;
  assert.deepEqual(await otherInvalid.signUp({ email: "a@b.co", password: "p", displayName: "", adultConfirmed: true }), { ok: false, reason: "invalid_email" });
  assert.deepEqual(await replies(422, "user_already_exists").signUp({ email: "a@b.co", password: "p", displayName: "", adultConfirmed: true }), { ok: true }, "an existing address is not reported");
  assert.deepEqual(await replies(429, "over_email_send_rate_limit").signUp({ email: "a@b.co", password: "p", displayName: "", adultConfirmed: true }), { ok: false, reason: "unavailable" });
  assert.deepEqual(await replies(400, "invalid_credentials").signIn("a@b.co", "p"), { ok: false, reason: "invalid_credentials" });
  assert.deepEqual(await replies(400, "email_not_confirmed").signIn("a@b.co", "p"), { ok: false, reason: "email_not_confirmed" });
  assert.deepEqual(await replies(500, "").signIn("a@b.co", "p"), { ok: false, reason: "unavailable" });
  assert.deepEqual(await replies(403, "otp_expired").verifyEmailLink("abcdefgh12345", "signup"), { ok: false, reason: "invalid_token" });
  assert.deepEqual(await replies(422, "weak_password").updatePassword("t", "p"), { ok: false, reason: "weak_password" });
  assert.deepEqual(await replies(401, "bad_jwt").updatePassword("t", "p"), { ok: false, reason: "invalid_token" });
  assert.equal(await replies(401, "bad_jwt").getUser("t"), null);
  assert.equal(await replies(400, "refresh_token_not_found").refresh("t"), null);
  assert.deepEqual(await replies(404, "x").requestPasswordReset("a@b.co"), { ok: true }, "a 4xx on reset reveals nothing");
  assert.deepEqual(await replies(500, "").requestPasswordReset("a@b.co"), { ok: false, reason: "unavailable" });
  const down = supabase(() => new Error("connect ECONNREFUSED")).auth;
  assert.deepEqual(await down.signIn("a@b.co", "p"), { ok: false, reason: "unavailable" });
  assert.equal(await down.getUser("t"), null);
  await down.signOut("t");
  const garbage = new SupabaseAccountAuth({ url: "https://p.co", anonKey: "k", fetch: async () => new Response("<html>", { status: 200 }) });
  assert.deepEqual(await garbage.signIn("a@b.co", "p"), { ok: false, reason: "unavailable" });
});

test("accountBackend: supabase only with all three settings, memory only outside production, otherwise off", () => {
  const all = { SUPABASE_URL: "https://p.supabase.co", SUPABASE_ANON_KEY: "k", DATABASE_URL: "postgres://x" };
  assert.equal(accountBackend({ ...all, NODE_ENV: "production" }), "supabase");
  assert.equal(accountBackend({ NODE_ENV: "production" }), "off");
  assert.equal(accountBackend({ NODE_ENV: "production", SUPABASE_URL: "https://p.supabase.co", SUPABASE_ANON_KEY: "k" }), "off", "no database URL");
  assert.equal(accountBackend({ NODE_ENV: "production", SUPABASE_URL: " ", SUPABASE_ANON_KEY: "k", DATABASE_URL: "x" }), "off");
  assert.equal(accountBackend({ NODE_ENV: "development" }), "memory");
  assert.equal(accountBackend({}), "memory");
});

// ---- the routes ----------------------------------------------------------------------------------------------

function runtime() {
  const store = new InMemoryLibraryStore();
  const auth = new MemoryAccountAuth({ onUserCreated: (u) => store.seedProfile({ id: u.id, displayName: u.displayName }) });
  return { backend: "memory", auth, store, lockout: new SignInLockout(), outbox: auth.outbox, memory: store };
}

function jar() {
  const values = new Map();
  const options = new Map();
  return {
    values,
    options,
    get: (name) => values.get(name),
    set: (name, value, o) => {
      values.set(name, value);
      options.set(name, o);
    },
    delete: (name) => values.delete(name),
  };
}

const URL_BASE = "http://localhost:3100/api/account";
const post = (path, body, options) => jsonRequest(`${URL_BASE}/${path}`, {}, body, options);
const FORM = { email: "family@example.com", password: GOOD, displayName: "Pat", confirmAdult: true };

async function verified(rt, c, email = FORM.email) {
  await h.handleSignUp(post("signup", { ...FORM, email }), { rt, jar: c });
  const link = rt.outbox.findLast((m) => m.to === email && m.kind === "signup");
  return h.handleVerify(post("verify", { tokenHash: link.tokenHash, type: "signup" }), { rt, jar: c });
}

test("the name shown follows a rename: the profile is the source of truth, not the name given at sign-up (found on the real stack)", async (t) => {
  environment(t, {});
  h.resetAccountLimiters();
  quiet(t);
  const rt = runtime();
  const c = jar();
  await verified(rt, c);
  assert.deepEqual(await (await h.handleMe({ rt, jar: c })).json(), { user: { displayName: "Pat" } });
  assert.equal((await h.handleSetName(post("profile", { displayName: "Pat Q" }), { rt, jar: c })).status, 200);
  assert.deepEqual(await (await h.handleMe({ rt, jar: c })).json(), { user: { displayName: "Pat Q" } });
  const again = await h.handleSignIn(post("signin", { email: FORM.email, password: GOOD }), { rt, jar: jar() });
  assert.deepEqual((await again.json()).user, { displayName: "Pat Q" });
});

test("sign-up route: success, an identical answer for a known address, and the log holds nothing personal", async (t) => {
  environment(t, {});
  h.resetAccountLimiters();
  const lines = quiet(t);
  const rt = runtime();
  const first = await h.handleSignUp(post("signup", FORM), { rt, jar: jar() });
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { success: true });
  const second = await h.handleSignUp(post("signup", FORM), { rt, jar: jar() });
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { success: true });
  assert.equal(rt.outbox.length, 2);
  const log = lines.join("\n");
  assert.ok(!log.includes("family@example.com") && !log.includes(GOOD) && !log.includes("Pat"), "no address, password or name in the log");
});

test("sign-up route: refuses what it should", async (t) => {
  environment(t, {});
  h.resetAccountLimiters();
  quiet(t);
  const rt = runtime();
  const call = (body, options) => h.handleSignUp(post("signup", body, options), { rt, jar: jar() });
  const unticked = await call({ confirmAdult: false, ...{ email: FORM.email, password: GOOD } });
  assert.equal(unticked.status, 422);
  assert.ok((await unticked.json()).errors.confirmAdult);
  const weak = await call({ ...FORM, password: "short" });
  assert.equal(weak.status, 422);
  assert.ok((await weak.json()).errors.password);
  assert.equal((await call({ ...FORM, email: "a@b.com,c@d.com" })).status, 422);
  assert.equal((await call({ ...FORM, humanCheck: undefined })).status, 400, "no human check");
  assert.equal(rt.outbox.length, 0, "nothing was created by any of those");

  const trapped = await call({ ...FORM, website: "http://spam.example" });
  assert.equal(trapped.status, 200, "a bot gets the same success");
  assert.equal(rt.outbox.length, 0);

  const badOrigin = await h.handleSignUp(new Request(`${URL_BASE}/signup`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }), { rt, jar: jar() });
  assert.equal(badOrigin.status, 403);
  const notJson = await h.handleSignUp(new Request(`${URL_BASE}/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: "nope" }), { rt, jar: jar() });
  assert.equal(notJson.status, 400);
  const huge = await h.handleSignUp(new Request(`${URL_BASE}/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x: "y".repeat(20_000) }) }), { rt, jar: jar() });
  assert.equal(huge.status, 413);
  const off = await h.handleSignUp(post("signup", FORM), { rt: null, jar: jar() });
  assert.equal(off.status, 503, "no backend configured: closed");
});

test("sign-up route: rate limited per address", async (t) => {
  environment(t, {});
  h.resetAccountLimiters();
  quiet(t);
  const rt = runtime();
  const ip = nextIp();
  const statuses = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await h.handleSignUp(post("signup", { ...FORM, email: `r${i}@example.com` }, { ip }), { rt, jar: jar() })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
});

test("production: a form posted too fast is dropped", async (t) => {
  environment(t, { NODE_ENV: "production", CAPTCHA_SECRET: "a-test-secret-that-is-at-least-thirty-two-characters-long" });
  h.resetAccountLimiters();
  quiet(t);
  const rt = runtime();
  const fast = await h.handleSignUp(post("signup", { ...FORM, elapsedMs: 300 }), { rt, jar: jar() });
  assert.equal(fast.status, 200);
  assert.equal(rt.outbox.length, 0);
  const ok = await h.handleSignUp(post("signup", FORM), { rt, jar: jar() });
  assert.equal(ok.status, 200);
  assert.equal(rt.outbox.length, 1);
});

test("verify, sign in, session cookies, me, sign out", async (t) => {
  environment(t, {});
  h.resetAccountLimiters();
  session.resetSessionCache();
  quiet(t);
  const rt = runtime();
  const c = jar();

  await h.handleSignUp(post("signup", FORM), { rt, jar: c });
  const early = await h.handleSignIn(post("login", FORM), { rt, jar: c });
  assert.equal(early.status, 403);
  assert.equal((await early.json()).code, "email_not_confirmed");
  assert.equal(c.values.size, 0, "no cookie before the email is confirmed");

  const link = rt.outbox[0];
  assert.equal((await h.handleVerify(post("verify", { tokenHash: "no", type: "signup" }), { rt, jar: c })).status, 400);
  assert.equal((await h.handleVerify(post("verify", { tokenHash: link.tokenHash, type: "other" }), { rt, jar: c })).status, 400);
  const spent = await h.handleVerify(post("verify", { tokenHash: link.tokenHash, type: "signup" }), { rt, jar: c });
  assert.equal(spent.status, 200);
  assert.equal((await spent.json()).next, "/account");
  assert.ok(c.values.get(session.ACCESS_COOKIE), "the confirmation link signs the person in");
  const replay = await h.handleVerify(post("verify", { tokenHash: link.tokenHash, type: "signup" }), { rt, jar: jar() });
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).code, "invalid_link");

  const c2 = jar();
  const signedIn = await h.handleSignIn(post("login", FORM), { rt, jar: c2 });
  assert.equal(signedIn.status, 200);
  assert.deepEqual(await signedIn.json(), { success: true, user: { displayName: "Pat" }, next: "/account" }, "someone with no entitlement lands on their account page");
  for (const name of [session.ACCESS_COOKIE, session.REFRESH_COOKIE]) {
    assert.deepEqual(c2.options.get(name), { httpOnly: true, sameSite: "lax", secure: false, path: "/" }, "httpOnly, Lax, session cookie (no Max-Age)");
    assert.ok(!("maxAge" in c2.options.get(name)) && !("expires" in c2.options.get(name)));
  }

  const me = await h.handleMe({ rt, jar: c2 });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get("cache-control"), "no-store");
  assert.deepEqual(await me.json(), { user: { displayName: "Pat" } });
  assert.equal((await h.handleMe({ rt, jar: jar() })).status, 401);

  const out = await h.handleSignOut(post("logout", {}), { rt, jar: c2 });
  assert.equal(out.status, 200);
  assert.equal(c2.values.size, 0);
  assert.equal((await h.handleMe({ rt, jar: c2 })).status, 401);
});

test("production cookies are Secure", async (t) => {
  environment(t, { NODE_ENV: "production", CAPTCHA_SECRET: "a-test-secret-that-is-at-least-thirty-two-characters-long" });
  quiet(t);
  const c = jar();
  session.setSessionCookies(c, { accessToken: "a", refreshToken: "r", expiresAt: 1 }, process.env);
  assert.equal(c.options.get(session.ACCESS_COOKIE).secure, true);
});

test("an expired access token is renewed from the refresh token, and a dead session is cleared", async (t) => {
  environment(t, {});
  h.resetAccountLimiters();
  session.resetSessionCache();
  quiet(t);
  const rt = runtime();
  const c = jar();
  await verified(rt, c);
  const refresh = c.values.get(session.REFRESH_COOKIE);
  const stale = jar();
  stale.set(session.ACCESS_COOKIE, "at_expired", {});
  stale.set(session.REFRESH_COOKIE, refresh, {});
  assert.deepEqual(await session.readSession(stale, rt), { status: "refresh_needed" }, "a page reading cannot renew");
  const renewed = await session.renewSession(stale, rt);
  assert.equal(renewed.status, "ok");
  assert.notEqual(stale.values.get(session.REFRESH_COOKIE), refresh, "the refresh token rotated");
  const dead = jar();
  dead.set(session.REFRESH_COOKIE, "rt_nope", {});
  assert.deepEqual(await session.renewSession(dead, rt), { status: "none" });
  assert.equal(dead.values.size, 0);
  assert.deepEqual(await session.readSession(jar(), rt), { status: "none" });
});

test("sign-in route: one answer for unknown address and wrong password, and a lockout that holds even for the right password", async (t) => {
  environment(t, {});
  h.resetAccountLimiters();
  quiet(t);
  const rt = runtime();
  await verified(rt, jar());
  const ip = nextIp();
  const wrong = await h.handleSignIn(post("login", { ...FORM, password: "not the password" }, { ip }), { rt, jar: jar() });
  const unknown = await h.handleSignIn(post("login", { ...FORM, email: "nobody@example.com" }, { ip }), { rt, jar: jar() });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json());
  assert.equal((await h.handleSignIn(post("login", { email: "", password: "" }), { rt, jar: jar() })).status, 400);

  for (let i = 0; i < 8; i += 1) await h.handleSignIn(post("login", { ...FORM, password: `wrong password ${i}` }, { ip: nextIp() }), { rt, jar: jar() });
  const locked = await h.handleSignIn(post("login", FORM, { ip: nextIp() }), { rt, jar: jar() });
  assert.equal(locked.status, 429, "locked even with the right password, from a new address");
  assert.equal(rt.lockout.locked("other@example.com", "9.9.9.9"), false);
});

test("forgot and resend: the same answer for every address; reset needs the emailed session", async (t) => {
  environment(t, {});
  h.resetAccountLimiters();
  session.resetSessionCache();
  quiet(t);
  const rt = runtime();
  await verified(rt, jar());
  const known = await h.handleEmailLink(post("forgot", { email: FORM.email }), { rt, jar: jar() }, "reset");
  const unknown = await h.handleEmailLink(post("forgot", { email: "nobody@example.com" }), { rt, jar: jar() }, "reset");
  assert.equal(known.status, 200);
  assert.deepEqual(await known.json(), await unknown.json());
  assert.equal(rt.outbox.filter((m) => m.kind === "recovery").length, 1, "only the real account was sent a link");
  assert.equal((await h.handleEmailLink(post("forgot", { email: "bad" }), { rt, jar: jar() }, "reset")).status, 422);
  assert.equal((await h.handleEmailLink(post("resend", { email: FORM.email }), { rt, jar: jar() }, "verify")).status, 200);

  const noSession = await h.handleSetPassword(post("password", { password: "a brand new password" }), { rt, jar: jar() });
  assert.equal(noSession.status, 401);

  const c = jar();
  const link = rt.outbox.findLast((m) => m.kind === "recovery");
  const opened = await h.handleVerify(post("verify", { tokenHash: link.tokenHash, type: "recovery" }), { rt, jar: c });
  assert.equal((await opened.json()).next, "/account/reset");
  assert.equal((await h.handleSetPassword(post("password", { password: "short" }), { rt, jar: c })).status, 422);
  assert.equal((await h.handleSetPassword(post("password", { password: "a brand new password" }), { rt, jar: c })).status, 200);
  assert.equal((await h.handleSignIn(post("login", FORM), { rt, jar: jar() })).status, 401, "the old password no longer works");
  assert.equal((await h.handleSignIn(post("login", { ...FORM, password: "a brand new password" }), { rt, jar: jar() })).status, 200);
});

test("name on downloads: needs a session, is cleaned and bounded, may be emptied, and is rate limited", async (t) => {
  environment(t, {});
  h.resetAccountLimiters();
  session.resetSessionCache();
  quiet(t);
  const rt = runtime();
  const c = jar();
  await verified(rt, c);
  const name = (body, options) => h.handleSetName(post("profile", body, options), { rt, jar: c });
  assert.equal((await h.handleSetName(post("profile", { displayName: "Pat" }), { rt, jar: jar() })).status, 401);

  const ok = await name({ displayName: "  Pat \n Example  " });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { success: true, displayName: "Pat Example" });
  const user = await rt.auth.getUser(c.values.get(session.ACCESS_COOKIE));
  assert.equal((await rt.store.accounts.getAccount(user.id)).displayName, "Pat Example");

  assert.equal((await (await name({ displayName: "" })).json()).displayName, "");
  assert.equal((await (await name({ displayName: 42 })).json()).displayName, "", "a non-string is an empty name");
  const long = await name({ displayName: "x".repeat(81) });
  assert.equal(long.status, 422);
  assert.ok((await long.json()).errors.displayName);
  assert.equal((await name({ displayName: "Pat" }, { headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await h.handleSetName(post("profile", { displayName: "Pat" }), { rt: null, jar: c })).status, 503);
});

// ── One sign-in for everyone: where each kind of person lands, and the disabled-account answer ─────────────────────────────────────

async function signedUp(rt, email, mutate) {
  const c = jar();
  await verified(rt, c, email);
  const id = rt.auth.userIdFor(email);
  mutate?.(id);
  return id;
}
const loginAs = async (rt, email, extra = {}, deps = {}) => {
  const response = await h.handleSignIn(post("login", { email, password: GOOD, ...extra }), { rt, jar: jar(), ...deps });
  return { status: response.status, body: await response.json() };
};

test("sign-in routing: staff and enrolled families open the dashboard, a subscriber Study Buddy, anyone else their account page", async (t) => {
  environment(t, {});
  h.resetAccountLimiters();
  session.resetSessionCache();
  quiet(t);
  const rt = runtime();
  const past = new Date(Date.now() - 60_000);
  await signedUp(rt, "nobody@example.com");
  await signedUp(rt, "member@example.com", (id) => rt.memory.seedEntitlement(id, "subscription", past, null));
  await signedUp(rt, "granted@example.com", (id) => rt.memory.seedEntitlement(id, "admin_grant", past, null));
  await signedUp(rt, "family@example.org", (id) => rt.memory.seedAssignment(rt.memory.seedStudent(id), "ACTIVE"));
  await signedUp(rt, "paused@example.com", (id) => rt.memory.seedAssignment(rt.memory.seedStudent(id), "PAUSED"));
  await signedUp(rt, "staff@example.com", (id) => rt.memory.seedProfile({ id, role: "TUTOR", displayName: "Tutor" }));
  await signedUp(rt, "admin@example.com", (id) => rt.memory.seedProfile({ id, role: "ADMIN", displayName: "Admin" }));
  const open = { studyBuddyOpen: true };

  const landing = async (email, extra, deps) => (await loginAs(rt, email, extra, deps)).body.next;
  assert.equal(await landing("nobody@example.com", {}, open), "/account");
  assert.equal(await landing("member@example.com", {}, open), "/library/study-buddy");
  assert.equal(await landing("granted@example.com", {}, open), "/library/study-buddy");
  assert.equal(await landing("member@example.com", {}, {}), "/library", "Study Buddy closed: the Library is home");
  assert.equal(await landing("family@example.org", {}, open), "/dashboard");
  assert.equal(await landing("paused@example.com", {}, open), "/account", "a paused assignment is not enrolment");
  assert.equal(await landing("staff@example.com", {}, open), "/dashboard");
  assert.equal(await landing("admin@example.com", {}, open), "/dashboard");

  // The signed-in app closed (production before the portal opens): enrolled families land on what is open.
  assert.equal(await landing("family@example.org", {}, { studyBuddyOpen: true, dashboardOpen: false }), "/library/study-buddy");
  assert.equal(await landing("family@example.org", {}, { studyBuddyOpen: false, dashboardOpen: false }), "/library");

  // A page asked for is kept when the access includes it, and replaced by home when it does not.
  assert.equal(await landing("family@example.org", { next: "/dashboard/lessons" }, open), "/dashboard/lessons");
  assert.equal(await landing("member@example.com", { next: "/dashboard/lessons" }, open), "/library/study-buddy");
  assert.equal(await landing("nobody@example.com", { next: "/library/study-buddy" }, open), "/account");
  assert.equal(await landing("member@example.com", { next: "/library/search?q=maths" }, open), "/library/search?q=maths");
  // Anything that is not a plain path on this site is ignored, never followed.
  for (const hostile of ["//evil.example/x", "https://evil.example", "/\\evil", "dashboard", "/a\nb", 5, null, ["/dashboard"]]) {
    assert.equal(await landing("member@example.com", { next: hostile }, open), "/library/study-buddy", String(hostile));
    assert.equal(await landing("family@example.org", { next: hostile }, open), "/dashboard", String(hostile));
  }
});

test("sign-in routing never fails the sign-in: if access cannot be read, the page asked for or the account page", async (t) => {
  environment(t, {});
  h.resetAccountLimiters();
  session.resetSessionCache();
  quiet(t);
  const rt = runtime();
  await signedUp(rt, "p@example.com");
  rt.store.access.facts = async () => {
    throw new Error("database down");
  };
  rt.store.accounts.getAccount = async () => {
    throw new Error("database down");
  };
  const ok = await loginAs(rt, "p@example.com", { next: "/library/search" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.next, "/library/search");
  assert.equal((await loginAs(rt, "p@example.com")).body.next, "/account");
});

test("a disabled account is told so (after the right password) and a wrong password still gets the generic answer", async (t) => {
  environment(t, {});
  h.resetAccountLimiters();
  quiet(t);
  const rt = runtime();
  await rt.auth.seedUser({ id: "disabled-1", email: "off@example.com", displayName: "Off", password: GOOD, disabled: true });
  const off = await loginAs(rt, "off@example.com");
  assert.equal(off.status, 403);
  assert.equal(off.body.code, "account_disabled");
  assert.match(off.body.error, /disabled/);
  const guess = await h.handleSignIn(post("login", { email: "off@example.com", password: "not the password at all" }), { rt, jar: jar() });
  assert.equal(guess.status, 401, "a guesser learns nothing from the disabled state");
  assert.deepEqual(await guess.json(), { error: "Email or password is not right." });
  const jarOff = jar();
  await h.handleSignIn(post("login", { email: "off@example.com", password: GOOD }), { rt, jar: jarOff });
  assert.equal(jarOff.values.size, 0, "no session for a disabled account");
});

test("seedUser registers a confirmed account with a chosen id, once, and it signs in", async () => {
  const { auth } = memory();
  await auth.seedUser({ id: "fixed-id-1", email: "dev@example.com", displayName: "Dev", password: GOOD });
  await auth.seedUser({ id: "someone-else", email: "dev@example.com", displayName: "Other", password: "another password entirely" });
  assert.equal(auth.userIdFor("dev@example.com"), "fixed-id-1", "the second call for an address is ignored");
  const ok = await auth.signIn("dev@example.com", GOOD);
  assert.equal(ok.ok, true);
  assert.equal(ok.user.id, "fixed-id-1");
  assert.equal((await auth.signIn("dev@example.com", "wrong password at all")).reason, "invalid_credentials");
  assert.equal(auth.outbox.length, 0, "no email is sent for a seeded account");
});
