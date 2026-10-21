// The narrow database role the site connects as (plan20 section 3), proven on the real local stack: it does the data work and
// nothing else. The role is made by the real script (apps/web/scripts/create-server-role.mjs), with a random password that exists only
// in this process. Skipped unless SUPABASE_LOCAL=1.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import postgres from "postgres";
import { deleteUser, ensureServerRole, newUser, openDb, stack, waitUntilConnects, type Sql, type Stack } from "./testing/realstack";

const ENABLED = process.env.SUPABASE_LOCAL === "1";
const DENIED = /permission denied|must be (owner|superuser)|only roles with|not allowed|cannot|does not exist/i;

describe("the learnthrive_server role on the real local stack", { skip: ENABLED ? false : "set SUPABASE_LOCAL=1 with the local stack running" }, () => {
  let s: Stack;
  let admin: Sql;
  let userId = "";
  const connections: Array<ReturnType<typeof postgres>> = [];
  let direct: ReturnType<typeof postgres>;
  let pooled: ReturnType<typeof postgres>;
  const open = (url: string) => {
    const c = postgres(url, { max: 1, prepare: false, connect_timeout: 10, onnotice: () => {} });
    connections.push(c);
    return c;
  };

  before(async () => {
    s = stack();
    admin = openDb(s);
    userId = (await newUser(s, { name: "Role" })).id; // a real profile for the role to read
    const urls = ensureServerRole(s);
    await waitUntilConnects(urls.poolerUrl); // the pooler still holds the previous password's verifier for a few seconds
    direct = open(urls.directUrl);
    pooled = open(urls.poolerUrl);
  });
  after(async () => {
    for (const c of connections) await c.end({ timeout: 3 });
    if (userId) await deleteUser(s, userId);
    await admin.end({ timeout: 3 });
  });

  const denied = async (c: ReturnType<typeof postgres>, text: string, label = text) => {
    await assert.rejects(c.unsafe(text), (e: Error) => DENIED.test(e.message), `${label} should be refused`);
  };

  test("its attributes: it can log in and bypass row level security, and is otherwise an ordinary role with a connection cap", async () => {
    const [r] = await admin`select rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolcanlogin, rolinherit, rolconnlimit from pg_roles where rolname = 'learnthrive_server'`;
    assert.deepEqual({ ...r }, { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: true, rolcanlogin: true, rolinherit: false, rolconnlimit: 30 });
    const settings = (await admin`select unnest(rolconfig) as c from pg_roles where rolname = 'learnthrive_server'`).map((x) => x.c);
    assert.ok(settings.includes("statement_timeout=30s") && settings.includes("idle_in_transaction_session_timeout=30s"), JSON.stringify(settings));
    assert.match((await admin`select rolpassword from pg_authid where rolname = 'learnthrive_server'`)[0]!.rolpassword, /^SCRAM-SHA-256\$/, "stored as a SCRAM verifier, never plaintext");
  });

  for (const [name, getConnection] of [["directly", () => direct], ["through the pooler", () => pooled]] as const) {
    test(`it does the data work, ${name}: it reads every family (it bypasses RLS by design) and writes the tables the repositories write`, async () => {
      const c = getConnection();
      assert.equal((await c`select current_user as u`)[0]!.u, "learnthrive_server");
      assert.equal((await c`select count(*)::int as n from public.profiles`)[0]!.n, (await admin`select count(*)::int as n from public.profiles`)[0]!.n, "sees every row, not none");
      const tag = `role-${Math.random().toString(36).slice(2, 8)}`;
      const [row] = await c`insert into public.resources (slug, title, subject, level, topic, resource_type, access_tier, authorship) values (${tag}, 't', 'Maths', 'GCSE', 'Algebra', 'worksheet', 'members', 'LearnThrive Tuition') returning id`;
      assert.equal((await c`update public.resources set title = 'u' where id = ${row!.id}`).count, 1);
      assert.equal((await c`delete from public.resources where id = ${row!.id}`).count, 1);
      // What it needs from Auth, through the two functions (migration 0009): never the auth schema itself.
      assert.equal(typeof (await c`select public.auth_email(${userId}) as e`)[0]!.e, "string");
      assert.equal((await c`select * from public.auth_user_by_email('nobody@example.test')`).length, 0);
    });
  }

  test("it cannot create or change anything: no tables, schemas, roles, functions, extensions, policies or grants", async () => {
    for (const statement of [
      "create table public.evil (id int)",
      "create table evil (id int)",
      "create schema evil",
      "create role evil login",
      "create function public.evil() returns int language sql as 'select 1'",
      "create extension file_fdw",
      "alter table public.clients add column evil int",
      "alter table public.clients disable row level security",
      "create policy evil on public.clients using (true)",
      "drop table public.clients",
      "truncate public.clients",
      "grant learnthrive_server to postgres",
      "alter role postgres password 'x'",
      "alter role learnthrive_server superuser",
      "alter role learnthrive_server createrole",
      "alter system set max_connections = 5",
      "drop role learnthrive_server",
      "comment on table public.clients is 'evil'",
    ]) await denied(direct, statement);
    // A grant by a role that does not own the table is only a warning in Postgres ("no privileges were granted"): check the effect.
    await direct.unsafe("grant select on public.clients to public");
    assert.equal((await admin`select has_table_privilege('anon', 'public.clients', 'SELECT') as p`)[0]!.p, false, "the grant gave nothing");
  });

  test("it cannot read the other schemas or any credentials: not even the email column of auth.users (the lookups are functions)", async () => {
    for (const statement of [
      "select * from auth.users",
      "select id, email from auth.users",
      "select email from auth.users",
      "select encrypted_password from auth.users",
      "select raw_user_meta_data from auth.users",
      "select * from auth.sessions",
      "select * from auth.refresh_tokens",
      "select * from auth.identities",
      "select * from auth.mfa_factors",
      "select * from storage.objects",
      "select * from storage.buckets",
      "select * from supabase_migrations.schema_migrations",
      "select * from pg_authid",
      "select * from pg_shadow",
      "select private.is_admin()",
      "select public.client_is_enrolled(gen_random_uuid())",
      "select public.request_chat_deletion(gen_random_uuid())",
      "select pg_read_file('/etc/passwd')",
      "select pg_ls_dir('/')",
      "copy (select 1) to program 'id'",
      "copy public.clients to '/tmp/x'",
      "set role postgres",
      "set session authorization postgres",
      "select pg_reload_conf()",
    ]) await denied(direct, statement);
    // The vault, if it is installed in this stack, is closed too.
    if ((await admin`select 1 from pg_namespace where nspname = 'vault'`).length) await denied(direct, "select * from vault.secrets");
  });

  test("grants are exactly the list in the script: every public table has data access, nothing in public has more, and no other schema has any", async () => {
    const grants = await admin`select table_name, string_agg(privilege_type, ',' order by privilege_type) as p from information_schema.role_table_grants where grantee = 'learnthrive_server' and table_schema = 'public' group by table_name order by 1`;
    const tables = (await admin`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`).map((r) => r.relname as string);
    assert.deepEqual(grants.map((g) => g.table_name), tables, "a table with no grant would break the site after a migration; re-run the script");
    for (const g of grants) assert.equal(g.p, "DELETE,INSERT,SELECT,UPDATE", g.table_name as string);
    const elsewhere = await admin`select table_schema, table_name, privilege_type from information_schema.role_table_grants where grantee = 'learnthrive_server' and table_schema <> 'public'`;
    assert.deepEqual(elsewhere.map((e) => `${e.table_schema}.${e.table_name}:${e.privilege_type}`), [], "no table grant outside public");
    const columns = await admin`select table_schema, table_name, column_name from information_schema.column_privileges where grantee = 'learnthrive_server' and table_schema <> 'public' order by column_name`;
    assert.deepEqual(columns.map((c) => `${c.table_schema}.${c.table_name}.${c.column_name}`), [], "no column grant anywhere outside public");
    const functions = (await admin`select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and has_function_privilege('learnthrive_server', p.oid, 'EXECUTE') order by 1`).map((r) => r.f);
    assert.deepEqual(functions, ["private.tags_to_text(tags text[])", "public.auth_email(p_profile uuid)", "public.auth_user_by_email(p_email text)"], "of the project's own functions it may run exactly these three");
    const schemas = (await admin`select nspname from pg_namespace where has_schema_privilege('learnthrive_server', oid, 'USAGE') and nspname !~ '^pg_' and nspname <> 'information_schema' order by 1`).map((r) => r.nspname);
    assert.deepEqual(schemas, ["private", "public"], "usage on public, and on private only for the one helper the search column calls");
    assert.equal((await admin`select has_schema_privilege('learnthrive_server', 'public', 'CREATE') as c`)[0]!.c, false);
  });

  test("it cannot signal another role's connection", async () => {
    const [other] = await admin`select pid from pg_stat_activity where usename = 'postgres' and pid <> pg_backend_pid() limit 1`;
    assert.ok(other, "a postgres connection exists to aim at");
    await assert.rejects(direct.unsafe(`select pg_terminate_backend(${other!.pid})`), (e: Error) => /must be a member|permission denied/i.test(e.message));
    await assert.rejects(direct.unsafe(`select pg_cancel_backend(${other!.pid})`), (e: Error) => /must be a member|permission denied/i.test(e.message));
  });

  test("a new table is not reachable until the script is re-run (grants are explicit, not default privileges)", async () => {
    await admin.unsafe("create table public.rs_newly_added (id int)");
    try {
      await denied(direct, "select * from public.rs_newly_added");
    } finally {
      await admin.unsafe("drop table public.rs_newly_added");
    }
  });
});
