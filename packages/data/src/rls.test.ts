// Row Level Security tests, deliberately adversarial: each test plays a signed-in user (or anon) and
// tries to read, write, move or escalate across the family boundary, against the real migrations
// running in an in-process Postgres (PGlite). See ./testing/pglite.ts for how roles and JWT claims
// are emulated. A rejected statement throws, so `rejects` means the database refused it.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createFamily, createResource, type Family } from "./testing/fixtures";
import { createTestDb, type TestDb } from "./testing/pglite";

const PERMISSION = /permission denied/i;
const RLS = /row-level security/i;
const SHA = "c".repeat(64);

let db: TestDb;

// Cast of characters
let alice: Family; // family A: Ava, Alex
let bob: Family; // family B: Ben
let carol: Family; // family C: Cy
let dora: Family; // family D: Dee
let adminId: string;
let tomUser: string; // tutor Tom
let taraUser: string; // tutor Tara
let nobody: string; // adult profile, no family account yet
let minorish: string; // profile without the adult declaration
let tomId: string;
let taraId: string;
const asg: Record<"GA" | "GB" | "GG" | "GE", string> = { GA: "", GB: "", GG: "", GE: "" };
const res = { members: "", sample: "", draft: "", scheduled: "" };
const ids: Record<"A" | "B", Record<string, string>> = { A: {}, B: {} };

async function owner<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return db.asOwner((q) => q.query<T>(sql, params));
}

async function withWidenedGrant(grant: string, revoke: string, fn: () => Promise<void>) {
  await db.raw.exec(grant);
  try {
    await fn();
  } finally {
    await db.raw.exec(revoke);
  }
}

before(async () => {
  db = await createTestDb();
  alice = await createFamily(db, { name: "Alice", students: ["Ava", "Alex"] });
  bob = await createFamily(db, { name: "Bob", students: ["Ben"] });
  carol = await createFamily(db, { name: "Carol", students: ["Cy"] });
  dora = await createFamily(db, { name: "Dora", students: ["Dee"] });
  adminId = await db.createUser({ displayName: "Admin", adult: true, role: "ADMIN" });
  tomUser = await db.createUser({ displayName: "Tom", adult: true, role: "TUTOR" });
  taraUser = await db.createUser({ displayName: "Tara", adult: true, role: "TUTOR" });
  nobody = await db.createUser({ displayName: "Nobody", adult: true });
  minorish = await db.createUser({ displayName: "Minorish" });

  const [ava, alex] = alice.studentIds as [string, string];
  const [ben] = bob.studentIds as [string];
  const [cy] = carol.studentIds as [string];
  const [dee] = dora.studentIds as [string];

  tomId = (await owner<{ id: string }>("insert into public.tutors (profile_id, display_name) values ($1,'Tom') returning id", [tomUser]))[0]!.id;
  taraId = (await owner<{ id: string }>("insert into public.tutors (profile_id, display_name) values ($1,'Tara') returning id", [taraUser]))[0]!.id;

  const mkAssignment = async (key: keyof typeof asg, tutor: string, status: string, students: string[]) => {
    asg[key] = (
      await owner<{ id: string }>(
        "insert into public.tuition_assignments (title, subject, tutor_id, status) values ($1,'Maths',$2,$3) returning id",
        [`Assignment ${key}`, tutor, status],
      )
    )[0]!.id;
    for (const s of students) await owner("insert into public.assignment_students (assignment_id, student_id) values ($1,$2)", [asg[key], s]);
  };
  await mkAssignment("GA", tomId, "ACTIVE", [ava]);
  await mkAssignment("GB", taraId, "PAUSED", [ben]);
  await mkAssignment("GG", tomId, "ACTIVE", [ava, dee]); // a group: two families
  await mkAssignment("GE", tomId, "ENDED", [cy]);
  void alex;

  res.members = await createResource(db, { slug: "pub-members", title: "Members paper", access_tier: "members" });
  res.sample = await createResource(db, { slug: "pub-sample", title: "Free sample", access_tier: "free_sample" });
  res.draft = await createResource(db, { slug: "draft", title: "Draft", published: false });
  res.scheduled = await createResource(db, { slug: "scheduled", title: "Scheduled", published: new Date(Date.now() + 86_400_000).toISOString() });
  for (const [i, r] of Object.values(res).entries()) {
    await owner(
      "insert into public.resource_files (resource_id, storage_path, bytes, content_type, checksum_sha256) values ($1,$2,100,'application/pdf',$3)",
      [r, `lib/file-${i}.pdf`, SHA],
    );
  }

  for (const [tag, f, n] of [["A", alice, 1], ["B", bob, 2]] as const) {
    const ids_ = ids[tag];
    await owner("insert into public.billing_customers (client_id, stripe_customer_id) values ($1,$2)", [f.clientId, `cus_${tag}${n}`]);
    ids_.subscription = (
      await owner<{ id: string }>(
        "insert into public.subscriptions (client_id, stripe_subscription_id, stripe_price_id, status, plan_interval) values ($1,$2,'price_x','active','month') returning id",
        [f.clientId, `sub_${tag}${n}`],
      )
    )[0]!.id;
    await owner("insert into public.entitlements (client_id, source, subscription_id) values ($1,'subscription',$2)", [f.clientId, ids_.subscription]);
    ids_.grant = (await owner<{ id: string }>("insert into public.admin_grants (client_id, reason) values ($1,'r') returning id", [f.clientId]))[0]!.id;
    await owner("insert into public.download_events (client_id, resource_id) values ($1,$2)", [f.clientId, res.members]);
    await owner("insert into public.usage_counters (client_id, kind, window_start, count) values ($1,'assistant_message_day', date_trunc('day', now()), 3)", [f.clientId]);
    await owner("insert into public.consents (profile_id, kind, version, text_sha256) values ($1,'terms','1',$2)", [f.userId, SHA]);
    ids_.session = (
      await owner<{ id: string }>("insert into public.chat_sessions (client_id, title) values ($1,'Help') returning id", [f.clientId])
    )[0]!.id;
    ids_.message = (
      await owner<{ id: string }>("insert into public.chat_messages (session_id, role, content) values ($1,'user','a secret question') returning id", [ids_.session])
    )[0]!.id;
    await owner("insert into public.chat_files (session_id, message_id, storage_path, bytes, content_type) values ($1,$2,$3,10,'image/png')", [ids_.session, ids_.message, `chat/${tag}.png`]);
  }
  await owner("insert into public.entitlements (client_id, source, assignment_id) values ($1,'enrolled',$2)", [alice.clientId, asg.GA]);
  await owner("insert into public.stripe_webhook_events (event_id, event_type) values ('evt_seed','invoice.paid')");
});

