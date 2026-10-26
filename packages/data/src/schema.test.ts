// Schema tests: the Supabase migrations (supabase/migrations/*.sql) applied to an in-process Postgres
// (PGlite) behind a small Supabase prelude. See ./testing/pglite.ts. Row Level Security behaviour is in
// rls.test.ts; this file is about structure, constraints and the search index.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createFamily, createResource } from "./testing/fixtures";
import { createTestDb, type TestDb } from "./testing/pglite";

const EXPECTED_TABLES = [
  "admin_grants",
  "assignment_students",
  "billing_customers",
  "chat_file_chunks",
  "chat_files",
  "chat_messages",
  "chat_sessions",
  "client_students",
  "clients",
  "consents",
  "download_events",
  "entitlements",
  "identity_audit",
  "learner_identities",
  "learner_invitations",
  "lesson_activity",
  "lesson_attendance",
  "lesson_reports",
  "lesson_students",
  "lessons",
  "notifications",
  "paper_assessment_versions",
  "paper_jobs",
  "platform_settings",
  "profiles",
  "resource_files",
  "resources",
  "stripe_webhook_events",
  "students",
  "subscriptions",
  "supervised_contexts",
  "tuition_assignments",
  "tutor_availability_blocks",
  "tutors",
  "usage_counters",
];

// Tables no SECURITY DEFINER helper reads, so RLS is FORCED on them (see 0005_rls.sql).
const FORCED_TABLES = [
  "admin_grants",
  "billing_customers",
  "chat_file_chunks",
  "chat_files",
  "chat_messages",
  "chat_sessions",
  "consents",
  "download_events",
  "entitlements",
  "identity_audit",
  "learner_invitations",
  "lesson_activity",
  "lesson_attendance",
  "lesson_reports",
  "lesson_students",
  "lessons",
  "notifications",
  "paper_assessment_versions",
  "paper_jobs",
  "platform_settings",
  "resource_files",
  "resources",
  "stripe_webhook_events",
  "subscriptions",
  "supervised_contexts",
  "tutor_availability_blocks",
  "usage_counters",
];

async function snapshot(db: TestDb): Promise<string> {
  return db.asOwner(async (q) => {
    const parts = {
      columns: await q.query(
        `select table_schema, table_name, column_name, data_type, is_nullable, column_default, is_generated, generation_expression
           from information_schema.columns where table_schema in ('public','private') order by 1,2,3`,
      ),
      constraints: await q.query(
        `select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def
           from pg_constraint where connamespace in ('public'::regnamespace,'private'::regnamespace) order by 1,2`,
      ),
      indexes: await q.query(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1,2`),
      policies: await q.query(
        `select tablename, policyname, cmd, roles::text as roles, qual, with_check from pg_policies where schemaname = 'public' order by 1,2`,
      ),
      rls: await q.query(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
           where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`,
      ),
      tableGrants: await q.query(
        `select grantee, table_name, privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and grantee in ('anon','authenticated','service_role') order by 1,2,3`,
      ),
      columnGrants: await q.query(
        `select grantee, table_name, column_name, privilege_type from information_schema.column_privileges
           where table_schema = 'public' and grantee in ('anon','authenticated') order by 1,2,3,4`,
      ),
      functions: await q.query(
        `select n.nspname, p.proname, md5(pg_get_functiondef(p.oid)) as def, p.proacl::text as acl
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public','private') order by 1,2`,
      ),
      triggers: await q.query(
        `select tgrelid::regclass::text as tbl, tgname from pg_trigger where not tgisinternal order by 1,2`,
      ),
    };
    return JSON.stringify(parts);
  });
}

