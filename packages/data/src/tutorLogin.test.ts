import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SqlLibraryStore } from "./library";
import { createSqlDataProvider } from "./sqlProvider";
import { createTestDb, type TestDb } from "./testing/pglite";

// Giving a tutor record a login: nobody is converted by guessing, and nobody is demoted. A plain account becomes the tutor; an administrator
// stays an administrator and gains the tutor tools (docs/ROLE_PERMISSIONS.md).

describe("linking a tutor's login", () => {
  let db: TestDb;
  let n = 0;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.close());

  const owner = <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params));
  const executor = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => owner<T>(sql, params) };
  const withUsername = async (id: string) => {
    const username = `person-${(n += 1)}`;
    await owner("update public.profiles set username = $2, linked_email = $3 where id = $1", [id, username, `${username}@example.test`]);
    return username;
  };

  test("a plain account becomes the tutor: role TUTOR, found by login, audited; a second link is refused", async () => {
    const p = createSqlDataProvider(executor);
    const admin = await db.createUser({ displayName: "Admin", adult: true, role: "ADMIN" });
    const login = await db.createUser({ displayName: "Tara", adult: false });
    const name = await withUsername(login);
    const tutor = await p.tutors.create({ name: "Tara", email: "", subjects: ["Maths"], active: true });
    assert.equal(await p.tutors.linkLogin(tutor.id, name.toUpperCase(), admin), "ok", "the username is matched without regard to case");
    assert.equal((await p.tutors.getByUserId(login))?.id, tutor.id);
    assert.equal((await p.tutors.get(tutor.id))?.email, `${name}@example.test`, "the linked address is now the tutor's address");
    assert.deepEqual(await owner("select role from public.profiles where id = $1", [login]), [{ role: "TUTOR" }]);
    assert.ok((await owner("select 1 from public.identity_audit where action = 'tutor_login_linked' and actor_profile_id = $1", [admin])).length >= 1);
    const other = await db.createUser({ displayName: "Other", adult: false });
    assert.equal(await p.tutors.linkLogin(tutor.id, await withUsername(other), admin), "not_eligible", "a tutor who already has a login");
    assert.deepEqual(await owner("select role from public.profiles where id = $1", [other]), [{ role: "CLIENT" }], "nobody else was converted");
  });

  test("an administrator can be linked and stays an administrator, with a tutor record they teach as", async () => {
    const p = createSqlDataProvider(executor);
    const store = new SqlLibraryStore(executor);
    const actor = await db.createUser({ displayName: "Admin", adult: true, role: "ADMIN" });
    const teacher = await db.createUser({ displayName: "Teaching Admin", adult: true, role: "ADMIN" });
    const tutor = await p.tutors.create({ name: "Teaching Admin", email: "", subjects: ["Maths"], active: true });
    assert.equal(await p.tutors.linkLogin(tutor.id, await withUsername(teacher), actor), "ok");
    assert.deepEqual(await owner("select role from public.profiles where id = $1", [teacher]), [{ role: "ADMIN" }], "linking never demotes");
    assert.equal(await store.accounts.tutorRef(teacher), tutor.id);
    await p.tutors.update(tutor.id, { active: false });
    assert.equal(await store.accounts.tutorRef(teacher), null, "an administrator whose tutor record has stopped no longer teaches");
  });

  test("the people who cannot be made a tutor: a family owner, a learner, a tutor, an unknown username, a made-up tutor", async () => {
    const p = createSqlDataProvider(executor);
    const store = new SqlLibraryStore(executor);
    const admin = await db.createUser({ displayName: "Admin2", adult: true, role: "ADMIN" });
    const tutor = await p.tutors.create({ name: "Someone", email: "", subjects: [], active: true });

    const familyOwner = await db.createUser({ displayName: "Parent", adult: true });
    await store.accounts.ensureClient(familyOwner);
    assert.equal(await p.tutors.linkLogin(tutor.id, await withUsername(familyOwner), admin), "not_eligible");

    const adminFamily = await db.createUser({ displayName: "Admin parent", adult: true, role: "ADMIN" });
    await store.accounts.ensureClient(adminFamily);
    assert.equal(await p.tutors.linkLogin(tutor.id, await withUsername(adminFamily), admin), "not_eligible", "an administrator who owns a family");

    const staff = await db.createUser({ displayName: "Staff", adult: true, role: "TUTOR" });
    assert.equal(await p.tutors.linkLogin(tutor.id, await withUsername(staff), admin), "not_eligible", "a tutor is not made another tutor");

    const guardian = await db.createUser({ displayName: "G", adult: true });
    const clientId = await store.accounts.ensureClient(guardian);
    const student = (await owner<{ id: string }>("insert into public.students (client_id, display_name) values ($1, 'Kid') returning id", [clientId]))[0]!.id;
    const learner = await db.createUser({ displayName: "Kid", adult: false });
    await owner("insert into public.learner_identities (student_id, profile_id) values ($1, $2)", [student, learner]);
    assert.equal(await p.tutors.linkLogin(tutor.id, await withUsername(learner), admin), "not_eligible", "a learner is never a tutor");

    assert.equal(await p.tutors.linkLogin(tutor.id, "nobody-here", admin), "no_account");
    assert.equal(await p.tutors.linkLogin("00000000-0000-4000-8000-000000000000", "nobody-here", admin), "no_tutor");
    assert.equal(await p.tutors.linkLogin("not-a-uuid", "nobody-here", admin), "no_tutor");
    assert.equal((await p.tutors.get(tutor.id))?.userId, undefined, "still no login");
  });
});
