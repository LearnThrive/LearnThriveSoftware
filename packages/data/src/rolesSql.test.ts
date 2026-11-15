import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { SqlLibraryStore } from "./library";
import { normaliseRoles } from "./roles";
import { createFamily } from "./testing/fixtures";
import { createTestDb, type TestDb } from "./testing/pglite";
import { rolesContract } from "./testing/rolesContract";

const executorOf = (db: TestDb) => ({ query: <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params)) });
const PERMISSION = /permission denied/i;

/** A person holding exactly `roles`, built the way the migration's own tables say: the extra roles are rows in profile_roles. */
async function person(db: TestDb, roles: Parameters<typeof normaliseRoles>[0]) {
  const held = normaliseRoles(roles);
  const profileId = await db.createUser({ adult: true, role: held[0] });
  const x = executorOf(db);
  for (const role of held.slice(1)) await x.query("insert into public.profile_roles (profile_id, role) values ($1, $2) on conflict do nothing", [profileId, role]);
  let tutorId: string | null = null;
  let studentId: string | null = null;
  if (held.includes("TUTOR") || held.includes("JUNIOR_TUTOR")) {
    tutorId = (await x.query<{ id: string }>("insert into public.tutors (profile_id, display_name, subjects, active) values ($1, 'Synthetic Tutor', array[]::text[], true) returning id", [profileId]))[0]!.id;
  }
  if (held.includes("STUDENT")) {
    const family = await createFamily(db, { name: "Synthetic Family", students: ["Synthetic Kid"] });
    studentId = family.studentIds[0]!;
    await x.query("insert into public.learner_identities (student_id, profile_id, activated_at) values ($1, $2, now())", [studentId, profileId]);
  }
  return { profileId, tutorId, studentId };
}

rolesContract("sql on PGlite", async () => {
  const db = await createTestDb();
  return {
    close: () => db.close(),
    harness: {
      store: new SqlLibraryStore(executorOf(db)),
      person: (roles) => person(db, roles),
      bare: async (roles) => (await person(db, roles.filter((r) => r !== "TUTOR" && r !== "JUNIOR_TUTOR" && r !== "STUDENT"))).profileId,
    },
  };
});