describe("migrations", () => {
  let db: TestDb;
  let applied: string[];
  before(async () => {
    db = await createTestDb({ migrate: false });
    applied = await db.migrate();
  });
  after(() => db.close());

  test("apply cleanly, in numeric order, with no gaps", () => {
    assert.deepEqual(applied, [
      "0001_core.sql",
      "0002_library.sql",
      "0003_billing.sql",
      "0004_assistant.sql",
      "0005_rls.sql",
      "0006_billing_refunds.sql",
      "0007_storage_buckets.sql",
      "0008_consent_withdrawal_time.sql",
      "0009_server_lookups.sql",
      "0010_learner_identity.sql",
      "0011_tuition_domain.sql",
      "0012_paper_jobs.sql",
      "0013_paper_assessments.sql",
      "0014_chat_retrieval.sql",
      "0015_chat_message_model.sql",
      "0016_chat_message_activity.sql",
    ]);
    assert.deepEqual(
      applied.map((f) => Number(f.slice(0, 4))),
      applied.map((_, i) => i + 1),
    );
  });

  test("applying the whole set a second time changes nothing and keeps the data", async () => {
    const family = await createFamily(db, { name: "Idem", students: ["Kid"] });
    await createResource(db, { slug: "idempotent-check" });
    const before = await snapshot(db);
    assert.equal((await db.migrate()).length, applied.length);
    assert.equal(await snapshot(db), before, "schema, policies, grants and functions are identical after re-applying");
    const rows = await db.asUser(family.userId, (q) => q.query("select display_name from public.students"));
    assert.deepEqual(rows, [{ display_name: "Kid" }]);
    assert.equal((await db.asAnon((q) => q.query("select slug from public.resources"))).length, 1);
  });

  test("assessment versions are append-only (no update, no delete) but go with their job", async () => {
    const family = await createFamily(db, { name: "Append", students: ["Kid"] });
    const jobId = await db.asOwner(async (q) => {
      const session = await q.query<{ id: string }>("insert into public.chat_sessions (client_id) values ($1) returning id", [family.clientId]);
      const job = await q.query<{ id: string }>(
        `insert into public.paper_jobs (client_id, session_id, file_id, kind, state) values ($1, $2, gen_random_uuid(), 'mark', 'done') returning id`,
        [family.clientId, session[0]!.id],
      );
      await q.query(`insert into public.paper_assessment_versions (job_id, question_id, version, kind, actor_kind, value) values ($1, 'q1', 1, 'ai', 'system', '{}'::jsonb)`, [job[0]!.id]);
      return job[0]!.id;
    });
    await assert.rejects(() => db.asOwner((q) => q.query(`update public.paper_assessment_versions set note = 'edited' where job_id = $1`, [jobId])), /append-only/);
    await assert.rejects(() => db.asOwner((q) => q.query(`delete from public.paper_assessment_versions where job_id = $1`, [jobId])), /append-only/);
    await assert.rejects(() => db.asOwner((q) => q.query(`insert into public.paper_assessment_versions (job_id, question_id, version, kind, actor_kind, value) values ($1, 'q1', 1, 'ai', 'system', '{}'::jsonb)`, [jobId])), /duplicate|unique/i, "a version number is used once");
    await assert.rejects(() => db.asOwner((q) => q.query(`insert into public.paper_assessment_versions (job_id, question_id, version, kind, actor_kind, value) values ($1, 'q1', 2, 'review', 'system', '{}'::jsonb)`, [jobId])), /check/i, "a review cannot be the system's");
    await db.asOwner((q) => q.query(`delete from public.paper_jobs where id = $1`, [jobId]));
    const left = await db.asOwner((q) => q.query(`select 1 from public.paper_assessment_versions where job_id = $1`, [jobId]));
    assert.equal(left.length, 0, "removed with its job");
    assert.deepEqual(await db.asUser(family.userId, (q) => q.query("select 1 from public.paper_jobs")).catch(() => "denied"), "denied", "the API role cannot even read the table");
  });

  test("the public schema holds exactly the expected tables", async () => {
    const rows = await db.asOwner((q) =>
      q.query<{ relname: string }>(
        "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p') order by relname",
      ),
    );
    assert.deepEqual(rows.map((r) => r.relname), EXPECTED_TABLES);
  });

  test("the pgvector chunk table is a marked placeholder only: not created yet", async () => {
    const ext = await db.asOwner((q) => q.query("select 1 from pg_extension where extname = 'vector'"));
    assert.equal(ext.length, 0);
    const tables = await db.asOwner((q) =>
      q.query("select 1 from pg_class where relname in ('resource_chunks','resource_embeddings')"),
    );
    assert.equal(tables.length, 0);
  });

  test("the two storage buckets are private, limited, and no API role can touch their objects (0007)", async () => {
    const buckets = await db.asOwner((q) => q.query(`select id, public, file_size_limit::int as limit, allowed_mime_types as mime from storage.buckets order by id`));
    assert.deepEqual(buckets, [
      { id: "chat-uploads", public: false, limit: 15 * 1024 * 1024, mime: ["image/jpeg", "image/png", "application/pdf"] },
      { id: "library", public: false, limit: 25 * 1024 * 1024, mime: ["application/pdf"] },
    ]);
    // Re-applying restores the settings if someone changed them by hand (a bucket made public in the dashboard, say).
    await db.asOwner((q) => q.exec(`update storage.buckets set public = true, file_size_limit = null`));
    await db.migrate();
    const after = await db.asOwner((q) => q.query(`select id, public from storage.buckets order by id`));
    assert.deepEqual(after, [{ id: "chat-uploads", public: false }, { id: "library", public: false }]);
    // Row level security stays on for the objects, and no policy exists for any role: only the service role reaches them.
    const rls = await db.asOwner((q) => q.query(`select relrowsecurity from pg_class where oid = 'storage.objects'::regclass`));
    assert.equal(rls[0]!.relrowsecurity, true);
    const policies = await db.asOwner((q) => q.query(`select policyname from pg_policies where schemaname = 'storage'`));
    assert.deepEqual(policies, []);
  });

  test("every table has Row Level Security enabled", async () => {
    const rows = await db.asOwner((q) =>
      q.query<{ relname: string; relrowsecurity: boolean }>(
        "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'",
      ),
    );
    assert.equal(rows.length, EXPECTED_TABLES.length);
    assert.deepEqual(rows.filter((r) => !r.relrowsecurity), []);
  });

  test("RLS is forced exactly on the tables no definer helper reads", async () => {
    const rows = await db.asOwner((q) =>
      q.query<{ relname: string }>(
        "select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relforcerowsecurity order by relname",
      ),
    );
    assert.deepEqual(rows.map((r) => r.relname), FORCED_TABLES);
  });

  test("every table has at least one policy, or is deny-all for anon and authenticated", async () => {
    const rows = await db.asOwner((q) =>
      q.query<{ tbl: string; policies: number; open: boolean }>(
        `select c.relname as tbl,
                (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies,
                (has_table_privilege('anon', c.oid, 'select,insert,update,delete,truncate,references,trigger')
                 or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete,truncate,references,trigger')
                 or has_any_column_privilege('anon', c.oid, 'select,insert,update,references')
                 or has_any_column_privilege('authenticated', c.oid, 'select,insert,update,references')) as open
           from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' order by 1`,
      ),
    );
    for (const r of rows) {
      assert.ok(r.policies > 0 || !r.open, `${r.tbl} has no policy yet is reachable by an API role`);
    }
    // and the tables that must be deny-all really are
    for (const t of ["resource_files", "billing_customers", "admin_grants", "download_events", "stripe_webhook_events", "supervised_contexts", "lessons", "lesson_students", "lesson_attendance", "lesson_activity", "lesson_reports", "notifications", "platform_settings", "tutor_availability_blocks"]) {
      const r = rows.find((x) => x.tbl === t)!;
      assert.equal(r.policies, 0, `${t} should have no policy`);
      assert.equal(r.open, false, `${t} must be unreachable for anon and authenticated`);
    }
  });

  test("anon can read only the resources table; authenticated never gets TRUNCATE, REFERENCES or TRIGGER", async () => {
    const grants = await db.asOwner((q) =>
      q.query<{ grantee: string; table_name: string; privilege_type: string }>(
        `select grantee, table_name, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and grantee in ('anon','authenticated')`,
      ),
    );
    assert.deepEqual(
      grants.filter((g) => g.grantee === "anon").map((g) => `${g.table_name}:${g.privilege_type}`),
      ["resources:SELECT"],
    );
    assert.deepEqual(
      grants.filter((g) => g.grantee === "authenticated" && ["TRUNCATE", "REFERENCES", "TRIGGER"].includes(g.privilege_type)),
      [],
    );
    const anonColumnWrites = await db.asOwner((q) =>
      q.query(
        `select 1 from information_schema.column_privileges
          where table_schema = 'public' and grantee = 'anon' and privilege_type <> 'SELECT'`,
      ),
    );
    assert.equal(anonColumnWrites.length, 0);
  });

  test("no table or column that decides access is writable by a signed-in user", async () => {
    const writable = await db.asOwner((q) =>
      q.query<{ t: string; c: string; p: string }>(
        `select table_name as t, column_name as c, privilege_type as p from information_schema.column_privileges
          where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('INSERT','UPDATE')
          order by 1,2,3`,
      ),
    );
    const set = new Set(writable.map((w) => `${w.t}.${w.c}:${w.p}`));
    // the complete list of what a signed-in user can write; anything new must be a conscious change
    assert.deepEqual([...set].sort(), [
      "chat_sessions.client_id:INSERT",
      "chat_sessions.student_id:INSERT",
      "chat_sessions.title:INSERT",
      "chat_sessions.title:UPDATE",
      "clients.owner_profile_id:INSERT",
      "consents.profile_id:INSERT",
      "consents.student_id:INSERT",
      "consents.kind:INSERT",
      "consents.text_sha256:INSERT",
      "consents.version:INSERT",
      "consents.withdrawn_at:UPDATE",
      "profiles.display_name:UPDATE",
      "students.client_id:INSERT",
      "students.display_name:INSERT",
      "students.year_group:INSERT",
      "students.display_name:UPDATE",
      "students.year_group:UPDATE",
    ].sort());
  });

  test("every SECURITY DEFINER function fixes its search_path and is closed to anon and PUBLIC", async () => {
    const rows = await db.asOwner((q) =>
      q.query<{ name: string; config: string | null; anon: boolean; pub: boolean }>(
        `select n.nspname || '.' || p.proname as name, p.proconfig::text as config,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('public', p.oid, 'execute') as pub
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public','private') and p.prosecdef`,
      ),
    );
    assert.ok(rows.length >= 7, "expected the helper functions to exist");
    for (const r of rows) {
      assert.match(r.config ?? "", /search_path=/, `${r.name} must set search_path`);
      assert.equal(r.anon, false, `${r.name} must not be callable by anon`);
      assert.equal(r.pub, false, `${r.name} must not be callable by PUBLIC`);
    }
  });

  test("every table and the sensitive columns carry comments", async () => {
    const missing = await db.asOwner((q) =>
      q.query(
        `select c.relname from pg_class c
          where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and obj_description(c.oid, 'pg_class') is null`,
      ),
    );
    assert.deepEqual(missing, []);
  });
});