after(() => db.close());

const ids_of = (rows: Record<string, any>[], col = "id") => rows.map((r) => r[col] as string).sort();

describe("a signed-in user reads only their own family's rows", () => {
  type Spec = { table: string; key: string; where: (f: Family) => string };
  const FAMILY_TABLES: Spec[] = [
    { table: "profiles", key: "id", where: (f) => `id = '${f.userId}'` },
    { table: "clients", key: "id", where: (f) => `id = '${f.clientId}'` },
    { table: "students", key: "id", where: (f) => `client_id = '${f.clientId}'` },
    { table: "client_students", key: "student_id", where: (f) => `client_id = '${f.clientId}'` },
    { table: "consents", key: "id", where: (f) => `profile_id = '${f.userId}'` },
    { table: "subscriptions", key: "id", where: (f) => `client_id = '${f.clientId}'` },
    { table: "entitlements", key: "id", where: (f) => `client_id = '${f.clientId}'` },
    { table: "usage_counters", key: "id", where: (f) => `client_id = '${f.clientId}'` },
    { table: "chat_sessions", key: "id", where: (f) => `client_id = '${f.clientId}'` },
    { table: "chat_messages", key: "id", where: (f) => `session_id in (select id from public.chat_sessions where client_id = '${f.clientId}')` },
    { table: "chat_files", key: "id", where: (f) => `session_id in (select id from public.chat_sessions where client_id = '${f.clientId}')` },
  ];

  for (const spec of FAMILY_TABLES) {
    test(`${spec.table}: Alice sees exactly hers, Bob exactly his, and neither sees the other's`, async () => {
      for (const [me, them] of [[alice, bob], [bob, alice]] as const) {
        const expected = ids_of(await owner(`select ${spec.key} from public.${spec.table} where ${spec.where(me)}`), spec.key);
        const theirs = ids_of(await owner(`select ${spec.key} from public.${spec.table} where ${spec.where(them)}`), spec.key);
        assert.ok(expected.length > 0 && theirs.length > 0, `fixture for ${spec.table} must not be empty`);
        const seen = ids_of(await db.asUser(me.userId, (q) => q.query(`select ${spec.key} from public.${spec.table}`)), spec.key);
        assert.deepEqual(seen, expected);
        // asking for the other family's rows by their exact ids returns nothing
        const direct = await db.asUser(me.userId, (q) =>
          q.query(`select ${spec.key} from public.${spec.table} where ${spec.key}::text = any($1::text[])`, [theirs]),
        );
        assert.deepEqual(direct, []);
      }
    });
  }

  test("a user with no family account sees no family rows at all", async () => {
    for (const { table } of FAMILY_TABLES.filter((t) => t.table !== "profiles" && t.table !== "consents")) {
      const rows = await db.asUser(nobody, (q) => q.query(`select 1 from public.${table}`));
      assert.deepEqual(rows, [], table);
    }
    assert.equal((await db.asUser(nobody, (q) => q.query("select 1 from public.profiles"))).length, 1, "only their own profile");
  });

  test("a family that is not in the group assignment cannot see who else is on it", async () => {
    const aSees = ids_of(await db.asUser(alice.userId, (q) => q.query("select assignment_id from public.assignment_students")), "assignment_id");
    assert.deepEqual(aSees, [asg.GA, asg.GG].sort(), "Alice sees only her own student's rows");
    const aRows = await db.asUser(alice.userId, (q) => q.query("select student_id from public.assignment_students where assignment_id = $1", [asg.GG]));
    assert.deepEqual(aRows.map((r) => r.student_id), [alice.studentIds[0]], "not Dee, who shares the group");
    const dSees = await db.asUser(dora.userId, (q) => q.query("select student_id from public.assignment_students"));
    assert.deepEqual(dSees.map((r) => r.student_id), [dora.studentIds[0]]);
    // and the assignment itself, but not the other family's students
    assert.deepEqual(ids_of(await db.asUser(alice.userId, (q) => q.query("select id from public.tuition_assignments"))), [asg.GA, asg.GG].sort());
    assert.deepEqual(ids_of(await db.asUser(bob.userId, (q) => q.query("select id from public.tuition_assignments"))), [asg.GB]);
    assert.deepEqual(ids_of(await db.asUser(carol.userId, (q) => q.query("select id from public.tuition_assignments"))), [asg.GE]);
  });

  test("tutors see their own assignments and rows, never families or students", async () => {
    assert.deepEqual(ids_of(await db.asUser(tomUser, (q) => q.query("select id from public.tuition_assignments"))), [asg.GA, asg.GE, asg.GG].sort());
    assert.deepEqual(ids_of(await db.asUser(taraUser, (q) => q.query("select id from public.tuition_assignments"))), [asg.GB]);
    assert.equal((await db.asUser(tomUser, (q) => q.query("select 1 from public.assignment_students"))).length, 4);
    assert.deepEqual(await db.asUser(tomUser, (q) => q.query("select 1 from public.tutors")), [{ "?column?": 1 }], "only their own tutor row");
    for (const t of ["clients", "students", "client_students", "subscriptions", "entitlements", "chat_sessions", "consents", "usage_counters"]) {
      assert.deepEqual(await db.asUser(tomUser, (q) => q.query(`select 1 from public.${t}`)), [], t);
    }
  });

  test("a guardian cannot read a learner's conversations, even in their own family (0010); only the server can", async () => {
    const ava = alice.studentIds[0]!;
    const learnerChat = (await owner<{ id: string }>("insert into public.chat_sessions (client_id, student_id, title) values ($1,$2,'Ava only') returning id", [alice.clientId, ava]))[0]!.id;
    const message = (await owner<{ id: string }>("insert into public.chat_messages (session_id, role, content) values ($1,'user','private to the learner') returning id", [learnerChat]))[0]!.id;
    await owner("insert into public.chat_files (session_id, message_id, storage_path, bytes, content_type) values ($1,$2,'chat/learner-only.png',10,'image/png')", [learnerChat, message]);
    try {
      assert.deepEqual(ids_of(await db.asUser(alice.userId, (q) => q.query("select id from public.chat_sessions"))), [ids.A.session!], "only the adult's own chat");
      assert.deepEqual(await db.asUser(alice.userId, (q) => q.query("select id from public.chat_messages where id = $1", [message])), []);
      assert.deepEqual(await db.asUser(alice.userId, (q) => q.query("select id from public.chat_files where session_id = $1", [learnerChat])), []);
      assert.deepEqual(await db.asUser(alice.userId, (q) => q.query("select public.request_chat_deletion($1) as ok", [learnerChat])), [{ ok: false }], "nor delete it through the API");
      assert.equal(await db.asUser(alice.userId, (q) => q.run("update public.chat_sessions set title = 'x' where id = $1", [learnerChat])), 0);
    } finally {
      await owner("delete from public.chat_sessions where id = $1", [learnerChat]);
    }
  });

  test("a second guardian linked by the server can read the student but not change or delete it, and sees no chats", async () => {
    const ava = alice.studentIds[0]!;
    await owner("insert into public.client_students (client_id, student_id) values ($1,$2)", [bob.clientId, ava]);
    try {
      const seen = await db.asUser(bob.userId, (q) => q.query("select id from public.students where id = $1", [ava]));
      assert.equal(seen.length, 1);
      assert.equal(await db.asUser(bob.userId, (q) => q.run("update public.students set display_name = 'Hijack' where id = $1", [ava])), 0);
      assert.equal(await db.asUser(bob.userId, (q) => q.run("delete from public.students where id = $1", [ava])), 0);
      assert.deepEqual(await owner("select display_name from public.students where id = $1", [ava]), [{ display_name: "Ava" }]);
      // Alice's own chat is Alice's, not the second guardian's
      assert.deepEqual(ids_of(await db.asUser(bob.userId, (q) => q.query("select id from public.chat_sessions"))), [ids.B.session!]);
    } finally {
      await owner("delete from public.client_students where client_id = $1 and student_id = $2", [bob.clientId, ava]);
    }
    assert.deepEqual(await db.asUser(bob.userId, (q) => q.query("select id from public.students where id = $1", [ava])), []);
  });
});

