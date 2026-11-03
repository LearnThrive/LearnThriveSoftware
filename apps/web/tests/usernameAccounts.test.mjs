import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment, jsonRequest, quiet } from "./_routeHelpers.mjs";

// LearnThrive makes every account and people sign in with a username (launch checklist 0.2, 3.2; docs/AUTHENTICATION.md). These run on the
// in-memory backend; the Postgres binding is proved in packages/data, and the real Auth Admin API on the real stack (realstack.accounts).

const username = loadTsFrom(import.meta.url, "../src/lib/account/username.ts");
const credentials = loadTsFrom(import.meta.url, "../src/lib/account/credentials.ts");
const { createLogin, issueTemporaryPassword, setLoginDisabled, changeLinkedEmail } = loadTsFrom(import.meta.url, "../src/lib/account/provision.ts");
const h = loadTsFrom(import.meta.url, "../src/lib/account/handlers.ts");
const learnerHandlers = loadTsFrom(import.meta.url, "../src/lib/learner/handlers.ts");
const { MemoryAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/memoryAuth.ts");
const { SignInLockout, lockoutRules } = loadTsFrom(import.meta.url, "../src/lib/account/lockout.ts");
const { SupabaseAccountAdmin } = loadTsFrom(import.meta.url, "../src/lib/account/supabaseAdmin.ts");
const { SupabaseAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/supabaseAuth.ts");
const session = loadTsFrom(import.meta.url, "../src/lib/account/session.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/index.ts");

const post = (path, body) => jsonRequest(`http://localhost:3000/api/account/${path}`, {}, body);

function jar() {
  const cookies = new Map();
  return { get: (name) => cookies.get(name), set: (name, value) => cookies.set(name, value), delete: (name) => cookies.delete(name) };
}

function runtime() {
  const memory = new InMemoryLibraryStore();
  const auth = new MemoryAccountAuth({ onUserCreated: (user) => memory.seedProfile({ id: user.id, displayName: user.displayName, adultConfirmed: user.adultConfirmed, email: user.email }) });
  return { backend: "memory", auth, admin: auth, store: memory, db: null, lockout: new SignInLockout(), outbox: auth.outbox, memory };
}

const ADMIN = "11111111-1111-4111-8111-111111111111";
const family = { username: "sarah.ahmed", linkedEmail: "sarah@example.test", displayName: "Sarah Ahmed", role: "CLIENT", actor: ADMIN };

async function child(rt, parent, name = "kit-4821") {
  const studentId = rt.store.seedStudent(parent.profileId, { displayName: "Ayaan" });
  const made = await createLogin(rt, { username: name, linkedEmail: "sarah@example.test", displayName: "Ayaan", role: "STUDENT", studentId, actor: ADMIN });
  assert.equal(made.status, "created");
  return { ...made, studentId };
}

const signIn = (rt, jarInstance, user, password, extra = {}) => h.handleSignIn(post("login", { username: user, password }), { rt, jar: jarInstance, ...extra });

async function changePassword(rt, cookies, password) {
  return h.handleSetPassword(post("password", { password }), { rt, jar: cookies });
}

const SECRET = "a-test-secret-that-is-at-least-thirty-two-characters-long";

test.beforeEach((t) => {
  environment(t, { CAPTCHA_SECRET: SECRET });
  h.resetAccountLimiters();
  session.resetSessionCache();
});

test("usernames: the rules, and a reserved name is refused whatever its case", () => {
  for (const good of ["kit-4821", "sarah.ahmed", "a_b", "abc", "x".repeat(30)]) assert.equal(username.usernameError(good), undefined, good);
  for (const bad of ["ab", "x".repeat(31), "has space", "-start", "end-", "two..dots", "café", "a@b.co", ""]) assert.ok(username.usernameError(bad), bad);
  assert.equal(username.parseUsername("  Sarah.Ahmed "), "sarah.ahmed");
  for (const reserved of ["admin", "support", "learnthrive"]) assert.match(username.usernameError(reserved), /reserved/, reserved);
  assert.equal(username.usernameFormatError("admin"), undefined, "a reserved name is still a shape signing in accepts: the answer must not differ");
});

test("the internal address is built from the username, and an email address is a sign-in only away from production", () => {
  assert.equal(username.internalEmailFor("kit-4821"), "kit-4821@accounts.learnthrivetuition.co.uk");
  assert.equal(username.isInternalEmail("Kit-4821@ACCOUNTS.learnthrivetuition.co.uk"), true);
  assert.equal(username.isInternalEmail("kit@example.test"), false);
  assert.equal(username.signInAddress("kit-4821", { NODE_ENV: "production" }), "kit-4821@accounts.learnthrivetuition.co.uk");
  assert.equal(username.signInAddress("person@example.test", { NODE_ENV: "production" }), null);
  assert.equal(username.signInAddress("person@example.test", {}), "person@example.test");
  assert.equal(username.signInAddress("not valid", {}), null);
});

test("what an administrator hands over: a long temporary password, and a child's username that says nothing about them", () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    const password = credentials.generateTemporaryPassword();
    assert.ok(password.length >= 16);
    assert.doesNotMatch(password, /[0O1lI]/, "nothing that reads ambiguously over the phone");
    seen.add(password);
    const name = credentials.generateChildUsername();
    assert.match(name, /^[a-z]+-\d{4}$/);
    assert.equal(username.usernameError(name), undefined, name);
  }
  assert.equal(seen.size, 50);
});

