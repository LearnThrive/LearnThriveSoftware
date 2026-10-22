import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";
import { environment, quiet } from "./_routeHelpers.mjs";

// Learner identity through the real route handlers on the in-memory backend (docs/IDENTITY.md): a guardian adds a student and invites
// them, the learner signs up and accepts, and every rule that follows is checked at the route: eligibility, consent, suspension,
// revocation, the guardian's blindness to a learner's conversations, the supervised view and leaving it, and forged identifiers.

const lh = loadTsFrom(import.meta.url, "../src/lib/learner/handlers.ts");
const ah = loadTsFrom(import.meta.url, "../src/lib/assistant/handlers.ts");
const cfgLib = loadTsFrom(import.meta.url, "../src/lib/assistant/config.ts");
const { MockProvider } = loadTsFrom(import.meta.url, "../src/lib/assistant/mock.ts");
const { GenerationQueue } = loadTsFrom(import.meta.url, "../src/lib/assistant/queue.ts");
const { MemoryLibraryStorage } = loadTsFrom(import.meta.url, "../src/lib/library/storage.ts");
const { MemoryAccountAuth } = loadTsFrom(import.meta.url, "../src/lib/account/memoryAuth.ts");
const { SignInLockout } = loadTsFrom(import.meta.url, "../src/lib/account/lockout.ts");
const session = loadTsFrom(import.meta.url, "../src/lib/account/session.ts");
const { InMemoryLibraryStore } = loadTsFrom(import.meta.url, "../../../packages/data/src/library/memory.ts");

const PASSWORD = "correct horse battery staple";
const NOW = new Date("2026-10-21T10:30:00Z");
const ENV = { NODE_ENV: "development", ASSISTANT_PROVIDER: "mock", ASSISTANT_MINORS_APPROVED: "true" };

async function world(t, env = ENV) {
  environment(t, {});
  quiet(t);
  session.resetSessionCache();
  lh.resetLearnerLimiters();
  const store = new InMemoryLibraryStore();
  const auth = new MemoryAccountAuth({ onUserCreated: (u) => store.seedProfile({ id: u.id, displayName: u.displayName, email: u.email, adultConfirmed: u.adultConfirmed }) });
  const rt = { backend: "memory", auth, store, lockout: new SignInLockout(), outbox: auth.outbox, memory: store };
  const assistant = { config: cfgLib.assistantConfig(env), provider: new MockProvider({ delayMs: 0 }), queue: new GenerationQueue(1, 4), uploads: new MemoryLibraryStorage(), hosted: false, flag: async () => {} };

  const newJar = () => {
    const map = new Map();
    return { get: (n) => map.get(n), set: (n, v) => map.set(n, v), delete: (n) => map.delete(n), map };
  };
  const request = (path, body, method = "POST") => new Request(`http://localhost:3100${path}`, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  const ld = (jar) => ({ rt, jar, env, now: () => NOW });
  const ad = (jar) => ({ rt, jar, assistant, env, now: () => NOW });
  const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });

  /** A confirmed account, signed in. `adult` false is how a learner signs up. */
  async function signedIn(adult = true) {
    const email = `u${Math.random().toString(36).slice(2)}@example.com`;
    await auth.signUp({ email, password: PASSWORD, displayName: "Pat", adultConfirmed: adult });
    const jar = newJar();
    const opened = await auth.verifyEmailLink(auth.outbox.findLast((m) => m.to === email).tokenHash, "signup");
    session.setSessionCookies(jar, opened.tokens, {});
    return { jar, id: opened.user.id, email };
  }

  async function guardian({ subscribed = true } = {}) {
    const g = await signedIn(true);
    g.clientId = await store.accounts.ensureClient(g.id);
    if (subscribed) store.seedEntitlement(g.id, "subscription", new Date(NOW.getTime() - 3_600_000), null);
    return g;
  }
  const addStudent = async (g, body) => (await json(await lh.handleCreateLearner(request("/api/learners", body), ld(g.jar))));
  const invite = async (g, studentId, body = {}) => json(await lh.handleInvite(request(`/api/learners/${studentId}/invite`, body), ld(g.jar), studentId));
  const tokenOf = (link) => new URL(link).searchParams.get("token");
  const chat = async (p, body, over = {}) => {
    const response = await ah.handleChat(request("/api/assistant/chat", body), { ...ad(p.jar), ...over });
    const text = await response.text();
    return { status: response.status, code: response.status === 200 ? null : JSON.parse(text).code, events: response.status === 200 ? text.trim().split("\n").map((l) => JSON.parse(l)) : [] };
  };
  const sessions = async (p) => json(await ah.handleSessions(new Request("http://localhost:3100/api/assistant/sessions"), ad(p.jar)));

  /** The whole path to a working learner: add, invite, sign up, confirm, accept. */
  async function learnerOf(g, { name = "Ava", yearGroup = "Year 10", isMinor = true } = {}) {
    const created = await addStudent(g, { displayName: name, yearGroup, isMinor });
    const studentId = created.body.student.id;
    const made = await invite(g, studentId);
    const token = tokenOf(made.body.link);
    const email = `kid${Math.random().toString(36).slice(2)}@example.com`;
    const signup = await json(await lh.handleLearnerSignUp(request("/api/learner/signup", { token, email, password: PASSWORD, displayName: name }), ld(newJar())));
    assert.equal(signup.status, 200, JSON.stringify(signup.body));
    const jar = newJar();
    const opened = await auth.verifyEmailLink(auth.outbox.findLast((m) => m.to === email).tokenHash, "signup");
    session.setSessionCookies(jar, opened.tokens, {});
    const accepted = await json(await lh.handleAcceptInvitation(request("/api/learner/accept", { token }), ld(jar)));
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    return { jar, id: opened.user.id, email, studentId, token };
  }

  return { store, auth, rt, newJar, request, ld, ad, json, signedIn, guardian, addStudent, invite, tokenOf, chat, sessions, learnerOf, assistant };
}

