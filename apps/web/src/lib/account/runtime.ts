import { InMemoryLibraryStore, SqlLibraryStore, type LibraryStore } from "@learnthrive/data/library";
import { createExecutor } from "@/lib/db";
import { isDevelopmentBuild } from "@/lib/dev/accounts";
import { seedDevAccounts } from "@/lib/dev/seedAccounts";
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
// `init` holds the in-flight creation, so two requests arriving together (a layout and its page both asking) share ONE runtime: building
// it awaits (the database connection, the development accounts' password hashes), and a second runtime would orphan every session the
// first one issued.
const g = globalThis as unknown as { __learnthriveAccount?: AccountRuntime; __learnthriveAccountInit?: Promise<AccountRuntime> };

async function create(backend: Exclude<AccountBackend, "off">, env: Env): Promise<AccountRuntime> {
  if (backend === "supabase") {
    return {
      backend,
      auth: new SupabaseAccountAuth({ url: env.SUPABASE_URL!, anonKey: env.SUPABASE_ANON_KEY! }),
      store: new SqlLibraryStore((await createExecutor(env.DATABASE_URL!)).executor),
      lockout: new SignInLockout(),
      outbox: null,
      memory: null,
    };
  }
  const memory = new InMemoryLibraryStore();
  const auth = new MemoryAccountAuth({ onUserCreated: (user) => memory.seedProfile({ id: user.id, displayName: user.displayName, adultConfirmed: true, email: user.email }) });
  // A local dev server also has the development accounts (lib/dev/accounts.ts) behind this same sign-in, so one login page serves
  // every kind of person. Tests that build their own runtime (NODE_ENV unset) get none: they start empty.
  if (isDevelopmentBuild(env)) await seedDevAccounts(auth, memory);
  return { backend, auth, store: memory, lockout: new SignInLockout(), outbox: auth.outbox, memory };
}

export async function accountRuntime(env: Env = process.env): Promise<AccountRuntime | null> {
  if (g.__learnthriveAccount) return g.__learnthriveAccount;
  const backend = accountBackend(env);
  if (backend === "off") return null;
  g.__learnthriveAccountInit ??= create(backend, env).then(
    (runtime) => (g.__learnthriveAccount = runtime),
    (error) => {
      delete g.__learnthriveAccountInit; // a failed start (database down) is retried by the next request, not remembered
      throw error;
    },
  );
  return g.__learnthriveAccountInit;
}

/** For tests: forget the singleton. */
export function resetAccountRuntime(): void {
  delete g.__learnthriveAccount;
  delete g.__learnthriveAccountInit;
}