test("creating a login: confirmed, bound, must change the password; a duplicate, a bad username, a bad email and an ADMIN request are refused", async () => {
  const rt = runtime();
  const made = await createLogin(rt, family);
  assert.equal(made.status, "created");
  const account = await rt.store.accounts.getAccount(made.profileId);
  assert.equal(account.username, "sarah.ahmed");
  assert.equal(account.linkedEmail, "sarah@example.test");
  assert.equal(account.mustChangePassword, true);
  assert.ok(account.clientId, "their family exists");

  assert.equal((await createLogin(rt, family)).reason, "username_taken");
  assert.equal((await createLogin(rt, { ...family, username: "admin" })).reason, "bad_username");
  assert.equal((await createLogin(rt, { ...family, username: "two words" })).reason, "bad_username");
  assert.equal((await createLogin(rt, { ...family, username: "fresh", linkedEmail: "nope" })).reason, "bad_email");
  assert.equal((await createLogin(rt, { ...family, username: "fresh", displayName: "  " })).reason, "bad_name");
  assert.equal((await createLogin(rt, { ...family, username: "fresh", role: "ADMIN" })).reason, "not_eligible", "no screen makes an administrator");
  assert.equal((await rt.store.accounts.findByUsername("fresh")), null);
});

test("creating a login: a refusal at the binding step leaves no login behind", async () => {
  const rt = runtime();
  const parent = await createLogin(rt, family);
  const { studentId } = await child(rt, parent);
  const second = await createLogin(rt, { username: "another-1234", linkedEmail: "sarah@example.test", displayName: "Twin", role: "STUDENT", studentId, actor: ADMIN });
  assert.equal(second.reason, "not_eligible", "this student already has a login");
  assert.equal((await rt.auth.signIn(username.internalEmailFor("another-1234"), "anything at all here")).ok, false);
  assert.equal(rt.auth.userIdFor(username.internalEmailFor("another-1234")), null, "the login was deleted again");
});

test("creating a login with no Auth admin key says so and makes nothing", async () => {
  const rt = { ...runtime(), admin: null };
  const result = await createLogin(rt, family);
  assert.equal(result.reason, "unavailable");
  assert.match(result.message, /admin key/);
});

test("signing in takes a username, and a wrong username and a wrong password read the same", async (t) => {
  quiet(t);
  const rt = runtime();
  const made = await createLogin(rt, family);
  const cookies = jar();
  const good = await signIn(rt, cookies, "Sarah.Ahmed", made.temporaryPassword);
  assert.equal(good.status, 200, "case does not matter");
  const wrongPassword = await signIn(rt, jar(), "sarah.ahmed", "this is the wrong password");
  const wrongUsername = await signIn(rt, jar(), "nobody-here", "this is the wrong password");
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongUsername.status, 401);
  assert.deepEqual(await wrongPassword.json(), await wrongUsername.json());
  assert.equal((await signIn(rt, jar(), "", "x")).status, 400);
});

