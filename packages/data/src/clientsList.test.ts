import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SqlLibraryStore } from "./library";
import { createSqlDataProvider } from "./sqlProvider";
import { createFamily } from "./testing/fixtures";
import { createTestDb, type TestDb } from "./testing/pglite";

// The Parents list is parents. A family record is made on the quiet for any adult login that opens the library (ensureClient), so a tutor ends up
// with one; they must not show in People -> Parents unless they really are one.
describe("clients.list is parents only", () => {
  let db: TestDb;
  before(async () => { db = await createTestDb(); });
  after(() => db.close());

  test("a tutor's quiet family record is not a parent; a real parent is; a tutor who has a child linked is", async () => {
    const exec = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params)) };
    const data = createSqlDataProvider(exec);
    const store = new SqlLibraryStore(exec);
    const parent = await createFamily(db, { name: "Real Parent", students: ["Kid"] });
    const tutorUser = await db.createUser({ displayName: "Tutor Person", adult: true, role: "TUTOR" });
    await data.tutors.create({ userId: tutorUser, name: "Tutor Person", email: "", subjects: [], active: true });
    const tutorFamily = await store.accounts.ensureClient(tutorUser);   // what opening the library does

    const names = async () => (await data.clients.list()).map((c) => c.name).sort();
    assert.deepEqual(await names(), ["Real Parent"], "the tutor's empty family record is hidden");
    assert.equal((await data.clients.get(tutorFamily))?.name, "Tutor Person", "it still exists, for the library and billing");
    assert.equal((await data.clients.getByUserId(tutorUser))?.id, tutorFamily);

    // The tutor is also a parent: a child is linked to their family.
    await exec.query(`insert into public.students (client_id, display_name) values ($1, 'Their child')`, [tutorFamily]);
    assert.deepEqual(await names(), ["Real Parent", "Tutor Person"]);
    void parent;
  });
});