const grant = async (w, g, studentId, granted = true) => w.json(await lh.handleConsent(w.request(`/api/learners/${studentId}/consent`, { granted }), w.ld(g.jar), studentId));

test("onboarding: add a student, invite, the learner signs up without an adult declaration and accepts: one login, a STUDENT, no family account", async (t) => {
  const w = await world(t);
  const g = await w.guardian();
  const created = await w.addStudent(g, { displayName: "Ava", yearGroup: "Year 10", isMinor: true });
  assert.equal(created.status, 201);
  const studentId = created.body.student.id;

  const listed = await w.json(await lh.handleListLearners(w.request("/api/learners", null, "GET"), w.ld(g.jar)));
  assert.deepEqual(listed.body.students.map((s) => [s.displayName, s.accessMode, s.learnerStatus, s.canHaveOwnLogin, s.consent]), [["Ava", "none", null, true, false]]);
  assert.match(listed.body.consent.text, /parent or guardian/);

  const made = await w.invite(g, studentId, { email: "ava@example.com" });
  assert.equal(made.status, 201);
  assert.match(made.body.link, /\/learner\/accept\?token=/);
  const token = w.tokenOf(made.body.link);
  assert.equal((await w.json(await lh.handleInvitationPeek(w.request("/api/learner/invitation", { token }), w.ld(w.newJar())))).body.email, "ava@example.com");
  assert.equal((await w.json(await lh.handleInvitationPeek(w.request("/api/learner/invitation", { token: "nope" }), w.ld(w.newJar())))).status, 410);

  // Sign-up: the address must be the one the invitation names; the account is never marked as an adult.
  const wrong = await w.json(await lh.handleLearnerSignUp(w.request("/api/learner/signup", { token, email: "other@example.com", password: PASSWORD, displayName: "Ava" }), w.ld(w.newJar())));
  assert.equal(wrong.status, 422);
  assert.ok(wrong.body.errors.email);
  const weak = await w.json(await lh.handleLearnerSignUp(w.request("/api/learner/signup", { token, email: "ava@example.com", password: "short", displayName: "Ava" }), w.ld(w.newJar())));
  assert.equal(weak.status, 422);
  const ok = await w.json(await lh.handleLearnerSignUp(w.request("/api/learner/signup", { token, email: "ava@example.com", password: PASSWORD, displayName: "Ava" }), w.ld(w.newJar())));
  assert.equal(ok.status, 200);
  const profileId = w.auth.userIdFor("ava@example.com");
  assert.equal((await w.store.accounts.getAccount(profileId)).adultConfirmed, false, "never an adult");

  const jar = w.newJar();
  const opened = await w.auth.verifyEmailLink(w.auth.outbox.findLast((m) => m.to === "ava@example.com").tokenHash, "signup");
  session.setSessionCookies(jar, opened.tokens, {});
  // Signed out nobody can accept; signed in as the wrong person (another address) is refused.
  assert.equal((await w.json(await lh.handleAcceptInvitation(w.request("/api/learner/accept", { token }), w.ld(w.newJar())))).status, 401);
  const stranger = await w.signedIn(true);
  assert.equal((await w.json(await lh.handleAcceptInvitation(w.request("/api/learner/accept", { token }), w.ld(stranger.jar)))).body.code, "email_mismatch");
  const accepted = await w.json(await lh.handleAcceptInvitation(w.request("/api/learner/accept", { token }), w.ld(jar)));
  assert.equal(accepted.status, 200);

  const account = await w.store.accounts.getAccount(profileId);
  assert.equal(account.role, "STUDENT");
  assert.equal(account.clientId, null);
  assert.equal(account.learner.familyClientId, g.clientId);
  // Replay: the same link again, from the same or another signed-in account, fails.
  assert.equal((await w.json(await lh.handleAcceptInvitation(w.request("/api/learner/accept", { token }), w.ld(jar)))).status, 410);
  assert.equal((await w.json(await lh.handleInvitationPeek(w.request("/api/learner/invitation", { token }), w.ld(w.newJar())))).status, 410);
});