test("a refused sign-in takes at least the floor, known username or not", async (t) => {
  quiet(t);
  const rt = runtime();
  await createLogin(rt, family);
  for (const name of ["sarah.ahmed", "nobody-here"]) {
    const started = performance.now();
    assert.equal((await signIn(rt, jar(), name, "this is the wrong password", { answerFloorMs: 120 })).status, 401);
    assert.ok(performance.now() - started >= 110, name);
  }
});

test("the lockout counts failures per username, known or not, so a locked answer says nothing either", async (t) => {
  quiet(t);
  const rt = runtime();
  const made = await createLogin(rt, family);
  for (const name of ["sarah.ahmed", "nobody-here"]) {
    for (let i = 0; i < lockoutRules.perAccount.max; i += 1) await signIn(rt, jar(), name, "this is the wrong password");
    assert.equal((await signIn(rt, jar(), name, "this is the wrong password")).status, 429, name);
  }
  assert.equal((await signIn(rt, jar(), "sarah.ahmed", made.temporaryPassword)).status, 429, "even the right password while locked");
});

test("production: only a username signs in, and the self-service doors are shut with a friendly answer", async (t) => {
  quiet(t);
  const rt = runtime();
  const env = { NODE_ENV: "production", CAPTCHA_SECRET: SECRET };
  await rt.auth.seedUser({ id: "22222222-2222-4222-8222-222222222222", email: "person@example.test", displayName: "P", password: "a long enough password" });
  rt.store.seedProfile({ id: "22222222-2222-4222-8222-222222222222" });
  const byAddress = await h.handleSignIn(post("login", { email: "person@example.test", password: "a long enough password" }), { rt, jar: jar(), env, answerFloorMs: 0 });
  assert.equal(byAddress.status, 400, "an email address is not a login");

  const closed = async (response) => {
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, "accounts_closed");
    assert.match(body.error, /sets up every account/);
  };
  await closed(await h.handleSignUp(post("signup", { email: "a@example.test", password: "a long enough password", confirmAdult: true }), { rt, jar: jar(), env }));
  await closed(await h.handleEmailLink(post("resend", { email: "a@example.test" }), { rt, jar: jar(), env }, "verify"));
  for (const handler of [learnerHandlers.handleInvitationPeek, learnerHandlers.handleLearnerSignUp, learnerHandlers.handleAcceptInvitation]) {
    await closed(await handler(post("learner", { token: "x".repeat(40) }), { rt, jar: jar(), env }));
  }
  assert.equal(rt.outbox.length, 0, "nothing was sent");
});

test("a temporary password: signing in lands on the change page, nothing else works, and choosing one opens the account", async (t) => {
  quiet(t);
  const rt = runtime();
  const made = await createLogin(rt, family);
  const cookies = jar();
  const response = await signIn(rt, cookies, "sarah.ahmed", made.temporaryPassword);
  assert.equal((await response.json()).next, "/account/reset");

  const before = await session.readSession(cookies, rt);
  assert.equal(before.status, "password_change");
  assert.equal((await h.handleMe({ rt, jar: cookies })).status, 401, "the account does not answer");
  assert.equal((await h.handleSetName(post("profile", { displayName: "New" }), { rt, jar: cookies })).status, 401, "nor can anything be changed");

  assert.equal((await changePassword(rt, cookies, made.temporaryPassword)).status, 422, "the temporary password cannot be kept");
  assert.equal((await changePassword(rt, cookies, "short")).status, 422);
  assert.equal((await session.readSession(cookies, rt)).status, "password_change");

  assert.equal((await changePassword(rt, cookies, "my own good password")).status, 200);
  assert.equal((await session.readSession(cookies, rt)).status, "ok");
  assert.equal((await rt.store.accounts.getAccount(made.profileId)).mustChangePassword, false);
  assert.equal((await signIn(rt, jar(), "sarah.ahmed", made.temporaryPassword)).status, 401, "the temporary password is gone");
  assert.equal((await signIn(rt, jar(), "sarah.ahmed", "my own good password")).status, 200);
});

