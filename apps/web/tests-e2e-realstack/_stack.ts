/**
 * The harness for the browser tests that run against the REAL local Supabase stack (launch checklist 2.4 and 2.5), with the dev server
 * started on the local stack (`LEARNTHRIVE_SUPABASE_USE=1`): real Auth, real Postgres through the production connection code, the real
 * SQL data provider. The in-memory e2e suite (tests-e2e/) proves the same screens on the development backend; this proves them on the
 * real service, which is the only place the SQL provider's scoping and real Auth's answers can be seen.
 *
 * Safety: every URL is checked to be on this machine before a single request is made, so this can never be pointed at the hosted project.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

const LOCAL = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * The repository root, found by walking up from wherever this was started (Playwright compiles these files to CommonJS, so neither
 * `import.meta.url` nor a fixed relative path is dependable here).
 */
export function repoRoot(from: string = process.cwd()): string {
  for (let at = from; ; at = dirname(at)) {
    if (existsSync(join(at, 'supabase', 'config.toml'))) return at;
    if (dirname(at) === at) throw new Error(`Could not find the repository root above ${from}`);
  }
}
const REPO = repoRoot();

/** The internal sign-in domain usernames map to (docs/AUTHENTICATION.md). Nothing is ever sent there. */
export const ACCOUNT_DOMAIN = 'accounts.learnthrivetuition.co.uk';
/** Where global-setup leaves what the specs need. Outside the repository: it holds temporary passwords. */
export const FIXTURE_FILE = join(tmpdir(), 'learnthrive-realstack-fixture.json');

export interface Stack {
  API_URL: string;
  DB_URL: string;
  MAILPIT_URL: string;
  PUBLISHABLE_KEY: string;
  SECRET_KEY: string;
}

let cached: Stack | null = null;

export function readStack(): Stack {
  if (cached) return cached;
  const run = spawnSync('npx', ['supabase', 'status', '--output', 'json'], { cwd: REPO, encoding: 'utf8', shell: true });
  let status: Record<string, string>;
  try {
    status = JSON.parse(run.stdout);
  } catch {
    throw new Error('The local Supabase stack is not running. Start it with `npm run supabase:start`, then run this again.');
  }
  const stack: Stack = {
    API_URL: status.API_URL!,
    DB_URL: status.DB_URL!,
    MAILPIT_URL: status.MAILPIT_URL ?? status.INBUCKET_URL!,
    PUBLISHABLE_KEY: status.PUBLISHABLE_KEY!,
    SECRET_KEY: status.SECRET_KEY!,
  };
  for (const url of [stack.API_URL, stack.DB_URL, stack.MAILPIT_URL]) {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    assert.ok(LOCAL.has(host), `Refusing to run: ${host} is not this machine. These tests only run against the local stack.`);
  }
  return (cached = stack);
}

export type Sql = ReturnType<typeof openSql>;

export function openSql(stack: Stack = readStack()) {
  return postgres(stack.DB_URL, { max: 3, prepare: false, onnotice: () => {} });
}

/** Auth's admin API with the secret key: the same call the site's own provisioning makes. */
export async function authAdmin(stack: Stack, path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await fetch(`${stack.API_URL}/auth/v1/admin${path}`, {
    ...init,
    headers: { apikey: stack.SECRET_KEY, Authorization: `Bearer ${stack.SECRET_KEY}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

export interface NewAccount {
  username: string;
  displayName: string;
  linkedEmail: string;
  role: 'ADMIN' | 'TUTOR' | 'CLIENT' | 'STUDENT';
  tutorId?: string | null;
  studentId?: string | null;
  /** A known password, so the spec can sign in as this person. */
  password?: string;
}

export interface Account extends NewAccount {
  profileId: string;
  password: string;
}

/**
 * One login on the real stack, made the way the site makes one: the Auth Admin API creates the confirmed internal address, then the
 * `provision_account` transaction (migration 0017) binds it to its username, linked email, role and record.
 *
 * `settled: true` clears "must change password", which is what choosing a password does. The fixtures for the scoping audit are people
 * who have already chosen theirs; the forced change itself is what 2.4's spec walks through a browser.
 */
export async function makeAccount(stack: Stack, sql: Sql, input: NewAccount, settled = true): Promise<Account> {
  const password = input.password ?? `rs-${randomBytes(12).toString('base64url')}`;
  const made = await authAdmin(stack, '/users', {
    method: 'POST',
    body: JSON.stringify({ email: `${input.username}@${ACCOUNT_DOMAIN}`, password, email_confirm: true, user_metadata: { display_name: input.displayName } }),
  });
  assert.equal(made.status, 200, `could not create ${input.username}: ${JSON.stringify(made.body)}`);
  const profileId = made.body?.id as string;
  assert.ok(profileId, `Auth returned no id for ${input.username}`);
  const [{ provision_account: outcome }] = await sql`
    select public.provision_account(${profileId}::uuid, ${input.username}, ${input.linkedEmail}, ${input.displayName}, ${input.role},
      ${input.tutorId ?? null}::uuid, ${input.studentId ?? null}::uuid, null::uuid, now())`;
  assert.equal(outcome, 'ok', `provision_account refused ${input.username}: ${outcome}`);
  if (settled) await sql`update public.profiles set must_change_password = false where id = ${profileId}`;
  return { ...input, profileId, password };
}

/** Deletes a login and everything that cascades from it. Used to put the stack back as it was. */
export async function removeAccount(stack: Stack, profileId: string): Promise<void> {
  await authAdmin(stack, `/users/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
}

/**
 * The one-time recovery token the site's reset email would carry. The site asks Auth for the link (`/admin/generate_link`) and does
 * its own sending through Resend's HTTP API, so on this machine, with no Resend key, nothing is posted and the local mail catcher
 * never sees it: this reads the token Auth stored for that link instead, which is the same token the email would have held.
 */
export async function recoveryTokenFor(sql: Sql, username: string): Promise<string> {
  const [row] = await sql`select recovery_token from auth.users where email = ${`${username}@${ACCOUNT_DOMAIN}`}`;
  assert.ok(row?.recovery_token, `no recovery token was issued for ${username}`);
  return row.recovery_token as string;
}

export function writeFixture(value: unknown): void {
  writeFileSync(FIXTURE_FILE, JSON.stringify(value, null, 2), 'utf8');
}

export function readFixture<T>(): T {
  return JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as T;
}