test("a learner is not an adult account holder: no learner management, and the guardian controls are closed to them", async (t) => {
  const w = await world(t);
  const g = await w.guardian();
  const kid = await w.learnerOf(g);
  const other = await w.addStudent(g, { displayName: "Ben", yearGroup: "Year 11" });
  for (const call of [
    () => lh.handleListLearners(w.request("/api/learners", null, "GET"), w.ld(kid.jar)),
    () => lh.handleCreateLearner(w.request("/api/learners", { displayName: "X" }), w.ld(kid.jar)),
    () => lh.handleInvite(w.request(`/api/learners/${other.body.student.id}/invite`, {}), w.ld(kid.jar), other.body.student.id),
    () => lh.handleLearnerStatus(w.request(`/api/learners/${kid.studentId}/status`, { status: "active" }), w.ld(kid.jar), kid.studentId),
    () => lh.handleConsent(w.request(`/api/learners/${kid.studentId}/consent`, { granted: true }), w.ld(kid.jar), kid.studentId),
  ]) {
    const r = await w.json(await call());
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "adult_required");
  }
  assert.equal((await w.store.identity.listFamilyStudents(g.clientId)).length, 2, "nothing was added or changed");
  assert.equal(await w.store.identity.hasLearnerConsent(kid.studentId), false, "a learner cannot consent for themselves");
});

test("another family cannot invite, change or even find this family's learners; forged ids change nothing", async (t) => {
  const w = await world(t);
  const g = await w.guardian();
  const kid = await w.learnerOf(g);
  const intruder = await w.guardian();
  const calls = [
    await w.invite(intruder, kid.studentId),
    await w.json(await lh.handleSetAccess(w.request(`/api/learners/${kid.studentId}/access`, { mode: "supervised" }), w.ld(intruder.jar), kid.studentId)),
    await w.json(await lh.handleLearnerStatus(w.request(`/api/learners/${kid.studentId}/status`, { status: "revoked" }), w.ld(intruder.jar), kid.studentId)),
    await w.json(await lh.handleConsent(w.request(`/api/learners/${kid.studentId}/consent`, { granted: true }), w.ld(intruder.jar), kid.studentId)),
    await w.json(await lh.handleStartView(w.request("/api/learner/view", { studentId: kid.studentId }), w.ld(intruder.jar))),
  ];
  for (const r of calls) assert.equal(r.status, 404);
  assert.equal((await w.store.accounts.getAccount(kid.id)).learner.status, "active");
  assert.deepEqual((await w.json(await lh.handleListLearners(w.request("/api/learners", null, "GET"), w.ld(intruder.jar)))).body.students, []);
  assert.equal((await w.json(await lh.handleDeleteLearnerChats(w.request(`/api/learners/${kid.studentId}/chats/delete`, {}), w.ld(intruder.jar), kid.studentId))).body.deleted, 0);
  assert.equal((await w.json(await lh.handleInvite(w.request("/api/learners/not-a-uuid/invite", {}), w.ld(g.jar), "not-a-uuid"))).status, 404);
});

