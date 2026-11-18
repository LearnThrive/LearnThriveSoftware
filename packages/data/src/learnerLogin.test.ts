import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SqlLibraryStore } from "./library";
import { createSqlDataProvider } from "./sqlProvider";
import { createTestDb, type TestDb } from "./testing/pglite";

// A tutor who is also a student: the tutor's own login becomes the student's learner login, so one sign-in holds both, and the STUDENT role can
// then be added (a role needs its record first: docs/ROLE_PERMISSIONS.md). Nobody is converted by guessing, and nothing is taken from anyone.

describe("linking an existing login as a student's own login", () => {
  let db: TestDb;
  let n = 0;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.close());

  const owner = <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params));
  const executor = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => owner<T>(sql, params) };
  const withUsername = async (id: string) => {
    const username = `learner-link-${(n += 1)}`;
    await owner("update public.profiles set username = $2, linked_email = $3 where id = $1", [id, username, `${username}@example.test`]);
    return username;
  };
  /** A family with one student, and the student's id. */
  const familyStudent = async (store: SqlLibraryStore) => {
    const guardian = await db.createUser({ displayName: "Guardian", adult: true });
    const clientId = await store.accounts.ensureClient(guardian);
    const studentId = (await owner<{ id: string }>("insert into public.students (client_id, display_name) values ($1, 'Student') returning id", [clientId]))[0]!.id;
    return { guardian, clientId, studentId };
  };
  /** A tutor with a login: a plain account linked to a new tutor record. */
  const tutorLogin = async (p: ReturnType<typeof createSqlDataProvider>, admin: string) => {
    const login = await db.createUser({ displayName: "Tara", adult: false });
    const username = await withUsername(login);
    const tutor = await p.tutors.create({ name: "Tara", email: "", subjects: ["Maths"], active: true });
    assert.equal(await p.tutors.linkLogin(tutor.id, username, admin), "ok");
    return { login, username, tutorId: tutor.id };
  };

  test("a tutor's login becomes the student's login, is audited, and then holds the tutor and the student roles together", async () => {
    const p = createSqlDataProvider(executor);
    const store = new SqlLibraryStore(executor);
    const admin = await db.createUser({ displayName: "Admin", adult: true, role: "ADMIN" });
    const { login, username, tutorId } = await tutorLogin(p, admin);
    const { studentId, clientId } = await familyStudent(store);

    assert.equal(await p.students.linkLogin(studentId, username.toUpperCase(), admin), "ok", "the username is matched without regard to case");
    assert.deepEqual(await owner("select student_id, profile_id, status from public.learner_identities where profile_id = $1", [login]), [{ student_id: studentId, profile_id: login, status: "active" }]);
    assert.ok((await owner("select 1 from public.identity_audit where action = 'learner_login_linked' and actor_profile_id = $1 and student_id = $2 and client_id = $3", [admin, studentId, clientId])).length === 1);

    // Linking alone changes no role: the administrator then adds STUDENT, which now has its record.
    assert.deepEqual((await owner("select role from public.profile_roles where profile_id = $1 order by role", [login])).map((r) => r.role), ["TUTOR"]);
    const result = await store.accounts.changeRoles({ actor: admin, profileId: login, roles: ["TUTOR", "STUDENT"] });
    assert.equal(result.status, "changed");
    assert.deepEqual((await owner("select role from public.profile_roles where profile_id = $1 order by role", [login])).map((r) => r.role), ["STUDENT", "TUTOR"]);

    // One login, both records.
    const records = await store.accounts.records(login);
    assert.equal(records.tutorId, tutorId);
    assert.equal(records.studentId, studentId);
    assert.equal((await p.students.getByUserId(login))?.id, studentId);
    assert.equal((await p.tutors.getByUserId(login))?.id, tutorId);
  });

  test("the STUDENT role is still refused for a login with no student record", async () => {
    const p = createSqlDataProvider(executor);
    const store = new SqlLibraryStore(executor);
    const admin = await db.createUser({ displayName: "Admin", adult: true, role: "ADMIN" });
    const { login } = await tutorLogin(p, admin);
    const result = await store.accounts.changeRoles({ actor: admin, profileId: login, roles: ["TUTOR", "STUDENT"] });
    assert.equal(result.status, "refused");
  });

  test("who cannot be linked: a family owner, a login that is already a learner, a student that already has a login, a student with no family", async () => {
    const p = createSqlDataProvider(executor);
    const store = new SqlLibraryStore(executor);
    const admin = await db.createUser({ displayName: "Admin", adult: true, role: "ADMIN" });
    const { studentId } = await familyStudent(store);

    const owner1 = await db.createUser({ displayName: "Parent", adult: true });
    await store.accounts.ensureClient(owner1);
    assert.equal(await p.students.linkLogin(studentId, await withUsername(owner1), admin), "not_eligible", "a family owner is never a learner");

    const parentRole = await db.createUser({ displayName: "Signed up parent", adult: true });
    assert.equal(await p.students.linkLogin(studentId, await withUsername(parentRole), admin), "not_eligible", "a login that holds the parent role");

    const first = await tutorLogin(p, admin);
    assert.equal(await p.students.linkLogin(studentId, first.username, admin), "ok");
    const second = await tutorLogin(p, admin);
    assert.equal(await p.students.linkLogin(studentId, second.username, admin), "not_eligible", "a student that already has a learner login");

    const { studentId: other } = await familyStudent(store);
    assert.equal(await p.students.linkLogin(other, first.username, admin), "not_eligible", "a login that is already a learner");

    const orphan = (await owner<{ id: string }>("insert into public.students (client_id, display_name) select c.id, 'Nobody' from public.clients c limit 1 returning id"))[0]!.id;
    await owner("update public.client_students set status = 'revoked' where student_id = $1", [orphan]);
    assert.equal(await p.students.linkLogin(orphan, second.username, admin), "not_eligible", "a student with no active family link");
  });

  test("an unknown username, a made-up student and a malformed id are told apart, and nothing is written", async () => {
    const p = createSqlDataProvider(executor);
    const store = new SqlLibraryStore(executor);
    const admin = await db.createUser({ displayName: "Admin", adult: true, role: "ADMIN" });
    const { studentId } = await familyStudent(store);
    const before = (await owner<{ n: number }>("select count(*)::int as n from public.learner_identities"))[0]!.n;

    assert.equal(await p.students.linkLogin(studentId, "nobody-here", admin), "no_account");
    assert.equal(await p.students.linkLogin("00000000-0000-4000-8000-000000000000", "nobody-here", admin), "no_student");
    assert.equal(await p.students.linkLogin("not-a-uuid", "nobody-here", admin), "no_student");
    assert.equal((await owner<{ n: number }>("select count(*)::int as n from public.learner_identities"))[0]!.n, before, "no learner login was made");
  });
});
