import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test, after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment, jsonRequest } from "./_routeHelpers.mjs";

// The site's own account code against the REAL local Supabase stack (plan20): the real route handlers, the real SupabaseAccountAuth
// over the real GoTrue, the real production connection code (db.ts) to real Postgres, and the real mail catcher. Skipped unless
// SUPABASE_LOCAL=1 with `npm run supabase:start` running:   SUPABASE_LOCAL=1 node --test tests/realstack.app.test.mjs
//
// Findings against the faked-fetch tests are recorded in docs/SUPABASE_REAL_STACK.md; the ones found by this file are marked below.

const ENABLED = process.env.SUPABASE_LOCAL === "1";
const REPO = fileURLToPath(new URL("../../../", import.meta.url));

describe("account routes on the real local stack", { skip: ENABLED ? false : "set SUPABASE_LOCAL=1 with the local stack running (npm run supabase:start)" }, () => {
  const h = loadTsFrom(import.meta.url, "../src/lib/account/handlers.ts");
  const session = loadTsFrom(import.meta.url, "../src/lib/account/session.ts");
  const { SupabaseAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/supabaseAuth.ts");
  const { SignInLockout } = loadTsFrom(import.meta.url, "../src/lib/account/lockout.ts");
  const { createExecutor } = loadTsFrom(import.meta.url, "../src/lib/db.ts");
  const { SqlLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/sql.ts");

  let stack;
  let rt;
  let close;
  const created = [];
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const PASSWORD = "correct horse battery staple"; // lower case only: the site's rule is length, and so is the stack's

  const post = (path, body) => jsonRequest(`http://localhost:3100/api/account/${path}`, {}, body);
  const jarOf = () => {
    const values = new Map();
    const options = new Map();
    return { values, options, get: (n) => values.get(n), set: (n, v, o) => (values.set(n, v), options.set(n, o)), delete: (n) => values.delete(n) };
  };

  async function mail(to) {
    for (let i = 0; i < 20; i += 1) {
      const list = await (await fetch(`${stack.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
      const first = list.messages?.[0];
      if (first) return { subject: first.Subject, html: (await (await fetch(`${stack.MAILPIT_URL}/api/v1/message/${first.ID}`)).json()).HTML };
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }
  const tokenHashOf = (html) => new URL(/href="([^"]+)"/.exec(html)[1].replace(/&amp;/g, "&")).searchParams.get("token_hash");
  const admin = (path, init = {}) => fetch(`${stack.API_URL}/auth/v1/admin${path}`, { ...init, headers: { apikey: stack.SECRET_KEY, "Content-Type": "application/json" } });

  before(async () => {
    const status = spawnSync("npx", ["supabase", "status", "--output", "json"], { cwd: REPO, encoding: "utf8", shell: true });
    stack = JSON.parse(status.stdout);
    for (const url of [stack.API_URL, stack.DB_URL, stack.MAILPIT_URL]) assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "local stack only");
    const db = await createExecutor(stack.DB_URL);
    close = db.close;
    // The same wiring runtime.ts builds in production, with the new-style publishable key (not a JWT) as the project key.
    rt = { backend: "supabase", auth: new SupabaseAccountAuth({ url: stack.API_URL, anonKey: stack.PUBLISHABLE_KEY }), store: new SqlLibraryStore(db.executor), lockout: new SignInLockout(), outbox: null, memory: null };
  });

  after(async () => {
    for (const id of created) await admin(`/users/${id}`, { method: "DELETE" });
    await close?.();
  });

  const fresh = (t) => {
    environment(t, {});
    h.resetAccountLimiters();
    session.resetSessionCache();
  };

  async function signUpAndConfirm(t, email, jar) {
    const signup = await h.handleSignUp(post("signup", { email, password: PASSWORD, displayName: "Pat", confirmAdult: true }), { rt, jar });
    assert.equal(signup.status, 200, await signup.clone().text());
    const message = await mail(email);
    assert.ok(message, "the confirmation email reached the mail catcher");
    const verify = await h.handleVerify(post("verify", { tokenHash: tokenHashOf(message.html), type: "signup" }), { rt, jar });
    assert.equal(verify.status, 200, await verify.clone().text());
    return verify;
  }

  test("sign-up, the real emailed link, confirmation: a session, a profile, an adult declaration, and a family account on demand", async (t) => {
    fresh(t);
    const email = `app-${run}-a@example.com`;
    const jar = jarOf();
    // Sign-up through the real route; a second sign-up for the same address answers exactly the same (a real service says 422
    // user_already_exists, which SupabaseAccountAuth hides; the faked tests assumed that code, the real one confirms it).
    const first = await h.handleSignUp(post("signup", { email, password: PASSWORD, displayName: "Pat", confirmAdult: true }), { rt, jar });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { success: true });
    // Not confirmed yet: the route says so, in the words the page shows.
    const early = await h.handleSignIn(post("signin", { email, password: PASSWORD }), { rt, jar });
    assert.equal(early.status, 403);
    assert.equal((await early.json()).code, "email_not_confirmed");
    const message = await mail(email);
    assert.equal(message.subject, "Confirm your LearnThrive email address");
    const verify = await h.handleVerify(post("verify", { tokenHash: tokenHashOf(message.html), type: "signup" }), { rt, jar });
    assert.equal(verify.status, 200);
    assert.deepEqual(await verify.json(), { success: true, next: "/account" });
    // Both cookies are set, httpOnly, never readable by page scripts, SameSite=Lax.
    for (const name of [session.ACCESS_COOKIE, session.REFRESH_COOKIE]) {
      assert.ok(jar.get(name), name);
      assert.equal(jar.options.get(name).httpOnly, true, `${name} httpOnly`);
      assert.equal(jar.options.get(name).sameSite, "lax");
    }
    // A used link cannot be used again.
    const again = await h.handleVerify(post("verify", { tokenHash: tokenHashOf(message.html), type: "signup" }), { rt, jar: jarOf() });
    assert.equal(again.status, 400);
    assert.equal((await again.json()).code, "invalid_link");
    // The session is real, and the database (through the production connection code) has the profile the trigger made.
    const state = await session.renewSession(jar, rt);
    assert.equal(state.status, "ok");
    assert.equal(state.user.email, email);
    created.push(state.user.id);
    const account = await rt.store.accounts.getAccount(state.user.id);
    assert.equal(account.role, "CLIENT");
    assert.equal(account.adultConfirmed, true);
    assert.equal(await rt.store.accounts.getEmail(state.user.id), email);
    const clientId = await rt.store.accounts.ensureClient(state.user.id);
    assert.equal(await rt.store.accounts.ensureClient(state.user.id), clientId, "one family account, however often it is asked for");
    const me = await h.handleMe({ rt, jar });
    assert.deepEqual(await me.json(), { user: { displayName: "Pat" } });
    // A duplicate sign-up is invisible.
    const second = await h.handleSignUp(post("signup", { email, password: PASSWORD, displayName: "Impostor", confirmAdult: true }), { rt, jar: jarOf() });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { success: true });
    assert.equal((await rt.store.accounts.getAccount(state.user.id)).displayName, "Pat", "the real account is untouched");
  });

  test("a changed name is saved through the real database; an expired access token is renewed with the refresh token, which rotates; sign-out ends the session", async (t) => {
    fresh(t);
    const email = `app-${run}-b@example.com`;
    const jar = jarOf();
    await signUpAndConfirm(t, email, jar);
    const user = (await session.renewSession(jar, rt)).user;
    created.push(user.id);
    const named = await h.handleSetName(post("profile", { displayName: "Pat Q" }), { rt, jar });
    assert.equal(named.status, 200);
    assert.equal((await rt.store.accounts.getAccount(user.id)).displayName, "Pat Q");
    // The access token goes bad: the next request renews it from the refresh cookie, and the refresh token changes (single use).
    const oldRefresh = jar.get(session.REFRESH_COOKIE);
    jar.set(session.ACCESS_COOKIE, "expired.or.forged", {});
    session.resetSessionCache();
    const renewed = await session.renewSession(jar, rt);
    assert.equal(renewed.status, "ok");
    assert.equal(renewed.user.id, user.id);
    assert.notEqual(jar.get(session.REFRESH_COOKIE), oldRefresh, "a new refresh token");
    // A forged access token and no refresh token is no session at all.
    const stranger = jarOf();
    stranger.set(session.ACCESS_COOKIE, "forged", {});
    assert.equal((await session.renewSession(stranger, rt)).status, "none");
    // Sign-out: cookies cleared, and the real service no longer honours the session's refresh token.
    const refreshBefore = jar.get(session.REFRESH_COOKIE);
    const out = await h.handleSignOut(post("logout", {}), { rt, jar });
    assert.equal(out.status, 200);
    assert.equal(jar.get(session.ACCESS_COOKIE), undefined);
    assert.equal(await rt.auth.refresh(refreshBefore), null, "the signed-out session cannot be renewed");
    // And signing in again works with the password.
    const back = await h.handleSignIn(post("signin", { email, password: PASSWORD }), { rt, jar });
    assert.equal(back.status, 200);
    assert.deepEqual(await back.json(), { success: true, user: { displayName: "Pat Q" } });
    const wrong = await h.handleSignIn(post("signin", { email, password: "not the right password at all" }), { rt, jar: jarOf() });
    assert.equal(wrong.status, 401);
  });

  test("password rules end to end: too short, and (found on the real stack) too long in bytes, are refused with a password message, never 'invalid email'", async (t) => {
    fresh(t);
    // The site refuses first, in its own words, without calling the service.
    for (const password of ["elevenchars", "x".repeat(73), "é".repeat(37)]) {
      const r = await h.handleSignUp(post("signup", { email: `app-${run}-pw@example.com`, password, displayName: "P", confirmAdult: true }), { rt, jar: jarOf() });
      assert.equal(r.status, 422, `${password.length} characters`);
      const body = await r.json();
      assert.ok(body.errors.password, JSON.stringify(body));
      assert.equal(body.errors.email, undefined);
    }
    // If a too-long password ever reached the real service (a rule changed upstream), the mapping says "password", not "email".
    const direct = await rt.auth.signUp({ email: `app-${run}-pw2@example.com`, password: "x".repeat(73), displayName: "P", adultConfirmed: true });
    assert.deepEqual(direct, { ok: false, reason: "weak_password" });
    const short = await rt.auth.signUp({ email: `app-${run}-pw3@example.com`, password: "elevenchars", displayName: "P", adultConfirmed: true });
    assert.deepEqual(short, { ok: false, reason: "weak_password" });
    // 12 characters, all lower case, is accepted by both.
    const ok = await rt.auth.signUp({ email: `app-${run}-pw4@example.com`, password: "twelve chars", displayName: "P", adultConfirmed: true });
    assert.deepEqual(ok, { ok: true });
    const id = (await (await admin(`/users?per_page=200`)).json()).users.find((u) => u.email === `app-${run}-pw4@example.com`)?.id;
    if (id) created.push(id);
  });

  test("password reset end to end: the recovery email, one button press, a new password, the old one stops working", async (t) => {
    fresh(t);
    const email = `app-${run}-c@example.com`;
    const jar = jarOf();
    await signUpAndConfirm(t, email, jar);
    created.push((await session.renewSession(jar, rt)).user.id);
    const asked = await h.handleEmailLink(post("forgot", { email }), { rt, jar: jarOf() }, "reset");
    assert.equal(asked.status, 200);
    // An address with no account gets the same answer (and no email).
    const unknown = await h.handleEmailLink(post("forgot", { email: `nobody-${run}@example.com` }), { rt, jar: jarOf() }, "reset");
    assert.equal(unknown.status, 200);
    assert.deepEqual(await unknown.json(), await asked.clone().json());
    let reset;
    for (let i = 0; i < 20 && !reset; i += 1) {
      const found = await mail(email);
      if (found?.subject === "Reset your LearnThrive password") reset = found;
      else await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(reset, "the recovery email arrived");
    const resetJar = jarOf();
    const spent = await h.handleVerify(post("verify", { tokenHash: tokenHashOf(reset.html), type: "recovery" }), { rt, jar: resetJar });
    assert.equal(spent.status, 200);
    assert.deepEqual(await spent.json(), { success: true, next: "/account/reset" });
    const tooLong = await h.handleSetPassword(post("password", { password: "x".repeat(73) }), { rt, jar: resetJar });
    assert.equal(tooLong.status, 422);
    const changed = await h.handleSetPassword(post("password", { password: "a-different-passphrase-now" }), { rt, jar: resetJar });
    assert.equal(changed.status, 200, await changed.clone().text());
    assert.equal((await h.handleSignIn(post("signin", { email, password: PASSWORD }), { rt, jar: jarOf() })).status, 401, "the old password no longer works");
    assert.equal((await h.handleSignIn(post("signin", { email, password: "a-different-passphrase-now" }), { rt, jar: jarOf() })).status, 200);
    // The same link cannot be spent twice.
    assert.equal((await h.handleVerify(post("verify", { tokenHash: tokenHashOf(reset.html), type: "recovery" }), { rt, jar: jarOf() })).status, 400);
  });
});