describe("a user cannot write into another family, or move rows between families", () => {
  test("clients: only your own profile, only after the adult declaration, only once", async () => {
    await assert.rejects(db.asUser(nobody, (q) => q.run("insert into public.clients (owner_profile_id) values ($1)", [bob.userId])), RLS);
    await assert.rejects(db.asUser(nobody, (q) => q.run("insert into public.clients (owner_profile_id) values ($1)", [alice.userId])), RLS);
    await assert.rejects(db.asUser(minorish, (q) => q.run("insert into public.clients (owner_profile_id) values ($1)", [minorish])), RLS, "no adult declaration, no billing account");
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("insert into public.clients (owner_profile_id) values ($1)", [alice.userId])), /unique|duplicate/i);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.clients set owner_profile_id = $1 where id = $2", [bob.userId, alice.clientId])), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.clients set active = false where id = $1", [alice.clientId])), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("delete from public.clients where id = $1", [alice.clientId])), PERMISSION);
    // the legitimate path works
    const id = await db.asUser(nobody, async (q) => (await q.query<{ id: string }>("insert into public.clients (owner_profile_id) values ($1) returning id", [nobody]))[0]!.id);
    assert.ok(id);
    await owner("delete from public.clients where id = $1", [id]);
  });

  test("students: cannot add to, edit, delete or re-parent another family's students", async () => {
    const [ava] = alice.studentIds as [string];
    const [ben] = bob.studentIds as [string];
    await assert.rejects(
      db.asUser(alice.userId, (q) => q.run("insert into public.students (client_id, display_name) values ($1,'Intruder')", [bob.clientId])),
      RLS,
    );
    assert.equal(await db.asUser(alice.userId, (q) => q.run("update public.students set display_name = 'Pwned' where id = $1", [ben])), 0);
    assert.equal(await db.asUser(alice.userId, (q) => q.run("delete from public.students where id = $1", [ben])), 0);
    assert.deepEqual(await owner("select display_name from public.students where id = $1", [ben]), [{ display_name: "Ben" }]);
    // columns that decide ownership or status are not writable at all
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.students set id = gen_random_uuid() where id = $1", [ava])), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.students set client_id = $1 where id = $2", [bob.clientId, ava])), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.students set is_minor = false where id = $1", [ava])), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.students set active = false where id = $1", [ava])), PERMISSION);
    // Belt and braces: even if the column grant were widened by mistake, the policy still refuses the move.
    await withWidenedGrant("grant update (client_id) on public.students to authenticated", "revoke update (client_id) on public.students from authenticated", async () => {
      await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.students set client_id = $1 where id = $2", [bob.clientId, ava])), RLS);
      assert.equal(await db.asUser(alice.userId, (q) => q.run("update public.students set client_id = $1 where id = $2", [alice.clientId, ava])), 1, "no-op on your own is fine");
      assert.equal(await db.asUser(alice.userId, (q) => q.run("update public.students set client_id = $1 where id = $2", [alice.clientId, ben])), 0, "pulling Bob's student into your family finds no row");
    });
    assert.deepEqual(await owner("select client_id from public.students where id = $1", [ava]), [{ client_id: alice.clientId }]);
    assert.deepEqual(await owner("select client_id from public.students where id = $1", [ben]), [{ client_id: bob.clientId }]);
  });

  test("students: the owning family can add, rename and remove its own", async () => {
    const id = await db.asUser(alice.userId, async (q) => (await q.query<{ id: string }>("insert into public.students (client_id, display_name, year_group) values ($1,'Temp','Year 7') returning id", [alice.clientId]))[0]!.id);
    assert.equal(await db.asUser(alice.userId, (q) => q.run("update public.students set display_name = 'Temp2' where id = $1", [id])), 1);
    assert.equal(await db.asUser(alice.userId, (q) => q.run("delete from public.students where id = $1", [id])), 1);
    assert.deepEqual(await owner("select 1 from public.client_students where student_id = $1", [id]), [], "link goes with the student");
  });

  test("client_students: nobody can link themselves to someone else's student", async () => {
    const [ben] = bob.studentIds as [string];
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("insert into public.client_students (client_id, student_id) values ($1,$2)", [alice.clientId, ben])), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("delete from public.client_students where student_id = $1", [alice.studentIds[0]])), PERMISSION);
    assert.deepEqual(await db.asUser(alice.userId, (q) => q.query("select 1 from public.students where id = $1", [ben])), []);
  });

  test("consents: only your own profile, only your own students; a withdrawal can't be moved or forged", async () => {
    const q1 = (me: Family, profile: string, student: string | null) =>
      db.asUser(me.userId, (q) =>
        q.run("insert into public.consents (profile_id, student_id, kind, version, text_sha256) values ($1,$2,'ai_assistant','1',$3)", [profile, student, SHA]),
      );
    await assert.rejects(q1(alice, bob.userId, null), RLS);
    await assert.rejects(q1(alice, alice.userId, bob.studentIds[0]!), RLS, "consent about someone else's child");
    assert.equal(await q1(alice, alice.userId, alice.studentIds[0]!), 1);
    assert.equal(await q1(alice, alice.userId, null), 1);
    // can't backdate or forge columns
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("insert into public.consents (profile_id, kind, version, text_sha256, granted_at) values ($1,'x1','1',$2, now() - interval '5 years')", [alice.userId, SHA])), PERMISSION);
    const [bobConsent] = await owner<{ id: string }>("select id from public.consents where profile_id = $1 limit 1", [bob.userId]);
    assert.equal(await db.asUser(alice.userId, (q) => q.run("update public.consents set withdrawn_at = now() where id = $1", [bobConsent!.id])), 0);
    const [mine] = await owner<{ id: string }>("select id from public.consents where profile_id = $1 limit 1", [alice.userId]);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.consents set profile_id = $1 where id = $2", [bob.userId, mine!.id])), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.consents set kind = 'other' where id = $1", [mine!.id])), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("delete from public.consents where id = $1", [mine!.id])), PERMISSION);
    await withWidenedGrant("grant update (profile_id) on public.consents to authenticated", "revoke update (profile_id) on public.consents from authenticated", async () => {
      await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.consents set profile_id = $1 where id = $2", [bob.userId, mine!.id])), RLS);
    });
    assert.equal(await db.asUser(alice.userId, (q) => q.run("update public.consents set withdrawn_at = now() where id = $1", [mine!.id])), 1);
  });

  test("chat_sessions: cannot create for, edit, move or hide another family's chats; cannot touch deadlines", async () => {
    const insert = (me: Family, client: string, student: string | null) =>
      db.asUser(me.userId, (q) => q.run("insert into public.chat_sessions (client_id, student_id, title) values ($1,$2,'t')", [client, student]));
    await assert.rejects(insert(alice, bob.clientId, null), RLS);
    await assert.rejects(insert(alice, alice.clientId, bob.studentIds[0]!), RLS, "a chat about someone else's child");
    // A chat that belongs to a learner is the server's to create (0010): not even their own guardian can write one through the API.
    await assert.rejects(insert(alice, alice.clientId, alice.studentIds[0]!), RLS, "a learner's chat is server-only");
    assert.equal(await insert(alice, alice.clientId, null), 1);
    const bobSession = ids.B.session!;
    assert.equal(await db.asUser(alice.userId, (q) => q.run("update public.chat_sessions set title = 'x' where id = $1", [bobSession])), 0);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.chat_sessions set deletion_requested_at = now() where id = $1", [bobSession])), PERMISSION);
    assert.deepEqual(await db.asUser(alice.userId, (q) => q.query("select public.request_chat_deletion($1) as ok", [bobSession])), [{ ok: false }], "someone else's chat: nothing happens");
    await assert.rejects(db.asAnon((q) => q.query("select public.request_chat_deletion($1)", [bobSession])), PERMISSION);
    assert.deepEqual(ids_of(await db.asUser(bob.userId, (q) => q.query("select id from public.chat_sessions where id = $1", [bobSession]))), [bobSession], "Bob's chat is untouched");
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("delete from public.chat_sessions where id = $1", [ids.A.session!])), PERMISSION);
    for (const set of ["client_id = $2", "delete_after = now() + interval '10 years'", "created_at = now()", "id = gen_random_uuid()"]) {
      await assert.rejects(db.asUser(alice.userId, (q) => q.run(`update public.chat_sessions set ${set.replace("$2", `'${bob.clientId}'`)} where id = $1`, [ids.A.session!])), PERMISSION, set);
    }
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("insert into public.chat_sessions (client_id, delete_after) values ($1, now() + interval '10 years')", [alice.clientId])), PERMISSION);
    await withWidenedGrant("grant update (client_id, student_id) on public.chat_sessions to authenticated", "revoke update (client_id, student_id) on public.chat_sessions from authenticated", async () => {
      await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.chat_sessions set client_id = $1 where id = $2", [bob.clientId, ids.A.session!])), RLS);
      await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.chat_sessions set student_id = $1 where id = $2", [bob.studentIds[0]!, ids.A.session!])), RLS);
    });
    assert.deepEqual(await owner("select client_id from public.chat_sessions where id = $1", [ids.A.session!]), [{ client_id: alice.clientId }]);
  });

  test("deleting a chat hides it at once (chat, messages, files) and it cannot be brought back by the user", async () => {
    const sessionId = await db.asUser(alice.userId, async (q) => (await q.query<{ id: string }>("insert into public.chat_sessions (client_id) values ($1) returning id", [alice.clientId]))[0]!.id);
    const mid = (await owner<{ id: string }>("insert into public.chat_messages (session_id, role, content) values ($1,'user','x') returning id", [sessionId]))[0]!.id;
    await owner("insert into public.chat_files (session_id, message_id, storage_path, bytes, content_type) values ($1,$2,'chat/del.png',5,'image/png')", [sessionId, mid]);
    assert.equal((await db.asUser(alice.userId, (q) => q.query("select 1 from public.chat_messages where session_id = $1", [sessionId]))).length, 1);
    assert.deepEqual(await db.asUser(alice.userId, (q) => q.query("select public.request_chat_deletion($1) as ok", [sessionId])), [{ ok: true }]);
    assert.deepEqual(await db.asUser(alice.userId, (q) => q.query("select public.request_chat_deletion($1) as ok", [sessionId])), [{ ok: false }], "already requested");
    assert.deepEqual(await db.asUser(alice.userId, (q) => q.query("select 1 from public.chat_sessions where id = $1", [sessionId])), []);
    assert.deepEqual(await db.asUser(alice.userId, (q) => q.query("select 1 from public.chat_messages where session_id = $1", [sessionId])), []);
    assert.deepEqual(await db.asUser(alice.userId, (q) => q.query("select 1 from public.chat_files where session_id = $1", [sessionId])), []);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.chat_sessions set deletion_requested_at = null where id = $1", [sessionId])), PERMISSION, "cannot undelete");
    // the row is still there for the retention job, which removes the storage object too
    assert.equal((await owner("select 1 from public.chat_files where session_id = $1 and storage_path = 'chat/del.png'", [sessionId])).length, 1);
  });

  test("profiles: you can rename yourself and nothing else; no role escalation, no adult flag, no new profiles", async () => {
    assert.equal(await db.asUser(alice.userId, (q) => q.run("update public.profiles set display_name = 'Alice B' where id = $1", [alice.userId])), 1);
    assert.equal(await db.asUser(alice.userId, (q) => q.run("update public.profiles set display_name = 'Pwned' where id = $1", [bob.userId])), 0);
    assert.deepEqual(await owner("select display_name from public.profiles where id = $1", [bob.userId]), [{ display_name: "Bob" }]);
    for (const set of ["role = 'ADMIN'", "role = 'TUTOR'", "adult_confirmed_at = now()", "created_at = now()", `id = '${bob.userId}'`]) {
      await assert.rejects(db.asUser(alice.userId, (q) => q.run(`update public.profiles set ${set} where id = $1`, [alice.userId])), PERMISSION, set);
    }
    await assert.rejects(db.asUser(minorish, (q) => q.run("update public.profiles set adult_confirmed_at = now() where id = $1", [minorish])), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("insert into public.profiles (id, role) values (gen_random_uuid(), 'ADMIN')")), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("delete from public.profiles where id = $1", [alice.userId])), PERMISSION);
    // the admin check is still false for her, and true for the real admin
    assert.deepEqual(await db.asUser(alice.userId, (q) => q.query("select private.is_admin() as a")), [{ a: false }]);
    assert.deepEqual(await db.asUser(adminId, (q) => q.query("select private.is_admin() as a")), [{ a: true }]);
    assert.deepEqual(await db.asUser(nobody, (q) => q.query("select private.is_admin() as a")), [{ a: false }]);
  });
});

