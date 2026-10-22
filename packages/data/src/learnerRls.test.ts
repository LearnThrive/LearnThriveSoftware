// Learner identity at the database (migration 0010): the constraints, triggers and row level security that hold even if application
// code is wrong. Each test plays a signed-in user and tries to cross a boundary. A rejected statement throws.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createFamily, type Family } from "./testing/fixtures";
import { createTestDb, type TestDb } from "./testing/pglite";

const PERMISSION = /permission denied/i;
const RLS = /row-level security/i;
const hash = () => createHash("sha256").update(randomBytes(16)).digest("hex");

let db: TestDb;
let alice: Family; // Ava (the learner under test), Alex (her sibling)
let bob: Family; // Ben
let adminId: string;
let learner: string; // Ava's own login
let ava: string;
let alex: string;
let tutorId: string;
const asg: Record<"ava" | "alex", string> = { ava: "", alex: "" };

const owner = <T = Record<string, any>>(sql: string, params: unknown[] = []) => db.asOwner((q) => q.query<T>(sql, params));

before(async () => {
  db = await createTestDb();
  alice = await createFamily(db, { name: "Alice", students: ["Ava", "Alex"] });
  bob = await createFamily(db, { name: "Bob", students: ["Ben"] });
  adminId = await db.createUser({ displayName: "Admin", adult: true, role: "ADMIN" });
  [ava, alex] = alice.studentIds as [string, string];
  learner = await db.createUser({ displayName: "Ava", adult: false });
  // Binding goes through the server function, exactly as the site does it.
  const token = hash();
  await db.asService((q) => q.query("select * from public.create_learner_invitation($1,$2,$3,$4,$5,$6,5,now())", [alice.clientId, ava, alice.userId, null, token, new Date(Date.now() + 3_600_000).toISOString()]));
  const accepted = await db.asService((q) => q.query<{ result: string }>("select * from public.accept_learner_invitation($1,$2,'ava@example.test',now())", [token, learner]));
  assert.equal(accepted[0]!.result, "ok");
  const tutorUser = await db.createUser({ displayName: "Tutor", adult: true, role: "TUTOR" });
  tutorId = (await owner<{ id: string }>("insert into public.tutors (profile_id, display_name) values ($1, 'Tutor') returning id", [tutorUser]))[0]!.id;
  for (const [key, student] of [["ava", ava], ["alex", alex]] as const) {
    asg[key] = (await owner<{ id: string }>("insert into public.tuition_assignments (title, subject, tutor_id) values ($1, 'Maths', $2) returning id", [`${key} maths`, tutorId]))[0]!.id;
    await owner("insert into public.assignment_students (assignment_id, student_id) values ($1, $2)", [asg[key], student]);
  }
});
after(() => db.close());