test("a too-young learner gets the supervised view, not a login; invitations are limited and revocable", async (t) => {
  const w = await world(t);
  const g = await w.guardian();
  const young = (await w.addStudent(g, { displayName: "Kit", yearGroup: "Year 3", isMinor: true })).body.student.id;
  const refused = await w.invite(g, young);
  assert.equal(refused.status, 422);
  assert.equal(refused.body.code, "supervised_only");
  const older = (await w.addStudent(g, { displayName: "Una", yearGroup: "Year 9" })).body.student.id;
  const noYear = (await w.addStudent(g, { displayName: "Vic", yearGroup: "" })).body.student.id;
  assert.equal((await w.invite(g, noYear)).status, 422, "an unknown year group is supervised only");
  const first = await w.invite(g, older);
  assert.equal(first.status, 201);
  const second = await w.invite(g, older);
  assert.equal((await w.json(await lh.handleInvitationPeek(w.request("/api/learner/invitation", { token: w.tokenOf(first.body.link) }), w.ld(w.newJar())))).status, 410, "re-inviting replaces the earlier link");
  assert.equal((await w.json(await lh.handleRevokeInvitation(w.request(`/api/learners/invitations/${second.body.invitationId}`, null, "DELETE"), w.ld(g.jar), second.body.invitationId))).status, 200);
  assert.equal((await w.json(await lh.handleInvitationPeek(w.request("/api/learner/invitation", { token: w.tokenOf(second.body.link) }), w.ld(w.newJar())))).status, 410);
  for (let i = 0; i < 2; i += 1) assert.equal((await w.invite(g, older)).status, 201);
  assert.equal((await w.invite(g, older)).status, 201);
  assert.equal((await w.invite(g, older)).status, 429, "the fifth invitation of the day is the last");
  assert.equal((await w.addStudent(g, { displayName: "mail@example.com" })).status, 422, "a first name, never an address");
});