describe("tables only the server may write", () => {
  const SERVER_ONLY_WRITE = [
    "subscriptions", "entitlements", "usage_counters", "chat_messages", "chat_files", "tutors",
    "tuition_assignments", "assignment_students", "client_students", "resources",
    "resource_files", "billing_customers", "admin_grants", "download_events", "stripe_webhook_events",
  ];
  const NEVER_READABLE = ["resource_files", "billing_customers", "admin_grants", "download_events", "stripe_webhook_events"];

  for (const table of SERVER_ONLY_WRITE) {
    test(`${table}: signed-in users and anon can neither insert, update, delete nor truncate`, async () => {
      const [{ column_name }] = await owner<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 and is_identity = 'NO' and is_generated = 'NEVER' order by ordinal_position limit 1",
        [table],
      );
      for (const run of [(f: (q: any) => Promise<unknown>) => db.asUser(alice.userId, f), (f: (q: any) => Promise<unknown>) => db.asAnon(f), (f: (q: any) => Promise<unknown>) => db.asUser(adminId, f)]) {
        await assert.rejects(run((q) => q.run(`insert into public.${table} default values`)), PERMISSION);
        await assert.rejects(run((q) => q.run(`update public.${table} set ${column_name} = ${column_name}`)), PERMISSION);
        await assert.rejects(run((q) => q.run(`delete from public.${table}`)), PERMISSION);
        await assert.rejects(run((q) => q.exec(`truncate public.${table}`)), PERMISSION);
      }
    });
  }

  for (const table of NEVER_READABLE) {
    test(`${table}: not even readable by signed-in users, admins or anon (service role only)`, async () => {
      await assert.rejects(db.asUser(alice.userId, (q) => q.query(`select * from public.${table}`)), PERMISSION);
      await assert.rejects(db.asUser(adminId, (q) => q.query(`select * from public.${table}`)), PERMISSION);
      await assert.rejects(db.asAnon((q) => q.query(`select * from public.${table}`)), PERMISSION);
      assert.ok((await db.asService((q) => q.query(`select * from public.${table}`))).length > 0, "the server can read it");
    });
  }

  test("a user cannot grant themselves access: entitlements, subscriptions and grants are untouchable", async () => {
    await assert.rejects(
      db.asUser(carol.userId, (q) => q.run("insert into public.entitlements (client_id, source, admin_grant_id) values ($1,'admin_grant',$2)", [carol.clientId, ids.A.grant!])),
      PERMISSION,
    );
    await assert.rejects(
      db.asUser(carol.userId, (q) =>
        q.run("insert into public.subscriptions (client_id, stripe_subscription_id, stripe_price_id, status, plan_interval) values ($1,'sub_fake','price_x','active','year')", [carol.clientId]),
      ),
      PERMISSION,
    );
    await assert.rejects(db.asUser(carol.userId, (q) => q.run("update public.subscriptions set status = 'active', current_period_end = now() + interval '1 year'")), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.entitlements set ends_at = null where client_id = $1", [alice.clientId])), PERMISSION);
    await assert.rejects(db.asUser(carol.userId, (q) => q.run("insert into public.download_events (client_id, resource_id) values ($1,$2)", [carol.clientId, res.members])), PERMISSION);
    await assert.rejects(db.asUser(carol.userId, (q) => q.run("insert into public.stripe_webhook_events (event_id, event_type) values ('evt_forged','invoice.paid')")), PERMISSION);
    assert.deepEqual(await db.asUser(carol.userId, (q) => q.query("select 1 from public.entitlements")), []);
  });

  test("client_is_enrolled (derived enrolment) is callable by the server only and follows ACTIVE assignments", async () => {
    await assert.rejects(db.asUser(alice.userId, (q) => q.query("select public.client_is_enrolled($1)", [alice.clientId])), PERMISSION);
    await assert.rejects(db.asAnon((q) => q.query("select public.client_is_enrolled($1)", [alice.clientId])), PERMISSION);
    const enrolled = (f: Family) => db.asService(async (q) => (await q.query<{ e: boolean }>("select public.client_is_enrolled($1) as e", [f.clientId]))[0]!.e);
    assert.equal(await enrolled(alice), true, "Ava is on active GA and GG");
    assert.equal(await enrolled(dora), true, "Dee is on the active group GG");
    assert.equal(await enrolled(bob), false, "Ben's only assignment is PAUSED");
    assert.equal(await enrolled(carol), false, "Cy's assignment has ENDED");
    await owner("update public.tuition_assignments set status = 'ACTIVE' where id = $1", [asg.GB]);
    assert.equal(await enrolled(bob), true);
    await owner("update public.tuition_assignments set status = 'PAUSED' where id = $1", [asg.GB]);
    assert.equal(await enrolled(bob), false);
    assert.equal(await enrolled({ ...carol, clientId: "00000000-0000-0000-0000-000000000000" }), false);
  });

  test("users cannot create objects in the database or reach the private schema directly", async () => {
    await assert.rejects(db.asUser(alice.userId, (q) => q.exec("create table public.evil (id int)")), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.exec("create function public.auth_uid() returns uuid language sql as 'select null::uuid'")), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.exec("create schema evil")), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.exec("create table private.evil (id int)")), PERMISSION);
    await assert.rejects(db.asAnon((q) => q.query("select private.is_admin()")), PERMISSION);
    await assert.rejects(db.asAnon((q) => q.query("select private.my_client_id()")), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.query("select * from auth.users")), PERMISSION);
    await assert.rejects(db.asAnon((q) => q.query("select * from auth.users")), PERMISSION);
  });
});