describe("the roles tables and function in Postgres", () => {
  let db: TestDb;
  let x: ReturnType<typeof executorOf>;
  before(async () => {
    db = await createTestDb();
    x = executorOf(db);
  });
  after(() => db.close());

  const rolesIn = async (id: string) => (await x.query<{ role: string }>("select role from public.profile_roles where profile_id = $1 order by role", [id])).map((r) => r.role);

  test("everyone a migration found has a role row, and an administrator who teaches has both roles", async () => {
    // An administrator with a tutor record, made the OLD way: one role (ADMIN) and a tutor row pointing at them. That is the shape the
    // migration found in the hosted database. Re-running the migration is how its backfill runs again: it must give them TUTOR as well.
    const admin = await db.createUser({ adult: true, role: "ADMIN" });
    await x.query("insert into public.tutors (profile_id, display_name, subjects, active) values ($1, 'Synthetic', array[]::text[], true)", [admin]);
    await x.query("delete from public.profile_roles where profile_id = $1 and role = 'TUTOR'", [admin]); // the link already gives TUTOR now; take it off to look like the old shape
    assert.deepEqual(await rolesIn(admin), ["ADMIN"], "before: only the one role");
    await db.migrate();
    assert.deepEqual(await rolesIn(admin), ["ADMIN", "TUTOR"]);
    await db.migrate();
    assert.deepEqual(await rolesIn(admin), ["ADMIN", "TUTOR"]);
  });

  test("profiles.role is only the primary role of the set, and follows it", async () => {
    const p = await person(db, ["JUNIOR_TUTOR", "STUDENT"]);
    const primary = async () => (await x.query<{ role: string }>("select role from public.profiles where id = $1", [p.profileId]))[0]!.role;
    assert.equal(await primary(), "JUNIOR_TUTOR");
    await x.query("delete from public.profile_roles where profile_id = $1 and role = 'JUNIOR_TUTOR'", [p.profileId]);
    assert.equal(await primary(), "STUDENT");
  });

  test("an older function that writes profiles.role REPLACES the set with that one role (what it always meant)", async () => {
    const profileId = await db.createUser({ adult: true });
    assert.deepEqual(await rolesIn(profileId), ["CLIENT"], "a new sign-up has the default role as a row");
    await x.query("update public.profiles set role = 'TUTOR' where id = $1", [profileId]);
    assert.deepEqual(await rolesIn(profileId), ["TUTOR"]);
  });

  test("the database refuses tutor with junior tutor, and a learner who owns a family, even to its own owner", async () => {
    const t = await person(db, ["TUTOR"]);
    await assert.rejects(x.query("insert into public.profile_roles (profile_id, role) values ($1, 'JUNIOR_TUTOR')", [t.profileId]), /cannot be held together/);
    const s = await person(db, ["STUDENT"]);
    await assert.rejects(x.query("insert into public.profile_roles (profile_id, role) values ($1, 'CLIENT')", [s.profileId]), /cannot be held together/);
    assert.deepEqual(await rolesIn(t.profileId), ["TUTOR"]);
  });

  test("the database refuses to remove the last administrator, by any route, and a person's last role", async () => {
    // A fresh database, so there is exactly one administrator and the test cannot depend on the others in this file.
    const fresh = await createTestDb();
    try {
      const only = await fresh.createUser({ adult: true, role: "ADMIN" });
      const fx = executorOf(fresh);
      assert.deepEqual((await fx.query<{ role: string }>("select role from public.profile_roles where profile_id = $1", [only])).map((r) => r.role), ["ADMIN"]);
      await fx.query("insert into public.profile_roles (profile_id, role) values ($1, 'CLIENT')", [only]);
      await assert.rejects(fx.query("delete from public.profile_roles where profile_id = $1 and role = 'ADMIN'", [only]), /last administrator/);
      await assert.rejects(fx.query("update public.profiles set role = 'CLIENT' where id = $1", [only]), /last administrator/, "an older function cannot strip them either");
      const [row] = await fx.query<{ role: string }>("select role from public.profiles where id = $1", [only]);
      assert.equal(row!.role, "ADMIN");
      const someone = await fresh.createUser({ adult: true });
      await assert.rejects(fx.query("delete from public.profile_roles where profile_id = $1", [someone]), /at least one role/);
      // Deleting the PERSON is allowed (a purge): their roles go with them.
      await fx.query("delete from public.profiles where id = $1", [only]);
      assert.equal((await fx.query("select 1 from public.profile_roles where profile_id = $1", [only])).length, 0);
    } finally {
      await fresh.close();
    }
  });

  test("role_changes is append-only, except that a purge may clear the two ids", async () => {
    const admin = await person(db, ["ADMIN"]);
    const target = await person(db, ["TUTOR"]);
    const store = new SqlLibraryStore(x);
    assert.equal((await store.accounts.changeRoles({ actor: admin.profileId, profileId: target.profileId, roles: ["ADMIN", "TUTOR"] })).status, "changed");
    await assert.rejects(x.query("update public.role_changes set new_roles = array['CLIENT']"), /append-only/);
    await assert.rejects(x.query("delete from public.role_changes"), /append-only/);
    await x.query("update public.role_changes set target_profile_id = null where target_profile_id = $1", [target.profileId]);
    assert.equal((await x.query("select 1 from public.role_changes where target_profile_id is null")).length > 0, true);
    await assert.rejects(x.query("update public.role_changes set target_profile_id = $1 where target_profile_id is null", [admin.profileId]), /append-only/, "an id can be cleared, never pointed elsewhere");
  });

  test("the roles tables and set_profile_roles are closed to anon and to a signed-in person: nobody can grant themselves a role through the API", async () => {
    const someone = await person(db, ["STUDENT"]);
    for (const sql of ["select * from public.profile_roles", "select * from public.role_changes"]) {
      await assert.rejects(db.asUser(someone.profileId, (q) => q.query(sql)), PERMISSION, sql);
      await assert.rejects(db.asAnon((q) => q.query(sql)), PERMISSION, sql);
    }
    await assert.rejects(db.asUser(someone.profileId, (q) => q.query("insert into public.profile_roles (profile_id, role) values ($1, 'ADMIN')", [someone.profileId])), PERMISSION);
    await assert.rejects(db.asUser(someone.profileId, (q) => q.query("update public.profiles set role = 'ADMIN' where id = $1", [someone.profileId])), PERMISSION);
    await assert.rejects(db.asUser(someone.profileId, (q) => q.query("select * from public.set_profile_roles($1, $1, array['ADMIN'], now())", [someone.profileId])), PERMISSION);
    await assert.rejects(db.asAnon((q) => q.query("select * from public.set_profile_roles($1, $1, array['ADMIN'], now())", [randomUUID()])), PERMISSION);
    assert.deepEqual(await rolesIn(someone.profileId), ["STUDENT"]);
  });

  test("an administrator, as an API role, is still an administrator through the policies after the move to the set", async () => {
    const admin = await person(db, ["ADMIN"]);
    const rows = await db.asUser(admin.profileId, (q) => q.query<{ id: string }>("select id from public.profiles"));
    assert.ok(rows.length > 1, "private.is_admin() reads profile_roles, and an administrator still sees every profile");
    const student = await person(db, ["STUDENT"]);
    const own = await db.asUser(student.profileId, (q) => q.query<{ id: string }>("select id from public.profiles"));
    assert.deepEqual(own.map((r) => r.id), [student.profileId], "a student sees only themselves");
  });
});

