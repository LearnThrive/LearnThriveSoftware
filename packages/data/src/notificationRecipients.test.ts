import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SqlLibraryStore } from "./library";
import { createSqlDataProvider } from "./sqlProvider";
import { createTestDb, type TestDb } from "./testing/pglite";

// A notification is addressed to a real login. notifications.user_id references public.profiles, so a recipient that is not a real account
// does not merely go unread: the insert fails, and the report or lesson that raised it fails with it.

describe("who a notification goes to", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.close());

  const owner = <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params));
  const executor = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => owner<T>(sql, params) };

  test("a tutor, family or learner record resolves to its login; a record with no login to nobody", async () => {
    const p = createSqlDataProvider(executor);
    const store = new SqlLibraryStore(executor);
    const tutorLogin = await db.createUser({ displayName: "Tara", adult: true, role: "TUTOR" });
    const tutor = await p.tutors.create({ userId: tutorLogin, name: "Tara", email: "", subjects: [], active: true });
    assert.equal(await p.notifications.recipientFor(tutor.id), tutorLogin);

    const noLogin = await p.tutors.create({ name: "Not yet", email: "", subjects: [], active: true });
    assert.equal(await p.notifications.recipientFor(noLogin.id), null);

    const guardian = await db.createUser({ displayName: "Parent", adult: true });
    const clientId = await store.accounts.ensureClient(guardian);
    assert.equal(await p.notifications.recipientFor(clientId), guardian);

    const student = (await owner<{ id: string }>("insert into public.students (client_id, display_name) values ($1, 'Kid') returning id", [clientId]))[0]!.id;
    assert.equal(await p.notifications.recipientFor(student), null, "a child with no login of their own");
    const learner = await db.createUser({ displayName: "Kid", adult: false });
    await owner("insert into public.learner_identities (student_id, profile_id) values ($1, $2)", [student, learner]);
    assert.equal(await p.notifications.recipientFor(student), learner);
    await owner("update public.learner_identities set status = 'suspended' where student_id = $1", [student]);
    assert.equal(await p.notifications.recipientFor(student), null, "a suspended learner is not addressed");

    assert.equal(await p.notifications.recipientFor("not-a-uuid"), null);
  });

  test("a role resolves to its real logins, leaves out a disabled one, and each can actually be sent to", async () => {
    const p = createSqlDataProvider(executor);
    const store = new SqlLibraryStore(executor);
    const first = await db.createUser({ displayName: "One", adult: true, role: "ADMIN" });
    const second = await db.createUser({ displayName: "Two", adult: true, role: "ADMIN" });
    await store.accounts.setLoginDisabled(second, new Date());
    const admins = await p.notifications.recipientsWithRole("ADMIN");
    assert.ok(admins.includes(first));
    assert.ok(!admins.includes(second), "a disabled administrator is not addressed");
    for (const userId of admins) await p.notifications.create({ userId, type: "REPORT_AWAITING_APPROVAL", message: "A report is waiting." });
    assert.equal((await p.notifications.forUser(first)).length, 1);
  });

  test("a recipient that is not a real login fails at the database: why this cannot go through a made-up id", async () => {
    const p = createSqlDataProvider(executor);
    await assert.rejects(p.notifications.create({ userId: "d0000000-0000-4000-8000-000000000001", type: "REPORT_AWAITING_APPROVAL", message: "x" }), /foreign key/i);
  });
});
