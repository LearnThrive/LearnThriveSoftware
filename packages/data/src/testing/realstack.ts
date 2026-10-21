/**
 * Harness for the tests that run against the REAL local Supabase stack (`npx supabase start`: Postgres 17, Auth, PostgREST,
 * Storage, the pooler, the mail catcher), not PGlite. Used by realstack.test.ts, which is skipped unless SUPABASE_LOCAL=1.
 *
 *   const s = stack();                       // URLs and keys of the local stack, read from `supabase status`
 *   const sql = openDb(s);                   // direct SQL as the stack's own postgres role (fixtures and checks only)
 *   const a = await newUser(s, { ... });     // a confirmed user, made through the real Auth admin API
 *   const token = await signIn(s, email, pw) // a real access token (JWT) from the real Auth service
 *   await rest(s, token, "GET", "/clients")  // PostgREST, as that person
 *
 * Safety: the stack's keys are read at run time and never written anywhere; every URL must be on this machine or the harness
 * throws before any request is made, so this can never be pointed at the hosted project by accident.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export interface Stack {
  api: string;
  dbUrl: string;
  mail: string;
  /** sb_publishable_... (not a JWT) */
  publishable: string;
  /** sb_secret_... (not a JWT) */
  secret: string;
  /** The legacy anon JWT and service_role JWT, which the local stack still issues beside the new keys. */
  anonJwt: string;
  serviceJwt: string;
}

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const LOCAL = new Set(["127.0.0.1", "localhost", "::1", "host.docker.internal"]);

let cached: Stack | null = null;

export function stack(): Stack {
  if (cached) return cached;
  const run = spawnSync("npx", ["supabase", "status", "--output", "json"], { cwd: REPO_ROOT, encoding: "utf8", shell: true });
  let status: Record<string, string>;
  try {
    status = JSON.parse(run.stdout);
  } catch {
    throw new Error("The local Supabase stack is not running. Start it with `npx supabase start`, then run this again with SUPABASE_LOCAL=1.");
  }
  const s: Stack = {
    api: status.API_URL!,
    dbUrl: status.DB_URL!,
    mail: status.MAILPIT_URL ?? status.INBUCKET_URL!,
    publishable: status.PUBLISHABLE_KEY!,
    secret: status.SECRET_KEY!,
    anonJwt: status.ANON_KEY!,
    serviceJwt: status.SERVICE_ROLE_KEY!,
  };
  for (const url of [s.api, s.dbUrl, s.mail]) {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    if (!LOCAL.has(host)) throw new Error(`Refusing to run: ${host} is not this machine. These tests only run against the local stack.`);
  }
  return (cached = s);
}

export type Sql = ReturnType<typeof openDb>;

/** Direct SQL as the stack's postgres role (it owns the tables: fixtures, grants and catalogue checks only). */
export function openDb(s: Stack) {
  return postgres(s.dbUrl, { max: 2, prepare: false, onnotice: () => {} });
}

export interface Reply<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

async function send<T>(url: string, init: RequestInit): Promise<Reply<T>> {
  const response = await fetch(url, { ...init, redirect: "manual" });
  const text = await response.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON: keep the text */
  }
  return { status: response.status, body, headers: response.headers };
}

/**
 * The project key and, when there is one, a person's token. Measured on the real stack: a new-style key (sb_publishable_ /
 * sb_secret_) works as the apikey ALONE, while a legacy JWT key is refused (401) unless it is also sent as the bearer. The site does
 * the same (apps/web/src/lib/supabaseKeys.ts).
 */
function authHeaders(key: string, token?: string | null): Record<string, string> {
  const bearer = token ?? (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(key) ? key : undefined);
  return { apikey: key, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) };
}

/** PostgREST. `token` is a signed-in person's access token, or null for anon. `key` defaults to the publishable key. */
export function rest<T = any>(
  s: Stack,
  token: string | null,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { body?: unknown; key?: string; headers?: Record<string, string> } = {},
): Promise<Reply<T>> {
  return send<T>(`${s.api}/rest/v1${path}`, {
    method,
    headers: {
      ...authHeaders(options.key ?? s.publishable, token),
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      // Return the rows an update or delete touched, so "no row matched" (RLS hid it) is visible as an empty list.
      ...(method === "GET" ? {} : { Prefer: "return=representation" }),
      ...options.headers,
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

export function rpc<T = any>(s: Stack, token: string | null, name: string, args: unknown, key?: string, headers?: Record<string, string>) {
  return rest<T>(s, token, "POST", `/rpc/${name}`, { body: args, key, headers });
}

export function auth<T = any>(s: Stack, method: "GET" | "POST" | "PUT" | "DELETE", path: string, options: { body?: unknown; key?: string; token?: string | null } = {}) {
  return send<T>(`${s.api}/auth/v1${path}`, {
    method,
    headers: { ...authHeaders(options.key ?? s.publishable, options.token), ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

export interface NewUser {
  id: string;
  email: string;
  password: string;
}

let counter = 0;
export const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const PASSWORD = "Correct-Horse-Battery-9";

/** A confirmed user made through Auth's admin API (the secret key), with the same metadata the sign-up form sends. */
export async function newUser(s: Stack, options: { name: string; adult?: boolean; metadata?: Record<string, unknown> }): Promise<NewUser> {
  counter += 1;
  const email = `rs-${runId}-${counter}-${options.name.toLowerCase().replace(/\W/g, "")}@example.com`;
  const reply = await auth(s, "POST", "/admin/users", {
    key: s.secret,
    body: { email, password: PASSWORD, email_confirm: true, user_metadata: { display_name: options.name, ...(options.adult === false ? {} : { adult_confirmed: true }), ...options.metadata } },
  });
  if (reply.status !== 200 || !reply.body?.id) throw new Error(`could not create a test user (${reply.status})`);
  return { id: reply.body.id as string, email, password: PASSWORD };
}

export async function deleteUser(s: Stack, id: string): Promise<void> {
  await auth(s, "DELETE", `/admin/users/${id}`, { key: s.secret });
}

export async function signIn(s: Stack, email: string, password: string, key?: string): Promise<string> {
  const reply = await auth(s, "POST", "/token?grant_type=password", { body: { email, password }, key });
  if (reply.status !== 200 || !reply.body?.access_token) throw new Error(`sign-in failed (${reply.status}: ${reply.body?.error_code ?? "?"})`);
  return reply.body.access_token as string;
}

/** The newest message to an address in the local mail catcher: its subject and HTML. Waits briefly for delivery. */
export async function lastMail(s: Stack, to: string): Promise<{ subject: string; html: string; text: string } | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = await send<{ messages?: Array<{ ID: string; Subject: string }> }>(`${s.mail}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`, {});
    const first = list.body?.messages?.[0];
    if (first) {
      const full = await send<{ HTML: string; Text: string }>(`${s.mail}/api/v1/message/${first.ID}`, {});
      return { subject: first.Subject, html: full.body.HTML ?? "", text: full.body.Text ?? "" };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}