test("a forgotten password: the link goes to the linked address, a child's to their parent, and never to the internal address", async (t) => {
  quiet(t);
  const rt = runtime();
  const parent = await createLogin(rt, family);
  await child(rt, parent);
  const deps = { rt, jar: jar(), answerFloorMs: 0 };
  assert.equal((await h.handleEmailLink(post("forgot", { username: "kit-4821" }), deps, "reset")).status, 200);
  assert.equal((await h.handleEmailLink(post("forgot", { username: "sarah.ahmed" }), deps, "reset")).status, 200);
  assert.deepEqual(rt.outbox.map((message) => message.to), ["sarah@example.test", "sarah@example.test"]);
  assert.ok(rt.outbox.every((message) => !username.isInternalEmail(message.to)));
});

test("a forgotten password: the same answer for every username, a disabled login gets nothing, and one inbox cannot be flooded", async (t) => {
  quiet(t);
  const rt = runtime();
  const made = await createLogin(rt, family);
  const deps = { rt, jar: jar(), answerFloorMs: 0 };
  const known = await h.handleEmailLink(post("forgot", { username: "sarah.ahmed" }), deps, "reset");
  const unknown = await h.handleEmailLink(post("forgot", { username: "nobody-here" }), deps, "reset");
  assert.equal(unknown.status, known.status);
  assert.deepEqual(await unknown.json(), await known.json());
  assert.equal(rt.outbox.length, 1);

  for (let i = 0; i < 5; i += 1) assert.equal((await h.handleEmailLink(post("forgot", { username: "sarah.ahmed" }), deps, "reset")).status, 200);
  assert.equal(rt.outbox.length, h.accountRateLimits.resetPerAccount.perClient.max, "still answers, stops sending");

  h.resetAccountLimiters();
  await setLoginDisabled(rt, made.profileId, true, ADMIN);
  const sent = rt.outbox.length;
  assert.equal((await h.handleEmailLink(post("forgot", { username: "sarah.ahmed" }), deps, "reset")).status, 200);
  assert.equal(rt.outbox.length, sent, "a disabled login gets no reset");
});

test("a forgotten password: the emailed link opens a session that can choose a new password, once, and other sessions end", async (t) => {
  quiet(t);
  const rt = runtime();
  const made = await createLogin(rt, family);
  const first = jar();
  await signIn(rt, first, "sarah.ahmed", made.temporaryPassword);
  await changePassword(rt, first, "the password they forgot");

  const other = jar();
  assert.equal((await signIn(rt, other, "sarah.ahmed", "the password they forgot")).status, 200);
  await h.handleEmailLink(post("forgot", { username: "sarah.ahmed" }), { rt, jar: jar(), answerFloorMs: 0 }, "reset");
  const { tokenHash } = rt.outbox.at(-1);

  const opened = jar();
  const verified = await h.handleVerify(post("verify", { tokenHash, type: "recovery" }), { rt, jar: opened });
  assert.equal((await verified.json()).next, "/account/reset");
  assert.equal((await h.handleVerify(post("verify", { tokenHash, type: "recovery" }), { rt, jar: jar() })).status, 400, "single use");
  assert.equal((await changePassword(rt, opened, "a brand new password")).status, 200);

  session.resetSessionCache();
  assert.equal((await rt.auth.getUser(other.get(session.ACCESS_COOKIE))), null, "the other device is signed out");
  assert.equal((await signIn(rt, jar(), "sarah.ahmed", "the password they forgot")).status, 401);
});

test("a reset link stops working after 30 minutes", async () => {
  let now = 1_000_000;
  const memory = new InMemoryLibraryStore();
  const auth = new MemoryAccountAuth({ now: () => now, onUserCreated: (user) => memory.seedProfile({ id: user.id }) });
  await auth.createUser({ email: "a@accounts.learnthrivetuition.co.uk", password: "a temporary password", displayName: "A", adultConfirmed: true });
  const fresh = await auth.recoveryLink("a@accounts.learnthrivetuition.co.uk");
  const stale = await auth.recoveryLink("a@accounts.learnthrivetuition.co.uk");
  now += 29 * 60 * 1000;
  assert.equal((await auth.verifyEmailLink(fresh.tokenHash, "recovery")).ok, true);
  now += 2 * 60 * 1000;
  assert.equal((await auth.verifyEmailLink(stale.tokenHash, "recovery")).ok, false);
  assert.equal(await auth.recoveryLink("nobody@accounts.learnthrivetuition.co.uk"), null);
});