describe("who a learner is", () => {
  test("binding made the profile a STUDENT with one login, and nothing a person sends can do that", async () => {
    assert.deepEqual(await owner("select role from public.profiles where id = $1", [learner]), [{ role: "STUDENT" }]);
    assert.deepEqual(await owner("select status from public.learner_identities where student_id = $1", [ava]), [{ status: "active" }]);
    // Sign-up metadata cannot choose a role, a student or a learner identity.
    const forged = await db.createUser({ displayName: "Mallory", adult: false, metadata: { role: "STUDENT", student_id: ava, learner: true } });
    assert.deepEqual(await owner("select role from public.profiles where id = $1", [forged]), [{ role: "CLIENT" }]);
    assert.deepEqual(await owner("select 1 from public.learner_identities where profile_id = $1", [forged]), []);
    // No API role can write the role or the identity tables.
    await assert.rejects(db.asUser(forged, (q) => q.run("update public.profiles set role = 'STUDENT' where id = $1", [forged])), PERMISSION);
    await assert.rejects(db.asUser(forged, (q) => q.run("insert into public.learner_identities (student_id, profile_id) values ($1, $2)", [alex, forged])), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.learner_identities set status = 'revoked' where student_id = $1", [ava])), PERMISSION, "even the guardian changes status through the server");
  });

  test("one student has one login and one login has one student: ambiguity is impossible", async () => {
    const other = await db.createUser({ displayName: "Other", adult: false });
    await assert.rejects(owner("insert into public.learner_identities (student_id, profile_id) values ($1, $2)", [ava, other]), /unique|duplicate/i, "a second login for Ava");
    await assert.rejects(owner("insert into public.learner_identities (student_id, profile_id) values ($1, $2)", [alex, learner]), /unique|duplicate/i, "Ava's login for Alex too");
  });

  test("a learner is never a paying family account, in either order", async () => {
    await assert.rejects(owner("insert into public.clients (owner_profile_id) values ($1)", [learner]), /cannot own a family account/);
    await assert.rejects(db.asUser(learner, (q) => q.run("insert into public.clients (owner_profile_id) values ($1)", [learner])), /row-level security|permission|cannot own/i);
    await assert.rejects(owner("insert into public.learner_identities (student_id, profile_id) values ($1, $2)", [bob.studentIds[0]!, bob.userId]), /cannot also be a learner/);
  });
});

describe("what a learner reads", () => {
  test("their own student record, login and assignment: not a sibling's, not the family's account, not anyone else's", async () => {
    const students = await db.asUser(learner, (q) => q.query<{ id: string }>("select id from public.students order by id"));
    assert.deepEqual(students.map((s) => s.id), [ava], "Ava sees Ava, not Alex or Ben");
    assert.deepEqual((await db.asUser(learner, (q) => q.query<{ student_id: string }>("select student_id from public.learner_identities"))).map((r) => r.student_id), [ava]);
    assert.deepEqual((await db.asUser(learner, (q) => q.query<{ id: string }>("select id from public.tuition_assignments"))).map((r) => r.id), [asg.ava], "her own assignment only");
    assert.deepEqual((await db.asUser(learner, (q) => q.query<{ student_id: string }>("select student_id from public.assignment_students"))).map((r) => r.student_id), [ava]);
    for (const t of ["clients", "client_students", "consents", "subscriptions", "entitlements", "usage_counters", "chat_sessions", "chat_messages", "chat_files", "learner_invitations", "identity_audit", "billing_customers"]) {
      const rows = await db.asUser(learner, async (q) => {
        try {
          return await q.query(`select * from public.${t}`);
        } catch (error) {
          assert.match(String(error), PERMISSION, t);
          return [];
        }
      });
      assert.deepEqual(rows, [], `${t} is closed to a learner`);
    }
  });

  test("a learner cannot write to the family, the students, the chats or the assignments", async () => {
    // Either the database refuses outright or no row is affected: what matters is that nothing changed.
    const changed = await db.asUser(learner, (q) => q.run("update public.students set display_name = 'x' where id = $1", [ava])).catch(() => 0);
    assert.equal(changed, 0);
    assert.deepEqual(await owner("select display_name from public.students where id = $1", [ava]), [{ display_name: "Ava" }], "unchanged");
    await assert.rejects(db.asUser(learner, (q) => q.run("insert into public.chat_sessions (client_id, title) values ($1, 'x')", [alice.clientId])), RLS);
    await assert.rejects(db.asUser(learner, (q) => q.run("insert into public.students (client_id, display_name) values ($1, 'x')", [alice.clientId])), RLS);
    await assert.rejects(db.asUser(learner, (q) => q.run("update public.tuition_assignments set status = 'ENDED' where id = $1", [asg.ava])), PERMISSION, "or end their own tuition");
  });

  test("anonymous callers see none of it", async () => {
    for (const t of ["learner_identities", "learner_invitations", "identity_audit"]) {
      await assert.rejects(db.asAnon((q) => q.query(`select * from public.${t}`)), PERMISSION, t);
    }
  });
});

describe("what a guardian reads", () => {
  test("their family's learner logins and invitations, never another family's, and never a token hash", async () => {
    assert.deepEqual((await db.asUser(alice.userId, (q) => q.query<{ student_id: string }>("select student_id from public.learner_identities"))).map((r) => r.student_id), [ava]);
    assert.deepEqual(await db.asUser(bob.userId, (q) => q.query("select * from public.learner_identities")), []);
    const mine = await db.asUser(alice.userId, (q) => q.query<{ student_id: string }>("select student_id from public.learner_invitations"));
    assert.ok(mine.length >= 1 && mine.every((r) => r.student_id === ava));
    assert.deepEqual(await db.asUser(bob.userId, (q) => q.query("select id from public.learner_invitations")), []);
    await assert.rejects(db.asUser(alice.userId, (q) => q.query("select token_hash from public.learner_invitations")), PERMISSION, "the hash is not even selectable");
    await assert.rejects(db.asUser(alice.userId, (q) => q.query("select * from public.learner_invitations")), PERMISSION, "a star would include it");
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("insert into public.learner_invitations (student_id, client_id, invited_by, token_hash, expires_at) values ($1,$2,$3,$4, now() + interval '1 hour')", [ava, alice.clientId, alice.userId, hash()])), PERMISSION, "invitations are created by the server");
    assert.deepEqual(await db.asUser(alice.userId, (q) => q.query("select * from public.identity_audit")), [], "the audit trail is staff only");
  });

  test("staff read the audit trail; the server functions are closed to every API role", async () => {
    const rows = await db.asUser(adminId, (q) => q.query<{ action: string }>("select action from public.identity_audit where student_id = $1", [ava]));
    assert.ok(rows.some((r) => r.action === "invitation_accepted"));
    for (const who of [alice.userId, learner]) {
      await assert.rejects(db.asUser(who, (q) => q.query("select * from public.create_learner_invitation($1,$2,$3,null,$4, now() + interval '1 hour', 5, now())", [alice.clientId, alex, who, hash()])), PERMISSION);
      await assert.rejects(db.asUser(who, (q) => q.query("select * from public.accept_learner_invitation($1,$2,'a@b.test',now())", [hash(), who])), PERMISSION);
    }
    await assert.rejects(db.asAnon((q) => q.query("select * from public.accept_learner_invitation($1,$2,'a@b.test',now())", [hash(), learner])), PERMISSION);
  });

  test("a guardian's chat access stops at their own conversations: a learner's are not theirs (RLS)", async () => {
    const chat = (await owner<{ id: string }>("insert into public.chat_sessions (client_id, student_id, title) values ($1,$2,'Ava') returning id", [alice.clientId, ava]))[0]!.id;
    assert.deepEqual(await db.asUser(alice.userId, (q) => q.query("select id from public.chat_sessions where id = $1", [chat])), []);
    assert.deepEqual(await db.asUser(learner, (q) => q.query("select id from public.chat_sessions where id = $1", [chat]).catch(() => [])), [], "nor reachable by the learner through the API: the server mediates it");
  });
});

