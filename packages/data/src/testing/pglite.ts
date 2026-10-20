/**
 * In-process Postgres for database tests (PGlite = Postgres compiled to WASM; no Docker, no psql).
 *
 * It stands in for Supabase: a fresh instance gets a small "Supabase prelude" (the auth schema with
 * auth.users and auth.uid(), the roles anon / authenticated / service_role with Supabase's default
 * grants), then every file in supabase/migrations/ in order. Production runs the same SQL on Supabase.
 *
 * API (keep it small; other engineers' repository tests use it):
 *
 *   const db = await createTestDb();                  // fresh DB, prelude + all migrations applied
 *   const db = await createTestDb({ migrate: false }); // prelude only; then `await db.migrate()`
 *
 *   const id = await db.createUser({ adult: true, displayName: "Alice" });  // auth.users row; the
 *                                                     // on_auth_user_created trigger makes the profile
 *   await db.asUser(id, (q) => q.query("select * from public.clients"));   // role authenticated,
 *   await db.asAnon((q) => ...);                                           // role anon
 *   await db.asService((q) => ...);                                        // role service_role (bypasses RLS)
 *   await db.asOwner((q) => ...);                                          // superuser: fixtures, setup only
 *   await db.close();
 *
 * Each asX call is ONE transaction: SET LOCAL ROLE + the JWT claims (request.jwt.claim.sub and
 * request.jwt.claims, which is what auth.uid() reads). It commits when the callback returns and rolls
 * back when it throws, so a rejected statement (permission denied, RLS violation) leaves nothing behind.
 * Inside the callback, `q` has:
 *   q.query<T>(sql, params?) -> Promise<T[]>      rows
 *   q.run(sql, params?)      -> Promise<number>   rows affected (0 = RLS hid every row)
 *   q.exec(sql)              -> Promise<void>     one or more statements, no parameters
 *
 * Differences from real Supabase worth knowing: the harness connection is a superuser that can
 * `reset role` (a real API caller cannot run raw SQL at all); Storage is not emulated; Auth's own
 * tables other than auth.users are absent.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";

export type Row = Record<string, any>;

export interface Sql {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<number>;
  exec(sql: string): Promise<void>;
}

export interface CreateUserOptions {
  email?: string;
  displayName?: string;
  /** Records the adult (18+) declaration, as the sign-up form does through user metadata. */
  adult?: boolean;
  /** Extra raw_user_meta_data (user-controlled at sign-up), for adversarial tests. */
  metadata?: Record<string, unknown>;
  /** Fixture shortcut: set profiles.role afterwards, as the server (service role) would. */
  role?: "ADMIN" | "TUTOR" | "CLIENT" | "STUDENT";
}

export interface TestDb {
  /** The underlying PGlite instance (superuser connection) for anything the helpers do not cover. */
  readonly raw: PGlite;
  /** Absolute paths of the migration files, in apply order. */
  migrationFiles(): string[];
  /** Applies every migration file in order (again, if already applied: they are re-runnable). */
  migrate(): Promise<string[]>;
  createUser(options?: CreateUserOptions): Promise<string>;
  asUser<T>(userId: string, fn: (q: Sql) => Promise<T>): Promise<T>;
  asAnon<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  asService<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  asOwner<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));

/** What Supabase provides before any project migration runs. */
export const SUPABASE_PRELUDE_SQL = `
create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant all on all tables in schema auth to service_role;

-- Supabase's defaults: every new object in public is fully open to the API roles. The project
-- migrations must (and do) take this away from anon and authenticated.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const ROLES = { anon: "anon", authenticated: "authenticated", service_role: "service_role" } as const;
type ApiRole = keyof typeof ROLES;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wrap(tx: Pick<Transaction, "query" | "exec">): Sql {
  return {
    async query<T = Row>(sql: string, params?: unknown[]) {
      return (await tx.query<T>(sql, params)).rows;
    },
    async run(sql: string, params?: unknown[]) {
      return (await tx.query(sql, params)).affectedRows ?? 0;
    },
    async exec(sql: string) {
      await tx.exec(sql);
    },
  };
}

export async function createTestDb(options: { migrate?: boolean } = {}): Promise<TestDb> {
  const raw = new PGlite();
  await raw.waitReady;
  await raw.exec(SUPABASE_PRELUDE_SQL);

  const migrationFiles = () =>
    readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d+_.+\.sql$/.test(f))
      .sort()
      .map((f) => MIGRATIONS_DIR + f);

  async function migrate() {
    const applied: string[] = [];
    for (const file of migrationFiles()) {
      try {
        await raw.exec(readFileSync(file, "utf8"));
      } catch (error) {
        throw new Error(`migration ${file.split(/[\\/]/).pop()} failed: ${(error as Error).message}`, { cause: error });
      }
      applied.push(file.split(/[\\/]/).pop()!);
    }
    return applied;
  }

  async function inRole<T>(role: ApiRole, sub: string | null, fn: (q: Sql) => Promise<T>): Promise<T> {
    if (sub !== null && !UUID.test(sub)) throw new Error(`not a uuid: ${sub}`);
    const claims = JSON.stringify(sub ? { sub, role } : { role });
    return raw.transaction(async (tx) => {
      await tx.exec(`set local role ${ROLES[role]}`);
      await tx.query(
        "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true), set_config('request.jwt.claims', $3, true)",
        [sub ?? "", role, claims],
      );
      return fn(wrap(tx));
    });
  }

  const db: TestDb = {
    raw,
    migrationFiles,
    migrate,
    async createUser(o = {}) {
      const metadata: Record<string, unknown> = { ...(o.metadata ?? {}) };
      if (o.displayName !== undefined) metadata.display_name = o.displayName;
      if (o.adult) metadata.adult_confirmed = "true";
      const result = await raw.query<{ id: string }>(
        "insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, now(), $2::jsonb) returning id",
        [o.email ?? `user-${Math.random().toString(36).slice(2)}@example.test`, JSON.stringify(metadata)],
      );
      const id = result.rows[0]!.id;
      if (o.role) await raw.query("update public.profiles set role = $1 where id = $2", [o.role, id]);
      return id;
    },
    asUser: (userId, fn) => inRole("authenticated", userId, fn),
    asAnon: (fn) => inRole("anon", null, fn),
    asService: (fn) => inRole("service_role", null, fn),
    asOwner: (fn) => raw.transaction(async (tx) => fn(wrap(tx))),
    close: () => raw.close(),
  };

  if (options.migrate !== false) await migrate();
  return db;
}