describe("the public catalogue", () => {
  test("anon sees published resources only: no drafts, no scheduled items", async () => {
    const rows = await db.asAnon((q) => q.query("select slug from public.resources order by slug"));
    assert.deepEqual(rows.map((r) => r.slug), ["pub-members", "pub-sample"]);
  });

  test("members-only resources are listed in the catalogue, but anon and users can never read file paths", async () => {
    const [m] = await db.asAnon((q) => q.query("select title, access_tier from public.resources where id = $1", [res.members]));
    assert.deepEqual(m, { title: "Members paper", access_tier: "members" });
    await assert.rejects(db.asAnon((q) => q.query("select storage_path from public.resource_files")), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.query("select storage_path from public.resource_files")), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.query("select r.title, f.storage_path from public.resources r join public.resource_files f on f.resource_id = r.id")), PERMISSION);
    const paths = await db.asService((q) => q.query("select storage_path from public.resource_files"));
    assert.equal(paths.length, 4, "the server can read every file row, including members-only and drafts");
  });

  test("the catalogue table itself holds no path column", async () => {
    const cols = await owner<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'resources'");
    assert.deepEqual(cols.map((c) => c.column_name).filter((c) => /path|url|bucket|checksum/i.test(c)), []);
  });

  test("signed-in users see the same published set; the admin also sees drafts and scheduled items", async () => {
    assert.deepEqual((await db.asUser(alice.userId, (q) => q.query("select slug from public.resources order by slug"))).map((r) => r.slug), ["pub-members", "pub-sample"]);
    assert.deepEqual((await db.asUser(adminId, (q) => q.query("select slug from public.resources order by slug"))).map((r) => r.slug), ["draft", "pub-members", "pub-sample", "scheduled"]);
  });

  test("a scheduled resource appears once its date passes, with no write to the row", async () => {
    await owner("update public.resources set published_at = now() - interval '1 second' where id = $1", [res.scheduled]);
    try {
      assert.equal((await db.asAnon((q) => q.query("select 1 from public.resources where id = $1", [res.scheduled]))).length, 1);
    } finally {
      await owner("update public.resources set published_at = now() + interval '1 day' where id = $1", [res.scheduled]);
    }
    assert.equal((await db.asAnon((q) => q.query("select 1 from public.resources where id = $1", [res.scheduled]))).length, 0);
  });

  test("anon cannot read anything else in the schema", async () => {
    const others = (await owner<{ relname: string }>("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname <> 'resources'")).map((r) => r.relname);
    assert.ok(others.length >= 19);
    for (const t of others) {
      await assert.rejects(db.asAnon((q) => q.query(`select * from public.${t}`)), PERMISSION, t);
    }
  });

  test("nobody can unpublish, edit or insert resources through the API; only the service role can", async () => {
    await assert.rejects(db.asAnon((q) => q.run("update public.resources set published_at = null")), PERMISSION);
    await assert.rejects(db.asUser(alice.userId, (q) => q.run("update public.resources set access_tier = 'free_sample' where id = $1", [res.members])), PERMISSION);
    await assert.rejects(db.asUser(adminId, (q) => q.run("update public.resources set authorship = 'x' where id = $1", [res.members])), PERMISSION);
    assert.equal(await db.asService((q) => q.run("update public.resources set version = version where id = $1", [res.members])), 1);
  });
});

