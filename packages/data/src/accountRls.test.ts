import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createTestDb, type TestDb } from "./testing/pglite";

// Migration 0017 through the browser's own roles. The Data API stays on, so what matters is what a signed-in person could do with their own
// key: a person on a temporary password must not be able to clear it, and nobody but the server may bind a login.

const PERMISSION = /permission denied/i;
const CALL = "select public.provision_account($1, 'someone', 'a@example.test', 'A', 'ADMIN', null, null, null, now())";

describe("the account columns and functions, as an API role", () => {
  let db: TestDb;
  let person: string;
  before(async () => {
    db = await createTestDb();
    person = await db.createUser({ displayName: "Person", adult: true });
    await db.asOwner((q) => q.query("update public.profiles set username = 'a.person', must_change_password = true, linked_email = 'p@example.test' where id = $1", [person]));
  });
  after(() => db.close());

  test("provision_account is closed to anon and to a signed-in person, so nobody can make themselves an administrator", async () => {
    await assert.rejects(db.asUser(person, (q) => q.query(CALL, [person])), PERMISSION);
    await assert.rejects(db.asAnon((q) => q.query(CALL, [randomUUID()])), PERMISSION);
    const [row] = await db.asOwner((q) => q.query<{ role: string }>("select role from public.profiles where id = $1", [person]));
    assert.equal(row!.role, "CLIENT");
  });

  test("a person cannot clear their own password flag, or change their username, linked email or disabled state", async () => {
    for (const change of ["must_change_password = false", "username = 'taken'", "linked_email = 'x@example.test'", "login_disabled_at = null"]) {
      await assert.rejects(db.asUser(person, (q) => q.query(`update public.profiles set ${change} where id = $1`, [person])), PERMISSION, change);
    }
  });

  test("the address to write to is the linked one, and is closed to API roles like the address it replaced", async () => {
    const [row] = await db.asService((q) => q.query<{ e: string }>("select public.auth_email($1) as e", [person]));
    assert.equal(row!.e, "p@example.test");
    await assert.rejects(db.asUser(person, (q) => q.query("select public.auth_email($1)", [person])), PERMISSION);
  });

  test("a username is unique and its shape is enforced by the database too", async () => {
    const other = await db.createUser({ displayName: "Other", adult: true });
    const set = (value: string) => db.asOwner((q) => q.query("update public.profiles set username = $2 where id = $1", [other, value]));
    await assert.rejects(set("a.person"), /duplicate key|unique/i);
    for (const bad of ["ab", "Has-Capitals", "two..dots", "-leading"]) await assert.rejects(set(bad), /check constraint/i, bad);
  });
});
