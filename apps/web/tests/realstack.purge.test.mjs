import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadTsFrom } from "./_tsLoader.mjs";

/**
 * The purge tool against the REAL local Supabase stack (launch checklist 3.7.6): what only real services can show.
 *
 *   - After a purge, a query for the person's id AND their name finds nothing in ANY table in `public`, nor in `auth.users`, nor in the
 *     storage bucket. That sweep walks every column of every table from `information_schema`, so a table added later is included
 *     automatically and a purge that forgets it fails here.
 *   - The person cannot sign in afterwards. Real GoTrue is the only thing that can answer that.
 *   - The log row holds counts and nothing else: no id, no name, no email, anywhere in it.
 *   - A sibling, the sibling's shared lesson, the family and another family are untouched.
 *
 * The migration's plpgsql (0018) runs on real Postgres here, not PGlite, which is where the Paper Tutor's double-encoded JSON was
 * found (docs/SUPABASE_REAL_STACK.md, finding 14). Skipped unless SUPABASE_LOCAL=1:
 *   SUPABASE_LOCAL=1 node --test tests/realstack.purge.test.mjs
 */

const ENABLED = process.env.SUPABASE_LOCAL === "1";
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const DOMAIN = "accounts.learnthrivetuition.co.uk";
const BUCKET = "chat-uploads";