describe("administrators", () => {
  test("an admin can read accounts for support, but not conversations, consents or usage", async () => {
    assert.equal((await db.asUser(adminId, (q) => q.query("select 1 from public.clients"))).length, 4);
    assert.equal((await db.asUser(adminId, (q) => q.query("select 1 from public.students"))).length, 5);
    assert.ok((await db.asUser(adminId, (q) => q.query("select 1 from public.subscriptions"))).length >= 2);
    assert.ok((await db.asUser(adminId, (q) => q.query("select 1 from public.profiles"))).length >= 8);
    for (const t of ["chat_sessions", "chat_messages", "chat_files", "consents", "usage_counters"]) {
      assert.deepEqual(await db.asUser(adminId, (q) => q.query(`select 1 from public.${t}`)), [], t);
    }
  });

  test("an admin's session is not a write path: edits to other families still find no row", async () => {
    assert.equal(await db.asUser(adminId, (q) => q.run("update public.students set display_name = 'x' where id = $1", [alice.studentIds[0]!])), 0);
    assert.equal(await db.asUser(adminId, (q) => q.run("update public.profiles set display_name = 'x' where id = $1", [alice.userId])), 0);
    await assert.rejects(db.asUser(adminId, (q) => q.run("insert into public.students (client_id, display_name) values ($1,'x')", [alice.clientId])), RLS);
    await assert.rejects(db.asUser(adminId, (q) => q.run("update public.profiles set role = 'ADMIN' where id = $1", [alice.userId])), PERMISSION);
  });

  test("being named ADMIN in sign-up metadata does not make a user an admin", async () => {
    const mallory = await db.createUser({ displayName: "Mallory", adult: true, metadata: { role: "ADMIN", user_role: "ADMIN" } });
    assert.deepEqual(await db.asUser(mallory, (q) => q.query("select private.is_admin() as a")), [{ a: false }]);
    assert.deepEqual(await db.asUser(mallory, (q) => q.query("select 1 from public.clients")), []);
  });
});

describe("the service role", () => {
  test("bypasses RLS: it sees every family (the server is trusted, the browser is not)", async () => {
    assert.equal((await db.asService((q) => q.query("select 1 from public.clients"))).length, 4);
    assert.equal((await db.asService((q) => q.query("select 1 from public.chat_messages"))).length >= 2, true);
    assert.equal((await db.asService((q) => q.query("select 1 from public.resources"))).length, 4);
  });
});
