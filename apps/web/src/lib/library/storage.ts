import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

/**
 * Private file storage for the Library (plan19 phase D). The bucket `library` is private: nothing in it is ever
 * public. The server reads an object through a signed URL that lives 60 seconds, issued after `canAccess`, and the
 * browser never sees that URL: the route watermarks the bytes and sends them itself (see download.ts for why).
 *
 * Three implementations of one small interface: Supabase Storage (production, over its REST API with the service
 * role key, which only the server and the import tool ever hold), a folder on disk (local development and the import
 * tool's dry runs), and memory (tests).
 */
export const LIBRARY_BUCKET = "library";
export const SIGNED_URL_SECONDS = 60;

export interface LibraryStorage {
  /** Stores an object at `path` (the import tool). Writing the same bytes again is not an error. */
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The object's bytes, or null if there is none. Never throws for "not found". */
  read(path: string): Promise<Uint8Array | null>;
}

/** A path inside the bucket: no leading slash, no `..`, no backslash, no control characters. */
export function safeStoragePath(path: string): boolean {
  return path.length > 0 && path.length <= 400 && !path.startsWith("/") && !path.includes("..") && !path.includes("\\") && !/[\u0000-\u001f]/.test(path);
}

export class MemoryLibraryStorage implements LibraryStorage {
  readonly objects = new Map<string, Uint8Array>();
  async put(path: string, bytes: Uint8Array): Promise<void> {
    if (!safeStoragePath(path)) throw new Error("unsafe storage path");
    this.objects.set(path, bytes);
  }
  async read(path: string): Promise<Uint8Array | null> {
    return safeStoragePath(path) ? (this.objects.get(path) ?? null) : null;
  }
}

export class DiskLibraryStorage implements LibraryStorage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private locate(path: string): string | null {
    if (!safeStoragePath(path)) return null;
    const full = resolve(this.root, path);
    return full.startsWith(this.root + sep) ? full : null;
  }
  async put(path: string, bytes: Uint8Array): Promise<void> {
    const full = this.locate(path);
    if (!full) throw new Error("unsafe storage path");
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }
  async read(path: string): Promise<Uint8Array | null> {
    const full = this.locate(path);
    if (!full) return null;
    try {
      return new Uint8Array(await readFile(full));
    } catch {
      return null;
    }
  }
}

export interface SupabaseStorageConfig {
  url: string;
  /** The service role key. Server and import tool only; it bypasses every policy. Never logged, never sent to a browser. */
  serviceRoleKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class SupabaseLibraryStorage implements LibraryStorage {
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;
  constructor(private readonly config: SupabaseStorageConfig) {
    this.base = `${config.url.replace(/\/+$/, "")}/storage/v1`;
    this.doFetch = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.config.serviceRoleKey, Authorization: `Bearer ${this.config.serviceRoleKey}`, ...extra };
  }

  private encoded(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  async put(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    if (!safeStoragePath(path)) throw new Error("unsafe storage path");
    const response = await this.doFetch(`${this.base}/object/${LIBRARY_BUCKET}/${this.encoded(path)}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "x-upsert": "true", "Cache-Control": "private, max-age=0" }),
      body: bytes as unknown as BodyInit,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`storage upload failed (${response.status})`);
  }

  async read(path: string): Promise<Uint8Array | null> {
    if (!safeStoragePath(path)) return null;
    try {
      const signed = await this.doFetch(`${this.base}/object/sign/${LIBRARY_BUCKET}/${this.encoded(path)}`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!signed.ok) return null;
      const body = (await signed.json().catch(() => null)) as { signedURL?: unknown } | null;
      // The reply is a path relative to /storage/v1. Anything else is not trusted as a place to fetch from.
      if (typeof body?.signedURL !== "string" || !body.signedURL.startsWith(`/object/sign/${LIBRARY_BUCKET}/`)) return null;
      const object = await this.doFetch(`${this.base}${body.signedURL}`, { signal: AbortSignal.timeout(this.timeoutMs) });
      return object.ok ? new Uint8Array(await object.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }
}

type Env = Record<string, string | undefined>;

// One per process, like the account runtime.
const g = globalThis as unknown as { __learnthriveLibraryStorage?: LibraryStorage };

/** Production: Supabase Storage, if its settings are there. Development: a folder. Production without settings: none. */
export function libraryStorage(env: Env = process.env): LibraryStorage | null {
  if (g.__learnthriveLibraryStorage) return g.__learnthriveLibraryStorage;
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  let storage: LibraryStorage | null = null;
  if (url && key) storage = new SupabaseLibraryStorage({ url, serviceRoleKey: key });
  else if (env.NODE_ENV !== "production") storage = new DiskLibraryStorage(env.LIBRARY_DEV_STORAGE_DIR?.trim() || ".library-dev-storage");
  if (storage) g.__learnthriveLibraryStorage = storage;
  return storage;
}