test("an administrator's reset: a new temporary password, the old one stops working, and every session must change it", async (t) => {
  quiet(t);
  const rt = runtime();
  const made = await createLogin(rt, family);
  const cookies = jar();
  await signIn(rt, cookies, "sarah.ahmed", made.temporaryPassword);
  await changePassword(rt, cookies, "their usual password");

  const reset = await issueTemporaryPassword(rt, made.profileId, ADMIN);
  assert.equal(reset.status, "created");
  assert.notEqual(reset.temporaryPassword, made.temporaryPassword);
  assert.equal((await signIn(rt, jar(), "sarah.ahmed", "their usual password")).status, 401);
  session.resetSessionCache();
  assert.notEqual((await session.readSession(cookies, rt)).status, "ok", "the old session has ended");
  const fresh = jar();
  assert.equal((await signIn(rt, fresh, "sarah.ahmed", reset.temporaryPassword)).status, 200);
  assert.equal((await session.readSession(fresh, rt)).status, "password_change");
  assert.ok(rt.store.auditEntries().some((row) => row.action === "temporary_password_issued" && row.actorProfileId === ADMIN));
  assert.equal((await issueTemporaryPassword(rt, ADMIN, ADMIN)).reason, "not_eligible", "someone with no login");
});

test("disabling a login: it cannot sign in, a session already open ends at once, and it can be restored", async (t) => {
  quiet(t);
  const rt = runtime();
  const made = await createLogin(rt, family);
  const cookies = jar();
  await signIn(rt, cookies, "sarah.ahmed", made.temporaryPassword);
  await changePassword(rt, cookies, "their usual password");
  assert.equal(await setLoginDisabled(rt, made.profileId, true, ADMIN), true);
  session.resetSessionCache();
  assert.notEqual((await session.readSession(cookies, rt)).status, "ok");
  assert.equal((await signIn(rt, jar(), "sarah.ahmed", "their usual password")).status, 403);
  assert.equal((await rt.store.accounts.getAccount(made.profileId)).loginDisabled, true);

  assert.equal(await setLoginDisabled(rt, made.profileId, false, ADMIN), true);
  assert.equal((await signIn(rt, jar(), "sarah.ahmed", "their usual password")).status, 200);
  const actions = rt.store.auditEntries().map((row) => row.action);
  assert.ok(actions.includes("login_disabled") && actions.includes("login_enabled"));
});

test("a change of linked email is audited, follows to the children, and a bad address changes nothing", async () => {
  const rt = runtime();
  const parent = await createLogin(rt, family);
  const kid = await child(rt, parent);
  assert.equal((await changeLinkedEmail(rt, parent.profileId, "nope", ADMIN)).reason, "bad_email");
  assert.equal((await rt.store.accounts.getAccount(parent.profileId)).linkedEmail, "sarah@example.test");
  assert.equal((await changeLinkedEmail(rt, parent.profileId, "moved@example.test", ADMIN)).status, "changed");
  assert.equal((await rt.store.accounts.getAccount(kid.profileId)).linkedEmail, "moved@example.test");
  const row = rt.store.auditEntries().find((entry) => entry.action === "linked_email_changed");
  assert.ok(row);
  assert.ok(!JSON.stringify(row).includes("moved@example.test"), "ids only: never the address");
});