describe("an administrator who teaches gets the TUTOR role from every route that links them", () => {
  test("linking a tutor record to an administrator, and making a linked tutor an administrator, both give TUTOR", async () => {
    const db = await createTestDb();
    try {
      const x = executorOf(db);
      const rolesIn = async (id: string) => (await x.query<{ role: string }>("select role from public.profile_roles where profile_id = $1 order by role", [id])).map((r) => r.role);
      // 1. An administrator, then a tutor record is linked to them (the admin screen's "link login").
      const admin = await db.createUser({ adult: true, role: "ADMIN" });
      await x.query("insert into public.profile_roles (profile_id, role) values ($1, 'CLIENT')", [await db.createUser({ adult: true, role: "ADMIN" })]); // a second administrator, so the first is not the last
      const tutor = (await x.query<{ id: string }>("insert into public.tutors (display_name, subjects, active) values ('Synthetic', array[]::text[], true) returning id"))[0]!.id;
      await x.query("update public.tutors set profile_id = $1 where id = $2", [admin, tutor]);
      assert.deepEqual(await rolesIn(admin), ["ADMIN", "TUTOR"]);
      // 2. A tutor who is linked, then promoted by the operator script (a direct write of profiles.role): they keep TUTOR and gain ADMIN.
      const promoted = await db.createUser({ adult: true, role: "TUTOR" });
      await x.query("insert into public.tutors (profile_id, display_name, subjects, active) values ($1, 'Synthetic Two', array[]::text[], true)", [promoted]);
      await x.query("update public.profiles set role = 'ADMIN' where id = $1", [promoted]);
      assert.deepEqual(await rolesIn(promoted), ["ADMIN", "TUTOR"]);
      // 3. A plain account made an administrator while linked to a tutor record (provision_account's order) gets both.
      const fresh = await db.createUser({ adult: true });
      await x.query("insert into public.tutors (profile_id, display_name, subjects, active) values ($1, 'Synthetic Three', array[]::text[], true)", [fresh]);
      await x.query("update public.profiles set role = 'ADMIN' where id = $1", [fresh]);
      assert.deepEqual(await rolesIn(fresh), ["ADMIN", "TUTOR"]);
    } finally {
      await db.close();
    }
  });
});