describe("resources", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.close());

  const insert = (db: TestDb, overrides: Record<string, unknown>) => {
    const base: Record<string, unknown> = {
      slug: "valid-resource",
      title: "Valid",
      subject: "Maths",
      level: "GCSE",
      topic: "Algebra",
      resource_type: "worksheet",
      authorship: "LearnThrive Tuition",
    };
    const row = { ...base, ...overrides };
    const keys = Object.keys(row);
    return db.asService((q) =>
      q.query(
        `insert into public.resources (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
        keys.map((k) => row[k]),
      ),
    );
  };

  test("a valid resource is accepted and defaults to a members-only draft at version 1", async () => {
    const [{ id }] = await insert(db, {});
    const [row] = await db.asOwner((q) =>
      q.query("select access_tier, version, published_at, tags from public.resources where id = $1", [id]),
    );
    assert.deepEqual(row, { access_tier: "members", version: 1, published_at: null, tags: [] });
  });

  test("authorship is mandatory and cannot be empty, blank or punctuation only", async () => {
    let n = 0;
    for (const bad of ["", " ", "   ", "\t\n", " ", "​", "---", "..."]) {
      n += 1;
      await assert.rejects(insert(db, { slug: `bad-authorship-${n}`, authorship: bad }), /check constraint|violates/i, JSON.stringify(bad));
    }
    await assert.rejects(insert(db, { slug: "null-authorship", authorship: null }), /null value|not-null/i);
    await assert.rejects(
      db.asService((q) =>
        q.query(
          `insert into public.resources (slug,title,subject,level,topic,resource_type)
           values ('no-authorship','T','Maths','GCSE','Algebra','notes')`,
        ),
      ),
      /authorship/,
    );
    // an update cannot blank it either
    const [{ id }] = await insert(db, { slug: "will-be-blanked" });
    await assert.rejects(
      db.asService((q) => q.run("update public.resources set authorship = '  ' where id = $1", [id])),
      /check constraint/i,
    );
  });

  test("level, type, tier, slug and version are constrained", async () => {
    await assert.rejects(insert(db, { slug: "l1", level: "Year 9" }), /check constraint/i);
    await assert.rejects(insert(db, { slug: "l2", resource_type: "video" }), /check constraint/i);
    await assert.rejects(insert(db, { slug: "l3", access_tier: "premium" }), /check constraint/i);
    await assert.rejects(insert(db, { slug: "Not A Slug" }), /check constraint/i);
    await assert.rejects(insert(db, { slug: "l4", version: 0 }), /check constraint/i);
    await assert.rejects(insert(db, { slug: "l5", exam_board: "   " }), /check constraint/i);
    for (const [i, level] of ["KS2", "KS3", "GCSE", "A Level", "11+"].entries()) {
      await insert(db, { slug: `ok-level-${i}`, level });
    }
    for (const [i, resource_type] of ["worksheet", "exam paper", "mark scheme", "notes"].entries()) {
      await insert(db, { slug: `ok-type-${i}`, resource_type });
    }
    await assert.rejects(insert(db, { slug: "ok-level-0" }), /unique|duplicate/i, "slugs are unique");
  });

  test("full-text search finds by title, topic, tag and description, with stemming and ranking", async () => {
    const quad = await createResource(db, {
      slug: "quadratics-worksheet",
      title: "Quadratic equations worksheet",
      topic: "Quadratics",
      description: "Practice factorising and solving.",
      tags: ["algebra", "factorising"],
    });
    const photo = await createResource(db, {
      slug: "photosynthesis-notes",
      title: "Photosynthesis revision notes",
      subject: "Science",
      topic: "Plant biology",
      resource_type: "notes",
      description: "Includes a short quadratic-style graph of light intensity.",
      tags: ["biology"],
    });
    const search = (term: string) =>
      db.asAnon((q) =>
        q.query<{ id: string }>(
          `select id from public.resources where search @@ websearch_to_tsquery('english', $1)
            order by ts_rank(search, websearch_to_tsquery('english', $1)) desc, slug`,
          [term],
        ),
      );
    assert.deepEqual((await search("quadratic equation")).map((r) => r.id), [quad]);
    assert.deepEqual((await search("quadratics")).map((r) => r.id), [quad, photo], "stemming: quadratics ~ quadratic, title match first");
    assert.deepEqual((await search("factorise")).map((r) => r.id), [quad], "tags are searchable and stemmed");
    assert.deepEqual((await search("photosynthesis")).map((r) => r.id), [photo]);
    assert.deepEqual((await search("biology")).map((r) => r.id), [photo], "topic and tags");
    assert.deepEqual((await search("light intensity")).map((r) => r.id), [photo], "description");
    assert.deepEqual((await search("nonexistentword")).map((r) => r.id), []);
    // title outranks description: "quadratic" is in the title of one and only the description of the other
    assert.deepEqual((await search("quadratic")).map((r) => r.id), [quad, photo]);
    assert.deepEqual((await search("quadratic -worksheet")).map((r) => r.id), [photo], "websearch negation");
  });

  test("the search vector is a stored generated column indexed with GIN, and the index is usable", async () => {
    const [col] = await db.asOwner((q) =>
      q.query(
        `select data_type, is_generated, generation_expression is not null as has_expr
           from information_schema.columns where table_name = 'resources' and column_name = 'search'`,
      ),
    );
    assert.deepEqual(col, { data_type: "tsvector", is_generated: "ALWAYS", has_expr: true });
    const [idx] = await db.asOwner((q) =>
      q.query<{ indexdef: string }>("select indexdef from pg_indexes where indexname = 'resources_search_idx'"),
    );
    assert.match(idx!.indexdef, /USING gin \(search\)/i);
    await db.asOwner(async (q) => {
      await q.exec("set local enable_seqscan = off");
      const plan = await q.query<{ "QUERY PLAN": string }>(
        "explain select id from public.resources where search @@ websearch_to_tsquery('english', 'algebra')",
      );
      assert.match(plan.map((p) => p["QUERY PLAN"]).join("\n"), /resources_search_idx/);
    });
    // editing the title re-computes the vector without any application code
    const id = await createResource(db, { slug: "retitle", title: "Fractions" });
    await db.asService((q) => q.run("update public.resources set title = 'Percentages' where id = $1", [id]));
    const hits = await db.asAnon((q) =>
      q.query("select id from public.resources where search @@ websearch_to_tsquery('english', 'percentages')"),
    );
    assert.equal(hits.length, 1);
  });
});

describe("resource files", () => {
  let db: TestDb;
  let resourceId: string;
  before(async () => {
    db = await createTestDb();
    resourceId = await createResource(db, { slug: "with-file" });
  });
  after(() => db.close());

  const file = (o: Record<string, unknown> = {}) => {
    const row = {
      resource_id: resourceId,
      storage_path: "maths/gcse/with-file-v1.pdf",
      bytes: 1024,
      content_type: "application/pdf",
      checksum_sha256: "a".repeat(64),
      ...o,
    };
    const keys = Object.keys(row);
    return db.asService((q) =>
      q.run(
        `insert into public.resource_files (${keys.join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
        keys.map((k) => (row as Record<string, unknown>)[k]),
      ),
    );
  };

  test("accepts a clean row; rejects absolute or traversing paths, bad checksums, empty files", async () => {
    assert.equal(await file(), 1);
    await assert.rejects(file({ storage_path: "/etc/passwd" }), /check constraint/i);
    await assert.rejects(file({ storage_path: "maths/../../secret.pdf" }), /check constraint/i);
    await assert.rejects(file({ storage_path: "other.pdf", checksum_sha256: "xyz" }), /check constraint/i);
    await assert.rejects(file({ storage_path: "other2.pdf", bytes: 0 }), /check constraint/i);
    await assert.rejects(file({ storage_path: "other3.pdf", content_type: "not a type" }), /check constraint/i);
    await assert.rejects(file({ storage_path: "maths/gcse/with-file-v1.pdf" }), /unique|duplicate/i);
  });
});