test("the Auth Admin API: the right requests, the secret key in the headers, and the answers mapped", async () => {
  const calls = [];
  const replies = [];
  const fetchFake = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(replies.shift() ?? { id: "u-1" }), { status: replies.status ?? 200 });
  };
  const admin = new SupabaseAccountAdmin({ url: "https://project.supabase.co/", serviceKey: "sb_secret_abcdefghijklmnop", fetch: fetchFake });

  assert.deepEqual(await admin.createUser({ email: "kit@accounts.learnthrivetuition.co.uk", password: "a temporary password", displayName: "Kit", adultConfirmed: false }), { ok: true, id: "u-1" });
  assert.equal(calls[0].url, "https://project.supabase.co/auth/v1/admin/users");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.email_confirm, true, "nobody opens a link at an internal address");
  assert.deepEqual(calls[0].body.user_metadata, { display_name: "Kit" }, "a learner is never marked an adult");
  assert.ok(Object.values(calls[0].headers).some((value) => String(value).includes("sb_secret_abcdefghijklmnop")));

  replies.push({ hashed_token: "tokenhash123" });
  assert.deepEqual(await admin.recoveryLink("kit@accounts.learnthrivetuition.co.uk"), { tokenHash: "tokenhash123" });
  assert.equal(calls[1].url, "https://project.supabase.co/auth/v1/admin/generate_link");
  assert.deepEqual(calls[1].body, { type: "recovery", email: "kit@accounts.learnthrivetuition.co.uk" });

  await admin.setDisabled("u-1", true);
  assert.equal(calls[2].method, "PUT");
  assert.match(calls[2].body.ban_duration, /^\d+h$/);
  await admin.setDisabled("u-1", false);
  assert.equal(calls[3].body.ban_duration, "none");
  await admin.setPassword("u-1", "a temporary password");
  assert.deepEqual(calls[4].body, { password: "a temporary password" });
  await admin.deleteUser("u-1");
  assert.equal(calls[5].method, "DELETE");
  assert.equal(calls[5].url, "https://project.supabase.co/auth/v1/admin/users/u-1");
});

test("the Auth Admin API: a taken address, a refused password and an outage each read as themselves", async () => {
  const answering = (status, body) => new SupabaseAccountAdmin({ url: "https://p.supabase.co", serviceKey: "sb_secret_x", fetch: async () => new Response(JSON.stringify(body), { status }) });
  const input = { email: "a@b.co", password: "x", displayName: "A", adultConfirmed: true };
  assert.equal((await answering(422, { error_code: "email_exists" }).createUser(input)).reason, "exists");
  assert.equal((await answering(422, { error_code: "weak_password" }).createUser(input)).reason, "weak_password");
  assert.equal((await answering(500, {}).createUser(input)).reason, "unavailable");
  const down = new SupabaseAccountAdmin({ url: "https://p.supabase.co", serviceKey: "sb_secret_x", fetch: async () => { throw new Error("network"); } });
  assert.equal((await down.createUser(input)).reason, "unavailable");
  assert.equal(await down.recoveryLink("a@b.co"), null);
  assert.equal(await down.setDisabled("u", true), false);
});

test("Supabase Auth: keeping the same password is refused as a weak one, and other sessions can be ended", async () => {
  const calls = [];
  const auth = new SupabaseAccountAuth({
    url: "https://p.supabase.co",
    anonKey: "sb_publishable_x",
    fetch: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ error_code: "same_password" }), { status: 422 });
    },
  });
  assert.deepEqual(await auth.updatePassword("token", "same as before"), { ok: false, reason: "weak_password" });
  await auth.signOutOthers("token");
  assert.equal(calls.at(-1), "https://p.supabase.co/auth/v1/logout?scope=others");
});

test("nothing written by the account flows carries a password, a token or an address in its logs", async (t) => {
  const lines = [];
  for (const method of ["log", "info", "warn", "error"]) t.mock.method(console, method, (...args) => lines.push(args.join(" ")));
  const rt = runtime();
  const made = await createLogin(rt, family);
  await signIn(rt, jar(), "sarah.ahmed", "this is the wrong password");
  await signIn(rt, jar(), "sarah.ahmed", made.temporaryPassword);
  await h.handleEmailLink(post("forgot", { username: "sarah.ahmed" }), { rt, jar: jar(), answerFloorMs: 0 }, "reset");
  const text = lines.join("\n");
  assert.ok(lines.length > 0, "the flows do log");
  for (const secret of [made.temporaryPassword, "sarah.ahmed", "sarah@example.test", rt.outbox.at(-1).tokenHash]) assert.ok(!text.includes(secret), "leaked into a log");
});