test("Study Buddy for a learner: closed until the deployment, the guardian's consent and the login are all in place, and each can close it again at once", async (t) => {
  const approved = await world(t);
  const g = await approved.guardian();
  const kid = await approved.learnerOf(g);
  const body = { text: "hello" };

  assert.equal((await approved.chat(kid, body)).code, "consent_needed", "approved deployment, but no guardian consent yet");
  assert.equal((await grant(approved, g, kid.studentId)).status, 200);
  const first = await approved.chat(kid, body);
  assert.equal(first.status, 200, "consent given, login active, household has a subscription");
  assert.equal(first.events[0].type, "session");

  // The learner's own conversation is theirs: stored against the learner, not the guardian's own list.
  const mine = await approved.sessions(kid);
  assert.equal(mine.body.sessions.length, 1);
  const learnerSession = mine.body.sessions[0].id;
  assert.equal((await approved.sessions(g)).body.sessions.length, 0, "the guardian's own list does not hold the learner's chat");
  const peek = await approved.json(await ah.handleSession(new Request(`http://localhost:3100/api/assistant/sessions/${learnerSession}`), approved.ad(g.jar), learnerSession));
  assert.equal(peek.status, 404, "and cannot be opened by id");
  assert.equal((await approved.json(await ah.handleExport(new Request("http://localhost:3100/api/assistant/export"), approved.ad(g.jar)))).body.sessions.length, 0, "nor exported");
  const sibling = await approved.learnerOf(g, { name: "Ben", yearGroup: "Year 11" });
  await grant(approved, g, sibling.studentId);
  assert.equal((await approved.json(await ah.handleSession(new Request(`http://localhost:3100/api/assistant/sessions/${learnerSession}`), approved.ad(sibling.jar), learnerSession))).status, 404, "a sibling cannot open it");
  assert.equal((await approved.sessions(sibling)).body.sessions.length, 0);

  // Forged identifiers in the body choose nothing: the chat is still the learner's, and the guardian's student id changes nothing.
  const forged = await approved.chat(kid, { text: "hi", studentId: sibling.studentId, clientId: "00000000-0000-4000-8000-000000000000", role: "ADMIN" });
  assert.equal(forged.status, 200);
  assert.equal((await approved.sessions(sibling)).body.sessions.length, 0, "no chat landed with the sibling");

  // Each closes it again, at once.
  assert.equal((await approved.json(await lh.handleLearnerStatus(approved.request(`/api/learners/${kid.studentId}/status`, { status: "suspended" }), approved.ld(g.jar), kid.studentId))).status, 200);
  assert.equal((await approved.chat(kid, body)).code, "learner_unavailable", "suspended");
  assert.equal((await approved.sessions(kid)).status, 403, "and the history is closed too");
  await lh.handleLearnerStatus(approved.request(`/api/learners/${kid.studentId}/status`, { status: "active" }), approved.ld(g.jar), kid.studentId);
  assert.equal((await approved.chat(kid, body)).status, 200, "restored");
  assert.equal((await grant(approved, g, kid.studentId, false)).body.consent, false);
  assert.equal((await approved.chat(kid, body)).code, "consent_needed", "consent withdrawn");
  await grant(approved, g, kid.studentId, true);
  await lh.handleLearnerStatus(approved.request(`/api/learners/${kid.studentId}/status`, { status: "revoked" }), approved.ld(g.jar), kid.studentId);
  assert.equal((await approved.chat(kid, body)).code, "learner_unavailable", "revoked");
  // The old session cookie is still valid: the refusal is the live check, not a logout.
  assert.equal((await session.readSession(kid.jar, approved.rt)).status, "ok");

  const closed = await world(t, { ...ENV, ASSISTANT_MINORS_APPROVED: "false" });
  const g2 = await closed.guardian();
  const kid2 = await closed.learnerOf(g2);
  await grant(closed, g2, kid2.studentId);
  assert.equal((await closed.chat(kid2, body)).code, "learner_unavailable", "a deployment not approved for children stays closed whatever the consent says");
});

test("an adult learner needs no children's approval and no guardian consent, but still the account holder's household benefit", async (t) => {
  const w = await world(t, { ...ENV, ASSISTANT_MINORS_APPROVED: "false" });
  const g = await w.guardian();
  const adult = await w.learnerOf(g, { name: "Alex", yearGroup: "A Level", isMinor: false });
  const first = await w.chat(adult, { text: "hello" });
  assert.equal(first.code, "adult_confirmation", "until children are approved, a new chat asks the adult to confirm they are the one using it");
  assert.equal((await w.chat(adult, { text: "hello", adultAck: true })).status, 200);
  const none = await world(t, { ...ENV, ASSISTANT_MINORS_APPROVED: "false" });
  const g2 = await none.guardian({ subscribed: false });
  const adult2 = await none.learnerOf(g2, { name: "Alex", yearGroup: "A Level", isMinor: false });
  assert.equal((await none.chat(adult2, { text: "hello", adultAck: true })).code, "no_access", "no household entitlement, no Study Buddy");
});