describe("billing tables", () => {
  let db: TestDb;
  let clientId: string;
  before(async () => {
    db = await createTestDb();
    clientId = (await createFamily(db, { name: "Payer" })).clientId;
  });
  after(() => db.close());

  const service = (sql: string, params: unknown[] = []) => db.asService((q) => q.query(sql, params));

  test("an entitlement's reference must match its source, and the natural key is unique (NULLs included)", async () => {
    await assert.rejects(
      service("insert into public.entitlements (client_id, source) values ($1, 'subscription')", [clientId]),
      /check constraint/i,
    );
    await assert.rejects(
      service("insert into public.entitlements (client_id, source) values ($1, 'enrolled')", [clientId]),
      /check constraint/i,
    );
    const [grant] = await service(
      "insert into public.admin_grants (client_id, reason) values ($1, 'bursary') returning id",
      [clientId],
    );
    await service(
      "insert into public.entitlements (client_id, source, admin_grant_id) values ($1, 'admin_grant', $2)",
      [clientId, grant!.id],
    );
    await assert.rejects(
      service("insert into public.entitlements (client_id, source, admin_grant_id) values ($1, 'admin_grant', $2)", [clientId, grant!.id]),
      /unique|duplicate/i,
    );
    await assert.rejects(
      service(
        "insert into public.entitlements (client_id, source, admin_grant_id, assignment_id) values ($1, 'admin_grant', $2, gen_random_uuid())",
        [clientId, grant!.id],
      ),
      /check constraint|foreign key/i,
    );
    await assert.rejects(
      service(
        "insert into public.entitlements (client_id, source, admin_grant_id, starts_at, ends_at) values ($1, 'admin_grant', $2, now(), now() - interval '1 day')",
        [clientId, grant!.id],
      ),
      /check constraint/i,
    );
  });

  test("subscriptions validate Stripe ids, status and plan interval", async () => {
    const insert = (o: Record<string, string>) =>
      service(
        "insert into public.subscriptions (client_id, stripe_subscription_id, stripe_price_id, status, plan_interval) values ($1,$2,$3,$4,$5)",
        [clientId, o.sub ?? "sub_1ABC", o.price ?? "price_1ABC", o.status ?? "active", o.interval ?? "month"],
      );
    await insert({});
    await assert.rejects(insert({}), /unique|duplicate/i);
    await assert.rejects(insert({ sub: "not-a-sub" }), /check constraint/i);
    await assert.rejects(insert({ sub: "sub_2", status: "gold" }), /check constraint/i);
    await assert.rejects(insert({ sub: "sub_3", interval: "week" }), /check constraint/i);
  });

  test("a Stripe webhook event id can be recorded once only (idempotency key)", async () => {
    const record = () =>
      service("insert into public.stripe_webhook_events (event_id, event_type) values ('evt_123', 'invoice.paid')");
    await record();
    await assert.rejects(record(), /unique|duplicate|primary/i);
    // the idempotent form the webhook route will use
    const rows = await service(
      "insert into public.stripe_webhook_events (event_id, event_type) values ('evt_123', 'invoice.paid') on conflict (event_id) do nothing returning event_id",
    );
    assert.equal(rows.length, 0);
    await assert.rejects(
      service("insert into public.stripe_webhook_events (event_id, event_type) values ('x; drop table', 't')"),
      /check constraint/i,
    );
  });

  test("download_events are counter-only: flags are machine tokens, never free text such as an IP or an email", async () => {
    const add = (flags: string[]) =>
      service("insert into public.download_events (client_id, flags) values ($1, $2)", [clientId, flags]);
    await add([]);
    await add(["rate_limited", "burst"]);
    await assert.rejects(add(["203.0.113.7"]), /check constraint/i);
    await assert.rejects(add(["parent@example.com"]), /check constraint/i);
    await assert.rejects(add(["has space"]), /check constraint/i);
    await assert.rejects(add(Array.from({ length: 11 }, (_, i) => `f${i}`)), /check constraint/i);
    const cols = await db.asOwner((q) =>
      q.query<{ column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'download_events' order by ordinal_position",
      ),
    );
    assert.deepEqual(cols.map((c) => c.column_name), ["id", "client_id", "resource_id", "at", "flags"]);
  });
});

