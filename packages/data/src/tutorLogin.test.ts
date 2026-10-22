import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SqlLibraryStore } from "./library";
import { createSqlDataProvider } from "./sqlProvider";
import { createTestDb, type TestDb } from "./testing/pglite";

// Giving a tutor record a login: nobody is converted by guessing. Only a plain, confirmed account with that address becomes the tutor.

describe("linking a tutor's login", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.close());

  const owner = <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params));
  const executor = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => owner<T>(sql, params) };
  const email = async (id: string) => (await owner<{ email: string }>("select email from auth.users where id = $1", [id]))[0]!.email;

  test("a plain confirmed account becomes the tutor: role TUTOR, found by login, audited; a second link is refused", async () => {
    const p = createSqlDataProvider(executor);
    const admin = await db.createUser({ displayName: "Admin", adult: true, role: "ADMIN" });
    const login = await db.createUser({ displayName: "Tara", adult: false });
    const tutor = await p.tutors.create({ name: "Tara", email: "", subjects: ["Maths"], active: true });
    assert.equal(await p.tutors.linkLogin(tutor.id, (await email(login)).toUpperCase(), admin), "ok", "the address is matched without regard to case");
    assert.equal((await p.tutors.getByUserId(login))?.id, tutor.id);
    assert.equal((await p.tutors.get(tutor.id))?.email, await email(login), "the sign-in address is now the tutor's address");
    assert.deepEqual(await owner("select role from public.profiles where id = $1", [login]), [{ role: "TUTOR" }]);
    assert.ok((await owner("select 1 from public.identity_audit where action = 'tutor_login_linked' and actor_profile_id = $1", [admin])).length >= 1);
    const other = await db.createUser({ displayName: "Other", adult: false });
    assert.equal(await p.tutors.linkLogin(tutor.id, await email(other), admin), "not_eligible", "a tutor who already has a login");
    assert.deepEqual(await owner("select role from public.profiles where id = $1", [other]), [{ role: "CLIENT" }], "nobody else was converted");
  });

  test("the people who cannot be made a tutor: a family owner, a learner, staff, an unconfirmed or unknown address, a made-up tutor", async () => {
    const p = createSqlDataProvider(executor);
    const store = new SqlLibraryStore(executor);
    const admin = await db.createUser({ displayName: "Admin2", adult: true, role: "ADMIN" });
    const tutor = await p.tutors.create({ name: "Someone", email: "", subjects: [], active: true });

    const familyOwner = await db.createUser({ displayName: "Parent", adult: true });
    await store.accounts.ensureClient(familyOwner);
    assert.equal(await p.tutors.linkLogin(tutor.id, await email(familyOwner), admin), "not_eligible");

    const staff = await db.createUser({ displayName: "Staff", adult: true, role: "ADMIN" });
    assert.equal(await p.tutors.linkLogin(tutor.id, await email(staff), admin), "not_eligible");

    const guardian = await db.createUser({ displayName: "G", adult: true });
    const clientId = await store.accounts.ensureClient(guardian);
    const student = (await owner<{ id: string }>("insert into public.students (client_id, display_name) values ($1, 'Kid') returning id", [clientId]))[0]!.id;
    const learner = await db.createUser({ displayName: "Kid", adult: false });
    await owner("insert into public.learner_identities (student_id, profile_id) values ($1, $2)", [student, learner]);
    assert.equal(await p.tutors.linkLogin(tutor.id, await email(learner), admin), "not_eligible", "a learner is never a tutor");

    const unconfirmed = await db.createUser({ displayName: "Un", adult: false });
    await owner("update auth.users set email_confirmed_at = null where id = $1", [unconfirmed]);
    assert.equal(await p.tutors.linkLogin(tutor.id, await email(unconfirmed), admin), "no_account", "an unconfirmed address proves nothing");
    assert.equal(await p.tutors.linkLogin(tutor.id, "nobody@example.test", admin), "no_account");
    assert.equal(await p.tutors.linkLogin("00000000-0000-4000-8000-000000000000", await email(unconfirmed), admin), "no_tutor");
    assert.equal(await p.tutors.linkLogin("not-a-uuid", "a@b.test", admin), "no_tutor");
    assert.equal((await p.tutors.get(tutor.id))?.userId, undefined, "still no login");
  });
});