describe("the purge tool on the real local stack", { skip: ENABLED ? false : "set SUPABASE_LOCAL=1 with the local stack running (npm run supabase:start)" }, () => {
  const { createExecutor } = loadTsFrom(import.meta.url, "../src/lib/db.ts");
  const { createSqlDataProvider } = loadTsFrom(import.meta.url, "../../../packages/data/src/sqlProvider.ts");
  const { deleteStoredObjects } = loadTsFrom(import.meta.url, "../src/lib/purge/storage.ts");

  const run = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  /** Distinctive enough that a sweep for it cannot match anything incidental. */
  const LEAVING_NAME = `Purgeable-${run}`;
  const SIBLING_NAME = `Staying-${run}`;
  const PASSWORD = "a password for the purge test";

  let stack;
  let sql;
  let close;
  let provider;
  let env;
  const made = [];
  const api = (path, init = {}, key = stack.SECRET_KEY) =>
    fetch(`${stack.API_URL}${path}`, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const signIn = (username, password) =>
    fetch(`${stack.API_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: stack.PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${username}@${DOMAIN}`, password }),
    });

  /** A login made the way the site makes one: the Auth Admin API, then the provision_account transaction. */
  async function login(username, displayName, linkedEmail, role, over = {}) {
    const reply = await api("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: `${username}@${DOMAIN}`, password: PASSWORD, email_confirm: true, user_metadata: { display_name: displayName } }),
    });
    assert.equal(reply.status, 200, `could not create ${username}`);
    const { id } = await reply.json();
    made.push(id);
    const [{ provision_account: outcome }] = await sql`
      select public.provision_account(${id}::uuid, ${username}, ${linkedEmail}, ${displayName}, ${role},
        ${over.tutorId ?? null}::uuid, ${over.studentId ?? null}::uuid, null::uuid, now())`;
    assert.equal(outcome, "ok", `provision_account refused ${username}: ${outcome}`);
    await sql`update public.profiles set must_change_password = false where id = ${id}`;
    return id;
  }

  const fixture = {};

  before(async () => {
    stack = JSON.parse(spawnSync("npx", ["supabase", "status", "--output", "json"], { cwd: REPO, encoding: "utf8", shell: true }).stdout);
    for (const url of [stack.API_URL, stack.DB_URL]) assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname), "local stack only");
    env = { SUPABASE_URL: stack.API_URL, SUPABASE_SERVICE_ROLE_KEY: stack.SECRET_KEY };
    sql = postgres(stack.DB_URL, { max: 3, prepare: false, onnotice: () => {} });
    const db = await createExecutor(stack.DB_URL);
    close = db.close;
    provider = createSqlDataProvider(db.executor);

    // The family that is leaving, and a family next door that must be untouched.
    fixture.parent = await login(`rsp-parent-${run}`, "Purge Parent", `rsp-parent-${run}@example.com`, "CLIENT");
    [{ id: fixture.clientId }] = await sql`select id from public.clients where owner_profile_id = ${fixture.parent}`;
    fixture.neighbourParent = await login(`rsp-next-${run}`, "Next Door", `rsp-next-${run}@example.com`, "CLIENT");
    [{ id: fixture.neighbourClient }] = await sql`select id from public.clients where owner_profile_id = ${fixture.neighbourParent}`;

    [{ id: fixture.leaving }] = await sql`insert into public.students (client_id, display_name, year_group) values (${fixture.clientId}, ${LEAVING_NAME}, 'Year 9') returning id`;
    [{ id: fixture.sibling }] = await sql`insert into public.students (client_id, display_name, year_group) values (${fixture.clientId}, ${SIBLING_NAME}, 'Year 7') returning id`;
    [{ id: fixture.neighbourChild }] = await sql`insert into public.students (client_id, display_name) values (${fixture.neighbourClient}, ${`Neighbour-${run}`}) returning id`;

    fixture.learnerUsername = `rsp-kid-${run}`;
    fixture.learner = await login(fixture.learnerUsername, LEAVING_NAME, `rsp-parent-${run}@example.com`, "STUDENT", { studentId: fixture.leaving });

    [{ id: fixture.tutorId }] = await sql`insert into public.tutors (display_name, subjects, contact_email) values (${`Purge Tutor ${run}`}, ${["Maths"]}, ${`rsp-tutor-${run}@example.com`}) returning id`;
    fixture.tutorProfile = await login(`rsp-tutor-${run}`, `Purge Tutor ${run}`, `rsp-tutor-${run}@example.com`, "TUTOR", { tutorId: fixture.tutorId });

    [{ id: fixture.assignmentId }] = await sql`
      insert into public.tuition_assignments (title, subject, tutor_id, status) values (${`Maths for ${LEAVING_NAME}`}, 'Maths', ${fixture.tutorId}, 'ACTIVE') returning id`;
    await sql`insert into public.assignment_students (assignment_id, student_id) values (${fixture.assignmentId}, ${fixture.leaving}), (${fixture.assignmentId}, ${fixture.sibling})`;

    // One lesson only the leaving child is on, one shared with the sibling. Both name the child in their free text on purpose.
    const lesson = async (title, students) => {
      const [{ id }] = await sql`
        insert into public.lessons (assignment_id, tutor_id, title, subject, start_at, duration_minutes, location_type, notes, status)
        values (${fixture.assignmentId}, ${fixture.tutorId}, ${title}, 'Maths', now() - interval '7 days', 60, 'ONLINE', ${`Notes about ${LEAVING_NAME}.`}, 'COMPLETED') returning id`;
      for (const s of students) await sql`insert into public.lesson_students (lesson_id, student_id) values (${id}, ${s})`;
      return id;
    };
    fixture.soleLesson = await lesson(`${LEAVING_NAME} alone`, [fixture.leaving]);
    fixture.sharedLesson = await lesson(`${LEAVING_NAME} and ${SIBLING_NAME}`, [fixture.leaving, fixture.sibling]);

    await sql`insert into public.lesson_attendance (lesson_id, student_id, status, marked_by) values (${fixture.soleLesson}, ${fixture.leaving}, 'ATTENDED', ${fixture.tutorProfile})`;
    await sql`insert into public.lesson_attendance (lesson_id, student_id, status, marked_by) values (${fixture.sharedLesson}, ${fixture.leaving}, 'LATE', ${fixture.tutorProfile})`;
    await sql`insert into public.lesson_attendance (lesson_id, student_id, status, marked_by) values (${fixture.sharedLesson}, ${fixture.sibling}, 'ATTENDED', ${fixture.tutorProfile})`;
    await sql`insert into public.lesson_reports (lesson_id, tutor_id, status, public_summary, internal_tutor_notes)
      values (${fixture.soleLesson}, ${fixture.tutorId}, 'APPROVED', ${`${LEAVING_NAME} did well.`}, ${`Private note about ${LEAVING_NAME}.`})`;
    [{ id: fixture.keptReport }] = await sql`insert into public.lesson_reports (lesson_id, tutor_id, status, public_summary)
      values (${fixture.sharedLesson}, ${fixture.tutorId}, 'APPROVED', ${`${LEAVING_NAME} and ${SIBLING_NAME} both worked hard.`}) returning id`;
    await sql`insert into public.lesson_activity (lesson_id, type, message, actor_id) values (${fixture.sharedLesson}, 'ATTENDANCE_MARKED', ${`Marked ${LEAVING_NAME} late`}, ${fixture.tutorProfile})`;
    await sql`insert into public.notifications (user_id, type, message) values (${fixture.learner}, 'REPORT_AVAILABLE', ${`A report for ${LEAVING_NAME}`})`;
    await sql`insert into public.identity_audit (actor_profile_id, action, client_id, student_id) values (${fixture.parent}, 'learner_suspended', ${fixture.clientId}, ${fixture.leaving})`;

    // A conversation with an upload, so the bucket sweep has something real to find.
    [{ id: fixture.chatId }] = await sql`insert into public.chat_sessions (client_id, student_id, title) values (${fixture.clientId}, ${fixture.leaving}, ${`Homework for ${LEAVING_NAME}`}) returning id`;
    // The bucket only takes the three types the upload route allows (chat_files_content_type_check).
    fixture.objectPath = `${fixture.clientId}/${fixture.chatId}/${run}-sum.png`;
    await sql`insert into public.chat_files (session_id, bucket, storage_path, bytes, content_type, extracted_text)
      values (${fixture.chatId}, ${BUCKET}, ${fixture.objectPath}, 12, 'image/png', ${`Worked by ${LEAVING_NAME}`})`;
    const upload = await fetch(`${stack.API_URL}/storage/v1/object/${BUCKET}/${fixture.objectPath}`, {
      method: "POST",
      headers: { apikey: stack.SECRET_KEY, Authorization: `Bearer ${stack.SECRET_KEY}`, "Content-Type": "image/png" },
      body: "hello there",
    });
    assert.ok(upload.ok, `could not upload the test object (${upload.status})`);
  });

  after(async () => {
    for (const id of made) await api(`/auth/v1/admin/users/${id}`, { method: "DELETE" });
    await close?.();
    await sql?.end({ timeout: 5 });
  });

  /**
   * Every column of every table in `public`, asked whether it holds any of these needles: a uuid column is compared for equality, a
   * text or jsonb column is searched for the name. Returns "table.column" for each hit.
   */
  async function sweepDatabase(ids, names) {
    const columns = await sql`
      select table_name, column_name, data_type
        from information_schema.columns
       where table_schema = 'public'
         and data_type in ('uuid', 'text', 'character varying', 'jsonb', 'json')
       order by table_name, column_name`;
    const hits = [];
    for (const c of columns) {
      const where =
        c.data_type === "uuid"
          ? sql`${sql(c.column_name)} = any(${ids}::uuid[])`
          : c.data_type === "jsonb" || c.data_type === "json"
            ? sql`${sql(c.column_name)}::text ilike any(${names.map((n) => `%${n}%`)})`
            : sql`${sql(c.column_name)} ilike any(${names.map((n) => `%${n}%`)})`;
      const [row] = await sql`select count(*)::int as n from ${sql(c.table_name)} where ${where}`;
      if (row.n > 0) hits.push(`${c.table_name}.${c.column_name} (${row.n})`);
    }
    return hits;
  }

  /** Objects in the bucket whose path mentions anything in `needles`. */
  async function sweepBucket(needles) {
    const rows = await sql`select name from storage.objects where bucket_id = ${BUCKET}`;
    return rows.map((r) => r.name).filter((name) => needles.some((needle) => name.includes(needle)));
  }

  test("before the purge: the learner signs in, and their records are findable", async () => {
    assert.equal((await signIn(fixture.learnerUsername, PASSWORD)).status, 200, "the learner can sign in");
    const hits = await sweepDatabase([fixture.leaving, fixture.learner], [LEAVING_NAME]);
    assert.ok(hits.length > 5, `the fixture should be findable before it is purged, found: ${hits.join(", ")}`);
    assert.deepEqual(await sweepBucket([fixture.chatId]), [fixture.objectPath], "the upload is in the bucket");
  });

  test("the preview names the files and logins, and does not name the person", async () => {
    const preview = await provider.purges.previewStudent(fixture.leaving);
    assert.ok(preview);
    assert.deepEqual(preview.files, [fixture.objectPath], "the stored object is listed, so it can go before its row");
    assert.deepEqual(preview.profileIds, [fixture.learner], "the learner login is listed");
    assert.ok(preview.notes.length > 0);
    assert.equal(JSON.stringify({ removes: preview.removes, keeps: preview.keeps }).includes(LEAVING_NAME), false, "a preview never names the person");
    assert.ok(preview.keeps.every((k) => k.reason.length > 0), "everything kept says why");
  });

  test("the purge: files first, then the rows and the log in one transaction, then the Auth user", async () => {
    const preview = await provider.purges.previewStudent(fixture.leaving);
    // The same order lib/actions/purge.ts uses, with the site's own storage helper.
    const stored = await deleteStoredObjects(preview.files, env);
    assert.deepEqual(stored, { removed: 1, failed: 0 });

    const record = await provider.purges.purgeStudent(fixture.leaving, fixture.parent);
    assert.equal(record.kind, "STUDENT");
    assert.equal(record.actorId, fixture.parent);
    assert.ok(Object.values(record.counts).every((n) => typeof n === "number"), "counts are numbers");
    assert.ok(record.counts.lessonsRemoved >= 1 && record.counts.lessonsKept >= 1, JSON.stringify(record.counts));

    for (const profileId of preview.profileIds) {
      const gone = await api(`/auth/v1/admin/users/${profileId}`, { method: "DELETE" });
      assert.ok(gone.ok, `the Auth user should be deletable (${gone.status})`);
    }
  });

  test("after the purge: the id and the name are in no table, and in no object in the bucket", async () => {
    const hits = await sweepDatabase([fixture.leaving, fixture.learner], [LEAVING_NAME]);
    assert.deepEqual(hits, [], `the purged student is still findable in: ${hits.join(", ")}`);
    assert.deepEqual(await sweepBucket([fixture.chatId, fixture.leaving]), [], "no object of theirs is left in the bucket");
    const auth = await sql`select count(*)::int as n from auth.users where id = ${fixture.learner}`;
    assert.equal(auth[0].n, 0, "the Auth user is gone too");
  });

  test("after the purge: the learner cannot sign in", async () => {
    const reply = await signIn(fixture.learnerUsername, PASSWORD);
    assert.notEqual(reply.status, 200, "a purged learner must not be able to sign in");
    assert.equal(reply.status, 400, "and gets the same answer as any unknown login");
  });

  test("the log row records that it happened, and nothing about who", async () => {
    const [row] = await sql`select id, kind, actor_profile_id, counts from public.data_purges order by at desc limit 1`;
    assert.equal(row.kind, "STUDENT");
    assert.equal(row.actor_profile_id, fixture.parent, "the administrator who ran it, which is not the person purged");
    const text = JSON.stringify(row.counts);
    for (const needle of [LEAVING_NAME, fixture.leaving, fixture.learner, fixture.learnerUsername, DOMAIN]) {
      assert.equal(text.includes(needle), false, `the log must not hold ${needle}`);
    }
    assert.ok(Object.values(row.counts).every((n) => Number.isInteger(n)), "counts only");
  });

  test("the sibling, their shared lesson, the family and the family next door are untouched", async () => {
    assert.ok(await provider.students.get(fixture.sibling), "the sibling's record stays");
    assert.ok(await provider.clients.get(fixture.clientId), "the family stays: it still has a child");
    assert.ok(await provider.students.get(fixture.neighbourChild), "the family next door is untouched");
    assert.ok(await provider.clients.get(fixture.neighbourClient));

    const kept = await provider.lessons.get(fixture.sharedLesson);
    assert.ok(kept, "the shared lesson stays");
    assert.deepEqual(kept.studentIds, [fixture.sibling], "with the leaving child taken off it");
    assert.equal(kept.title.includes(LEAVING_NAME), false, "and their name taken out of its title");
    assert.ok(kept.title.includes(SIBLING_NAME), "while the sibling's name stays");
    assert.equal(await provider.lessons.get(fixture.soleLesson), null, "the lesson that was only theirs is gone");

    const report = await provider.reports.get(fixture.keptReport);
    assert.ok(report, "the report the sibling's lesson needs stays");
    assert.equal(report.publicSummary.includes(LEAVING_NAME), false, "scrubbed of the purged child's name");
    assert.ok(report.publicSummary.includes(SIBLING_NAME));

    const sibling = await sql`select count(*)::int as n from public.lesson_attendance where student_id = ${fixture.sibling}`;
    assert.equal(sibling[0].n, 1, "the sibling's own attendance is still there");
  });

  test("a second purge of the same student changes nothing and writes no log row", async () => {
    const before = await sql`select count(*)::int as n from public.data_purges`;
    assert.equal(await provider.purges.previewStudent(fixture.leaving), null);
    assert.equal(await provider.purges.purgeStudent(fixture.leaving, fixture.parent), null);
    const after = await sql`select count(*)::int as n from public.data_purges`;
    assert.equal(after[0].n, before[0].n, "nothing to purge means no log row");
  });
});