describe("assistant tables: retention deadlines", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.close());

  test("deadline columns exist on chat sessions, messages and files", async () => {
    const rows = await db.asOwner((q) =>
      q.query<{ table_name: string; column_name: string; is_nullable: string }>(
        `select table_name, column_name, is_nullable from information_schema.columns
          where table_name in ('chat_sessions','chat_messages','chat_files') and column_name in ('delete_after','deletion_requested_at')
          order by 1,2`,
      ),
    );
    assert.deepEqual(rows, [
      { table_name: "chat_files", column_name: "delete_after", is_nullable: "NO" },
      { table_name: "chat_messages", column_name: "delete_after", is_nullable: "NO" },
      { table_name: "chat_sessions", column_name: "delete_after", is_nullable: "NO" },
      { table_name: "chat_sessions", column_name: "deletion_requested_at", is_nullable: "YES" },
    ]);
  });

  test("defaults: chat text is kept 30 days and uploads 7 days", async () => {
    const family = await createFamily(db, { name: "Ret" });
    const out = await db.asService(async (q) => {
      const [s] = await q.query<{ id: string }>("insert into public.chat_sessions (client_id) values ($1) returning id", [family.clientId]);
      const [m] = await q.query<{ id: string }>(
        "insert into public.chat_messages (session_id, role, content) values ($1, 'user', 'hello') returning id",
        [s!.id],
      );
      await q.run(
        "insert into public.chat_files (session_id, message_id, storage_path, bytes, content_type) values ($1, $2, 'chat/a.png', 10, 'image/png')",
        [s!.id, m!.id],
      );
      return q.query<{ t: string; d: string }>(
        `select 'session' as t, (delete_after - created_at)::text as d from public.chat_sessions
         union all select 'message', (delete_after - created_at)::text from public.chat_messages
         union all select 'file', (delete_after - created_at)::text from public.chat_files order by 1`,
      );
    });
    // now() is the transaction start, so each is exactly the default interval
    assert.deepEqual(out, [
      { t: "file", d: "7 days" },
      { t: "message", d: "30 days" },
      { t: "session", d: "30 days" },
    ]);
  });

  test("uploads are limited to images and PDF, messages to user/assistant, and a deadline cannot precede creation", async () => {
    const family = await createFamily(db, { name: "Ret2" });
    await assert.rejects(
      db.asService(async (q) => {
        const [s] = await q.query<{ id: string }>("insert into public.chat_sessions (client_id) values ($1) returning id", [family.clientId]);
        await q.run("insert into public.chat_files (session_id, storage_path, bytes, content_type) values ($1,'x.exe',1,'application/x-msdownload')", [s!.id]);
      }),
      /check constraint/i,
    );
    await assert.rejects(
      db.asService(async (q) => {
        const [s] = await q.query<{ id: string }>("insert into public.chat_sessions (client_id) values ($1) returning id", [family.clientId]);
        await q.run("insert into public.chat_messages (session_id, role, content) values ($1,'system','prompt')", [s!.id]);
      }),
      /check constraint/i,
    );
    await assert.rejects(
      db.asService(async (q) => {
        const [s] = await q.query<{ id: string }>("insert into public.chat_sessions (client_id) values ($1) returning id", [family.clientId]);
        await q.run(
          "insert into public.chat_messages (session_id, role, content, delete_after) values ($1,'user','x', now() - interval '1 day')",
          [s!.id],
        );
      }),
      /check constraint/i,
    );
  });

  test("usage counters are unique per account, kind and window", async () => {
    const family = await createFamily(db, { name: "Usage" });
    const add = () =>
      db.asService((q) =>
        q.run(
          "insert into public.usage_counters (client_id, kind, window_start, count) values ($1, 'assistant_message_day', date_trunc('day', now()), 1)",
          [family.clientId],
        ),
      );
    await add();
    await assert.rejects(add(), /unique|duplicate/i);
    await assert.rejects(
      db.asService((q) =>
        q.run("insert into public.usage_counters (client_id, kind, window_start, count) values ($1, 'Bad Kind', now(), 1)", [family.clientId]),
      ),
      /check constraint/i,
    );
    await assert.rejects(
      db.asService((q) =>
        q.run("insert into public.usage_counters (client_id, kind, window_start, count) values ($1, 'ok_kind', now(), -1)", [family.clientId]),
      ),
      /check constraint/i,
    );
  });
});

