import { spawnSync } from "node:child_process";

/**
 * DEVELOPMENT ONLY (called by server.ts, never by the app): points the dev server at the LOCAL Supabase stack that `npm run dev`
 * started, so accounts, the Library and storage run on real Supabase. It is opt-in (`npm run dev:supabase` sets
 * LEARNTHRIVE_SUPABASE_USE=1) because the in-memory test helpers (/api/dev/library-seed and the "tester" account) only exist on the
 * in-memory backend.
 *
 * It never touches anything that is not this machine: it refuses a status whose API or database address is not local, it does nothing
 * in production, and it does not override Supabase settings already in the environment (they are the developer's choice, and
 * `npm run check:env` is what catches a hosted value there). The local keys come from `supabase status` at start-up and are held in
 * memory only: nothing is printed or written.
 */
type Env = Record<string, string | undefined>;

export interface StackStatus {
  API_URL?: string;
  DB_URL?: string;
  PUBLISHABLE_KEY?: string;
  SECRET_KEY?: string;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** `supabase status` as JSON, or null if the stack is not running. */
export function readStackStatus(): StackStatus | null {
  const run = spawnSync("npx supabase status --output json", { shell: true, encoding: "utf8", timeout: 30_000 });
  if (run.status !== 0) return null;
  try {
    return JSON.parse(run.stdout) as StackStatus;
  } catch {
    return null;
  }
}

const isLocal = (url: string | undefined): boolean => {
  try {
    return LOCAL_HOSTS.has(new URL(url ?? "").hostname.replace(/^\[|\]$/g, ""));
  } catch {
    return false;
  }
};

export function applyLocalSupabaseEnv(env: Env = process.env, status: () => StackStatus | null = readStackStatus): { applied: boolean; message: string } {
  if (env.NODE_ENV === "production" || env.LEARNTHRIVE_SUPABASE_USE !== "1") return { applied: false, message: "" };
  if (env.SUPABASE_URL || env.SUPABASE_ANON_KEY || env.DATABASE_URL) {
    return { applied: false, message: "[dev] Supabase settings are already in the environment: leaving them as they are." };
  }
  const s = status();
  if (!s?.API_URL) return { applied: false, message: "[dev] The local Supabase stack is not running, so the site is using its in-memory accounts. `npm run dev` starts it." };
  if (!isLocal(s.API_URL) || !isLocal(s.DB_URL) || !s.PUBLISHABLE_KEY || !s.SECRET_KEY || !s.DB_URL) {
    return { applied: false, message: "[dev] The Supabase status is not a complete local stack: not using it." };
  }
  env.SUPABASE_URL = s.API_URL;
  env.SUPABASE_ANON_KEY = s.PUBLISHABLE_KEY;
  env.SUPABASE_SERVICE_ROLE_KEY = s.SECRET_KEY;
  env.DATABASE_URL = s.DB_URL;
  return { applied: true, message: "[dev] The site is using the LOCAL Supabase stack: real accounts, Library and storage (the in-memory test helpers, /api/dev/library-seed, are not available). Mail goes to http://127.0.0.1:54324." };
}
