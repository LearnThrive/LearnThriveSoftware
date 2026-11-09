import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createSqlSafeguarding } from "./safeguarding";
import { createSqlDataProvider } from "./sqlProvider";
import { createTestDb, type TestDb } from "./testing/pglite";
import { safeguardingContract } from "./testing/safeguardingContract";

const executorOf = (db: TestDb) => ({ query: <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params)) });

safeguardingContract("sql on PGlite", async () => {
  const db = await createTestDb();
  const executor = executorOf(db);
  const provider = createSqlDataProvider(executor);
  return {
    close: () => db.close(),
    harness: {
      repo: createSqlSafeguarding(executor),
      tutor: async () => (await provider.tutors.create({ name: "Tutor", email: `${randomUUID()}@example.test`, subjects: ["Maths"], active: true })).id,
      login: async () => db.createUser({ displayName: "Login", adult: true }),
    },
  };
});

describe("safeguarding tables in Postgres", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.close());

  const TABLES = ["tutor_vetting_checks", "safeguarding_concerns", "safeguarding_concern_events"];

  test("neither a signed-in user nor an anonymous visitor can read or write any of them through the API roles", async () => {
    const userId = await db.createUser({ displayName: "Tutor", adult: true });
    for (const t of TABLES) {
      await assert.rejects(db.asUser(userId, (q) => q.query(`select 1 from public.${t}`)), `authenticated can read ${t}`);
      await assert.rejects(db.asAnon((q) => q.query(`select 1 from public.${t}`)), `anon can read ${t}`);
      await assert.rejects(db.asUser(userId, (q) => q.query(`delete from public.${t}`)), `authenticated can delete from ${t}`);
    }
  });

  test("the database itself refuses to edit or delete a concern, or to touch its history", async () => {
    const executor = executorOf(db);
    const repo = createSqlSafeguarding(executor);
    const c = await repo.concerns.create({
      raisedBy: "tutor-1", raisedByRole: "TUTOR", category: "OTHER", about: "A learner", studentRef: null, lessonRef: null, details: "Something that needs a lead to look at it.", immediateDanger: false,
    });
    await repo.concerns.appendEvent({ concernId: c.id, actorId: "tutor-1", kind: "RAISED" });
    await assert.rejects(executor.query("update public.safeguarding_concerns set details = 'rewritten afterwards' where id = $1", [c.id]), /cannot be edited/);
    await assert.rejects(executor.query("update public.safeguarding_concerns set about = 'someone else' where id = $1", [c.id]), /cannot be edited/);
    await assert.rejects(executor.query("delete from public.safeguarding_concerns where id = $1", [c.id]), /never deleted/);
    await assert.rejects(executor.query("update public.safeguarding_concern_events set note = 'changed'"), /append-only/);
    await assert.rejects(executor.query("delete from public.safeguarding_concern_events"), /append-only/);
    assert.equal((await repo.concerns.setStatus(c.id, "IN_REVIEW")).status, "IN_REVIEW", "the status is the one thing that moves");
    assert.equal((await repo.concerns.get(c.id))?.details, "Something that needs a lead to look at it.");
  });

  test("the database refuses a certificate number even if the application check were bypassed", async () => {
    const executor = executorOf(db);
    const tutor = await createSqlDataProvider(executor).tutors.create({ name: "Tutor", email: "t@example.test", subjects: [], active: true });
    await assert.rejects(executor.query(
      "insert into public.tutor_vetting_checks (tutor_id, kind, checked_on, how) values ($1, 'DBS', '2026-11-01', 'Certificate 001234567890')", [tutor.id],
    ));
  });

  test("a tutor's vetting rows go when the tutor's record is deleted; a concern does not depend on anyone's record", async () => {
    const executor = executorOf(db);
    const repo = createSqlSafeguarding(executor);
    const tutor = await createSqlDataProvider(executor).tutors.create({ name: "Leaver", email: "leaver@example.test", subjects: [], active: true });
    await repo.vetting.record({ tutorId: tutor.id, kind: "DBS", checkedOn: "2026-10-01", expiresOn: null, how: "Update Service", note: "", recordedBy: "x" }, "2026-11-09");
    const c = await repo.concerns.create({
      raisedBy: tutor.id, raisedByRole: "TUTOR", category: "OTHER", about: "A learner", studentRef: null, lessonRef: null, details: "Raised by a tutor who later leaves.", immediateDanger: false,
    });
    await executor.query("delete from public.tutors where id = $1", [tutor.id]);
    assert.deepEqual(await repo.vetting.list(tutor.id), []);
    assert.equal((await repo.concerns.get(c.id))?.raisedBy, tutor.id, "the safeguarding record is kept as written");
  });
});