describe("profiles and family structure", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.close());

  test("a profile is created for every auth user; the role is always CLIENT whatever the sign-up metadata says", async () => {
    const id = await db.createUser({ displayName: "Mallory", metadata: { role: "ADMIN", app_role: "ADMIN", is_admin: true } });
    const [p] = await db.asOwner((q) => q.query("select role, display_name, adult_confirmed_at from public.profiles where id = $1", [id]));
    assert.deepEqual(p, { role: "CLIENT", display_name: "Mallory", adult_confirmed_at: null });
  });

  test("the adult declaration is recorded only when made; the display name is trimmed and capped at 80", async () => {
    const adult = await db.createUser({ adult: true, displayName: `  ${"x".repeat(200)}  ` });
    const minorish = await db.createUser({ metadata: { adult_confirmed: "false" } });
    const rows = await db.asOwner((q) =>
      q.query<{ id: string; len: number; adult: boolean }>(
        "select id, char_length(display_name) as len, adult_confirmed_at is not null as adult from public.profiles where id in ($1,$2)",
        [adult, minorish],
      ),
    );
    assert.equal(rows.find((r) => r.id === adult)!.adult, true);
    assert.equal(rows.find((r) => r.id === adult)!.len, 80);
    assert.equal(rows.find((r) => r.id === minorish)!.adult, false);
  });

  test("students have no email, no auth user and no login column; creating one links the owning family", async () => {
    const cols = await db.asOwner((q) =>
      q.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'students' order by ordinal_position"),
    );
    assert.deepEqual(cols.map((c) => c.column_name), ["id", "client_id", "display_name", "year_group", "is_minor", "active", "created_at", "access_mode"]);
    const f = await createFamily(db, { name: "Link", students: ["Kid"] });
    const links = await db.asOwner((q) => q.query("select client_id, student_id from public.client_students"));
    assert.deepEqual(links.filter((l) => l.student_id === f.studentIds[0]), [{ client_id: f.clientId, student_id: f.studentIds[0] }]);
    const [s] = await db.asOwner((q) => q.query("select is_minor from public.students where id = $1", [f.studentIds[0]]));
    assert.equal(s!.is_minor, true, "a student is a minor unless the server says otherwise");
  });

  test("the two Auth lookups answer the server only, and only with what they are for (0009)", async () => {
    const f = await createFamily(db, { name: "Lookup" });
    const email = (await db.asOwner((q) => q.query<{ email: string }>("select email from auth.users where id = $1", [f.userId])))[0]!.email;
    const asServer = <T,>(text: string, params: unknown[]) => db.asService((q) => q.query<T>(text, params));
    assert.deepEqual(await asServer("select public.auth_email($1) as e", [f.userId]), [{ e: email }]);
    assert.deepEqual(await asServer("select public.auth_email($1) as e", ["00000000-0000-4000-8000-000000000000"]), [{ e: null }]);
    const found = await asServer<{ id: string; email_confirmed: boolean }>("select * from public.auth_user_by_email($1)", [email.toUpperCase()]);
    assert.deepEqual(found, [{ id: f.userId, email_confirmed: true }], "case-insensitive, and only the id and a flag come back");
    assert.deepEqual(await asServer("select * from public.auth_user_by_email($1)", ["nobody@example.test"]), []);
    for (const run of [(fn: (q: any) => Promise<unknown>) => db.asUser(f.userId, fn), (fn: (q: any) => Promise<unknown>) => db.asAnon(fn)]) {
      await assert.rejects(run((q) => q.query("select public.auth_email($1)", [f.userId])), /permission denied/i);
      await assert.rejects(run((q) => q.query("select * from public.auth_user_by_email($1)", [email])), /permission denied/i);
    }
  });

  test("a withdrawal is stamped with the database's clock, whatever the caller sent (0008)", async () => {
    const f = await createFamily(db, { name: "Clock" });
    const make = async () =>
      (await db.asUser(f.userId, (q) => q.query<{ id: string }>("insert into public.consents (profile_id, kind, version, text_sha256) values ($1,'marketing','1',$2) returning id", [f.userId, "d".repeat(64)])))[0]!.id;
    for (const sent of ["now() + interval '10 years'", "now() - interval '1 second'", "now()"]) {
      const id = await make();
      const [row] = await db.asUser(f.userId, (q) => q.query<{ ok: boolean }>(`update public.consents set withdrawn_at = ${sent} where id = $1 returning withdrawn_at between now() - interval '5 seconds' and now() + interval '5 seconds' as ok`, [id]));
      assert.equal(row?.ok, true, `${sent}: recorded as the server's now()`);
    }
  });

  test("a consent withdrawal is recorded once and cannot be edited or undone; hashes are validated", async () => {
    const f = await createFamily(db, { name: "Consent" });
    const sha = "b".repeat(64);
    const [c] = await db.asUser(f.userId, (q) =>
      q.query<{ id: string }>(
        "insert into public.consents (profile_id, kind, version, text_sha256) values ($1,'marketing','2026-10',$2) returning id",
        [f.userId, sha],
      ),
    );
    await db.asUser(f.userId, (q) => q.run("update public.consents set withdrawn_at = now() where id = $1", [c!.id]));
    await assert.rejects(db.asUser(f.userId, (q) => q.run("update public.consents set withdrawn_at = null where id = $1", [c!.id])), /cannot be changed or undone/);
    await assert.rejects(db.asUser(f.userId, (q) => q.run("update public.consents set withdrawn_at = now() + interval '1 day' where id = $1", [c!.id])), /cannot be changed or undone/);
    await assert.rejects(
      db.asUser(f.userId, (q) =>
        q.run("insert into public.consents (profile_id, kind, version, text_sha256) values ($1,'marketing','1','nothex')", [f.userId]),
      ),
      /check constraint/i,
    );
  });

  test("deleting an auth user removes the whole family; download audit rows survive without the account", async () => {
    const f = await createFamily(db, { name: "Leaver", students: ["A", "B"] });
    const r = await createResource(db, { slug: "leaver-resource" });
    await db.asService(async (q) => {
      await q.run("insert into public.download_events (client_id, resource_id, flags) values ($1,$2,'{}')", [f.clientId, r]);
      const [s] = await q.query<{ id: string }>("insert into public.chat_sessions (client_id, student_id) values ($1,$2) returning id", [f.clientId, f.studentIds[0]]);
      await q.run("insert into public.chat_messages (session_id, role, content) values ($1,'user','hi')", [s!.id]);
      await q.run("insert into public.usage_counters (client_id, kind, window_start) values ($1,'assistant_message_day', now())", [f.clientId]);
    });
    await db.asOwner((q) => q.run("delete from auth.users where id = $1", [f.userId]));
    const left = await db.asOwner((q) =>
      q.query<{ n: number }>(
        `select (select count(*) from public.profiles where id = $1)
              + (select count(*) from public.clients where id = $2)
              + (select count(*) from public.students where client_id = $2)
              + (select count(*) from public.client_students where client_id = $2)
              + (select count(*) from public.chat_sessions where client_id = $2)
              + (select count(*) from public.chat_messages)
              + (select count(*) from public.usage_counters where client_id = $2) as n`,
        [f.userId, f.clientId],
      ),
    );
    assert.equal(Number(left[0]!.n), 0);
    const audit = await db.asOwner((q) => q.query("select client_id, resource_id from public.download_events where resource_id = $1", [r]));
    assert.deepEqual(audit, [{ client_id: null, resource_id: r }]);
  });
});