describe("links, status and enrolment", () => {
  test("a revoked or suspended guardian link stops a second guardian reading the student, and the family helper counts only active links", async () => {
    const second = await createFamily(db, { name: "Second" });
    await owner("insert into public.client_students (client_id, student_id) values ($1,$2)", [second.clientId, alex]);
    assert.equal((await db.asUser(second.userId, (q) => q.query("select id from public.students where id = $1", [alex]))).length, 1);
    assert.equal((await owner<{ e: boolean }>("select public.client_is_enrolled($1) as e", [second.clientId]))[0]!.e, true);
    for (const status of ["suspended", "revoked"]) {
      await owner("update public.client_students set status = $3 where client_id = $1 and student_id = $2", [second.clientId, alex, status]);
      assert.deepEqual(await db.asUser(second.userId, (q) => q.query("select id from public.students where id = $1", [alex])), [], status);
      assert.deepEqual(await db.asUser(second.userId, (q) => q.query("select id from public.tuition_assignments where id = $1", [asg.alex])), [], status);
      assert.equal((await owner<{ e: boolean }>("select public.client_is_enrolled($1) as e", [second.clientId]))[0]!.e, false, status);
    }
    await assert.rejects(owner("update public.client_students set status = 'gone' where student_id = $1", [alex]), /check constraint|violates/i);
  });

  test("student_is_enrolled follows that student's own assignment, not a sibling's", async () => {
    const enrolled = (id: string) => owner<{ e: boolean }>("select public.student_is_enrolled($1) as e", [id]).then((r) => r[0]!.e);
    assert.equal(await enrolled(ava), true);
    await owner("update public.tuition_assignments set status = 'ENDED' where id = $1", [asg.ava]);
    assert.equal(await enrolled(ava), false);
    assert.equal(await enrolled(alex), true, "Alex's lessons are unaffected");
    await owner("update public.tuition_assignments set status = 'ACTIVE' where id = $1", [asg.ava]);
    await assert.rejects(db.asUser(learner, (q) => q.query("select public.student_is_enrolled($1)", [ava])), PERMISSION, "a learner cannot ask the function directly");
  });

  test("deleting a student removes their login, invitations and audit link but never the auth profile or the family", async () => {
    const f = await createFamily(db, { name: "Gone", students: ["Gwen"] });
    const gwen = await db.createUser({ displayName: "Gwen", adult: false });
    const t = hash();
    await db.asService((q) => q.query("select * from public.create_learner_invitation($1,$2,$3,null,$4,now() + interval '1 hour',5,now())", [f.clientId, f.studentIds[0]!, f.userId, t]));
    await db.asService((q) => q.query("select * from public.accept_learner_invitation($1,$2,'g@example.test',now())", [t, gwen]));
    await owner("delete from public.students where id = $1", [f.studentIds[0]!]);
    assert.deepEqual(await owner("select 1 from public.learner_identities where profile_id = $1", [gwen]), [], "the login row is gone with the student");
    assert.deepEqual(await owner("select 1 from public.learner_invitations where student_id = $1", [f.studentIds[0]!]), []);
    assert.equal((await owner("select 1 from public.profiles where id = $1", [gwen])).length, 1, "the person's account still exists (an orphan the retention procedure reports)");
    assert.equal((await owner("select 1 from public.clients where id = $1", [f.clientId])).length, 1);
    assert.ok((await owner("select 1 from public.identity_audit where student_id is null and action = 'invitation_accepted'")).length >= 1, "the audit rows survive with the student reference cleared");
  });
});
