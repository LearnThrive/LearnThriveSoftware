import type { CareersStore } from "@learnthrive/data/careers";
import { createSqlCareersStore, MemoryCareersStore } from "@learnthrive/data/careers";
import { accountBackend, accountRuntime } from "@/lib/account/runtime";
import { CAREERS_BUCKET, DiskLibraryStorage, MemoryLibraryStorage, SupabaseLibraryStorage, type LibraryStorage } from "@/lib/library/storage";

/**
 * Where tutor applications are kept (launch checklist 3.12): the rows in Postgres, the files in the private `careers` bucket.
 *
 *   supabase  the Postgres store on the accounts' connection, and Supabase Storage with the secret key
 *   memory    development and tests: an in-memory store, and the files in a folder (or memory, for tests)
 *   off       production without those settings: both are null, and the apply route answers "email us" rather than lose an application
 *
 * Server only. Cached on globalThis for the same Fast Refresh reason as the account runtime; a test may put its own in place.
 */
type Env = Record<string, string | undefined>;
const g = globalThis as unknown as { __learnthriveCareers?: CareersStore; __learnthriveCareersFiles?: LibraryStorage };

export function careersStore(env: Env = process.env): CareersStore | null {
  if (g.__learnthriveCareers) return g.__learnthriveCareers;
  const backend = accountBackend(env);
  if (backend === "off") return null;
  if (backend === "memory") return (g.__learnthriveCareers = new MemoryCareersStore());
  return (g.__learnthriveCareers = createSqlCareersStore({
    query: async <T,>(text: string, params?: unknown[]) => {
      const rt = await accountRuntime(env);
      if (!rt?.db) throw new Error("The database connection is not available.");
      return rt.db.query<T>(text, params);
    },
  }));
}

/** The private bucket. In production it needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; without them there is none. */
export function careersFiles(env: Env = process.env): LibraryStorage | null {
  if (g.__learnthriveCareersFiles) return g.__learnthriveCareersFiles;
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  let storage: LibraryStorage | null = null;
  if (url && key) storage = new SupabaseLibraryStorage({ url, serviceRoleKey: key, bucket: CAREERS_BUCKET });
  else if (env.NODE_ENV !== "production") storage = new DiskLibraryStorage(`${env.LIBRARY_DEV_STORAGE_DIR?.trim() || ".library-dev-storage"}/${CAREERS_BUCKET}`);
  if (storage) g.__learnthriveCareersFiles = storage;
  return storage;
}

/** Tests: a fresh in-memory store and file store, returned so the test can look inside. */
export function useMemoryCareers(): { store: MemoryCareersStore; files: MemoryLibraryStorage } {
  const store = new MemoryCareersStore();
  const files = new MemoryLibraryStorage();
  g.__learnthriveCareers = store;
  g.__learnthriveCareersFiles = files;
  return { store, files };
}

/** Tests: forget whatever was chosen, so the next call decides again from the environment. */
export function resetCareers(): void {
  delete g.__learnthriveCareers;
  delete g.__learnthriveCareersFiles;
}
