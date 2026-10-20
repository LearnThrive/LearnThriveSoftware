import { InMemoryLibraryStore, SqlLibraryStore, type LibraryStore } from "@learnthrive/data/library";
import { MemoryAccountAuth } from "./memoryAuth";
import { SupabaseAccountAuth } from "./supabaseAuth";
import { SignInLockout } from "./lockout";
import type { AccountAuth } from "./types";

type Env = Record<string, string | undefined>;

/**
 * Which backend the account routes run on, and the singletons for it.
 *
 *   supabase  SUPABASE_URL + SUPABASE_ANON_KEY (Auth) and DATABASE_URL (Postgres) are all set.
 *   memory    development and tests only: the in-memory auth and store. NEVER in production.
 *   off       production without the Supabase settings. Every account route answers 503. Fails closed.
 */
export type AccountBackend = "supabase" | "memory" | "off";

export function accountBackend(env: Env = process.env): AccountBackend {
  const has = (key: string) => Boolean(env[key]?.trim());
  if (has("SUPABASE_URL") && has("SUPABASE_ANON_KEY") && has("DATABASE_URL")) return "supabase";
  return env.NODE_ENV === "production" ? "off" : "memory";
}

export interface AccountRuntime {
  backend: Exclude<AccountBackend, "off">;
  auth: AccountAuth;
  store: LibraryStore;
  lockout: SignInLockout;
  /** Memory backend only: the "emails" it would have sent, for the development route and the tests. */
  outbox: MemoryAccountAuth["outbox"] | null;
  /** Memory backend only: the store, so a test can seed families, assignments and subscriptions. */
  memory: InMemoryLibraryStore | null;
}

// Same Fast Refresh reasoning as lib/auth/devProvider.ts: a plain module-level value would reset on every edit.
const g = globalThis as unknown as { __learnthriveAccount?: AccountRuntime };

/** The pooled Postgres connection. Created on first use, never at import, so a build needs no database. */
async function sqlStore(env: Env): Promise<LibraryStore> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(env.DATABASE_URL!, { max: 5, idle_timeout: 20, connect_timeout: 10, prepare: false, onnotice: () => {} });
  return new SqlLibraryStore({ query: async <T,>(text: string, params?: unknown[]) => (await sql.unsafe(text, params as never[])) as unknown as T[] });
}

export async function accountRuntime(env: Env = process.env): Promise<AccountRuntime | null> {
  if (g.__learnthriveAccount) return g.__learnthriveAccount;
  const backend = accountBackend(env);
  if (backend === "off") return null;
  let runtime: AccountRuntime;
  if (backend === "supabase") {
    runtime = {
      backend,
      auth: new SupabaseAccountAuth({ url: env.SUPABASE_URL!, anonKey: env.SUPABASE_ANON_KEY! }),
      store: await sqlStore(env),
      lockout: new SignInLockout(),
      outbox: null,
      memory: null,
    };
  } else {
    const memory = new InMemoryLibraryStore();
    const auth = new MemoryAccountAuth({ onUserCreated: (user) => memory.seedProfile({ id: user.id, displayName: user.displayName, adultConfirmed: true }) });
    runtime = { backend, auth, store: memory, lockout: new SignInLockout(), outbox: auth.outbox, memory };
  }
  g.__learnthriveAccount = runtime;
  return runtime;
}

/** For tests: forget the singleton. */
export function resetAccountRuntime(): void {
  delete g.__learnthriveAccount;
}