test("supervised view: the guardian signs in and chooses a young learner; the chat is the learner's; adult operations are closed until they leave with their password", async (t) => {
  const w = await world(t);
  const g = await w.guardian();
  const kitId = (await w.addStudent(g, { displayName: "Kit", yearGroup: "Year 3", isMinor: true })).body.student.id;
  const start = async (jar, id = kitId) => w.json(await lh.handleStartView(w.request("/api/learner/view", { studentId: id }), w.ld(jar)));
  assert.equal((await start(g.jar)).status, 404, "the student is not set to supervised yet");
  assert.equal((await w.json(await lh.handleSetAccess(w.request(`/api/learners/${kitId}/access`, { mode: "direct" }), w.ld(g.jar), kitId))).status, 400, "direct only ever comes from an accepted invitation");
  assert.equal((await w.json(await lh.handleSetAccess(w.request(`/api/learners/${kitId}/access`, { mode: "supervised" }), w.ld(g.jar), kitId))).status, 200);

  assert.equal((await w.chat(g, { text: "hello", adultAck: true })).status, 200, "the guardian's own chat works as before");
  const own = (await w.sessions(g)).body.sessions.length;
  assert.equal(own, 1);

  assert.equal((await grant(w, g, kitId)).status, 200, "consent is given from the guardian's own session, before the view");
  assert.equal((await w.json(await lh.handleStartView(w.request("/api/learner/view", { studentId: kitId }), w.ld(g.jar)))).status, 200);
  assert.ok(g.jar.get("learnthrive_learner"), "an opaque cookie, no student id in it");
  assert.ok(!String(g.jar.get("learnthrive_learner")).includes(kitId));
  await w.store.identity.withdrawLearnerConsent(kitId, NOW);
  assert.equal((await w.chat(g, { text: "hello" })).code, "consent_needed", "supervising needs the guardian's consent for a minor, like a login does; withdrawing closes it");
  await w.store.identity.grantLearnerConsent({ studentId: kitId, guardianProfileId: g.id, version: "1", textSha256: "a".repeat(64), now: NOW });
  const inView = await w.chat(g, { text: "what is 2+2?" });
  assert.equal(inView.status, 200);
  assert.equal((await w.sessions(g)).body.sessions.length, 1, "in the view the guardian sees the LEARNER's chats (just the one just made), not their own");

  // Inside the view nothing adult works.
  for (const call of [
    () => lh.handleListLearners(w.request("/api/learners", null, "GET"), w.ld(g.jar)),
    () => lh.handleCreateLearner(w.request("/api/learners", { displayName: "X" }), w.ld(g.jar)),
    () => lh.handleLearnerStatus(w.request(`/api/learners/${kitId}/status`, { status: "revoked" }), w.ld(g.jar), kitId),
  ]) {
    const r = await w.json(await call());
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "leave_learner_view");
  }
  // A child cannot leave by guessing: the password is required, and a wrong one counts against lockout.
  assert.equal((await w.json(await lh.handleLeaveView(w.request("/api/learner/view/leave", { password: "wrong password here" }), w.ld(g.jar)))).status, 401);
  assert.ok(g.jar.get("learnthrive_learner"), "still in the view");
  assert.equal((await w.json(await lh.handleLeaveView(w.request("/api/learner/view/leave", {}), w.ld(g.jar)))).status, 400);
  const left = await w.json(await lh.handleLeaveView(w.request("/api/learner/view/leave", { password: PASSWORD }), w.ld(g.jar)));
  assert.equal(left.status, 200);
  assert.equal(g.jar.get("learnthrive_learner"), undefined);
  // Back as the guardian: their own chat only; the learner's conversation is out of reach.
  const back = await w.sessions(g);
  assert.equal(back.body.sessions.length, 1);
  assert.equal((await w.store.chat.listSessions({ clientId: g.clientId, studentId: kitId })).length, 1, "the learner's chat exists");
  assert.equal((await w.json(await lh.handleListLearners(w.request("/api/learners", null, "GET"), w.ld(g.jar)))).status, 200);
  // Changing the way in closes any open view.
  await lh.handleStartView(w.request("/api/learner/view", { studentId: kitId }), w.ld(g.jar));
  // (the management routes are closed inside a view: change it from the store, as staff would)
  await w.store.identity.setAccessMode(g.clientId, kitId, "none", g.id, NOW);
  assert.equal((await w.chat(g, { text: "again" })).status, 200, "an ended view falls back to the guardian's own session");
  assert.equal(g.jar.get("learnthrive_learner"), undefined, "and the stale cookie is dropped");
});

test("the guardian may delete a learner's conversations but never read them", async (t) => {
  const w = await world(t);
  const g = await w.guardian();
  const kid = await w.learnerOf(g);
  await grant(w, g, kid.studentId);
  assert.equal((await w.chat(kid, { text: "hello" })).status, 200);
  assert.equal((await w.sessions(kid)).body.sessions.length, 1);
  assert.equal((await w.json(await lh.handleDeleteLearnerChats(w.request(`/api/learners/${kid.studentId}/chats/delete`, {}), w.ld(g.jar), kid.studentId))).body.deleted, 1);
  assert.equal((await w.sessions(kid)).body.sessions.length, 0);
});
