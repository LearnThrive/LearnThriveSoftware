import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
/** Study Buddy uploads live in their own private bucket, with the same rules. */
export const CHAT_UPLOADS_BUCKET = "chat-uploads";
export const SIGNED_URL_SECONDS = 60;

export interface LibraryStorage {
  /** Stores an object at `path` (the import tool). Writing the same bytes again is not an error. */
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The object's bytes, or null if there is none. Never throws for "not found". */
  read(path: string): Promise<Uint8Array | null>;
  /** Deletes an object. Deleting what is not there is not an error. Throws only if the storage itself failed. */
  remove(path: string): Promise<void>;
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
  async remove(path: string): Promise<void> {
    this.objects.delete(path);
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
    // Written beside and renamed over, so a reader (another request, another test worker) never sees a half-written file.
    const temp = `${full}.${randomUUID()}.tmp`;
    await writeFile(temp, bytes);
    try {
      await rename(temp, full);
    } catch {
      await rm(temp, { force: true });
      await writeFile(full, bytes);
    }
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
  async remove(path: string): Promise<void> {
    const full = this.locate(path);
    if (!full) return;
    await rm(full, { force: true });
  }
}

export interface SupabaseStorageConfig {
  url: string;
  /** The service role key. Server and import tool only; it bypasses every policy. Never logged, never sent to a browser. */
  serviceRoleKey: string;
  /** The private bucket. Default `library`. */
  bucket?: string;
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
    this.bucket = config.bucket ?? LIBRARY_BUCKET;
  }

  private readonly bucket: string;

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.config.serviceRoleKey, Authorization: `Bearer ${this.config.serviceRoleKey}`, ...extra };
  }

  private encoded(path: string): string {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  async put(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    if (!safeStoragePath(path)) throw new Error("unsafe storage path");
    const response = await this.doFetch(`${this.base}/object/${this.bucket}/${this.encoded(path)}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType, "x-upsert": "true", "Cache-Control": "private, max-age=0" }),
      body: bytes as unknown as BodyInit,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`storage upload failed (${response.status})`);
  }

  async remove(path: string): Promise<void> {
    if (!safeStoragePath(path)) return;
    const response = await this.doFetch(`${this.base}/object/${this.bucket}/${this.encoded(path)}`, { method: "DELETE", headers: this.headers(), signal: AbortSignal.timeout(this.timeoutMs) });
    // Not found is fine: the object is already gone.
    if (!response.ok && response.status !== 404 && response.status !== 400) throw new Error(`storage delete failed (${response.status})`);
  }

  async read(path: string): Promise<Uint8Array | null> {
    if (!safeStoragePath(path)) return null;
    try {
      const signed = await this.doFetch(`${this.base}/object/sign/${this.bucket}/${this.encoded(path)}`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!signed.ok) return null;
      const body = (await signed.json().catch(() => null)) as { signedURL?: unknown } | null;
      // The reply is a path relative to /storage/v1. Anything else is not trusted as a place to fetch from.
      if (typeof body?.signedURL !== "string" || !body.signedURL.startsWith(`/object/sign/${this.bucket}/`)) return null;
      const object = await this.doFetch(`${this.base}${body.signedURL}`, { signal: AbortSignal.timeout(this.timeoutMs) });
      return object.ok ? new Uint8Array(await object.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }
}

type Env = Record<string, string | undefined>;

// One per process, like the account runtime.
const g = globalThis as unknown as { __learnthriveLibraryStorage?: LibraryStorage; __learnthriveChatStorage?: LibraryStorage };

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

/** Study Buddy's private upload bucket (same backend as the Library's, a different bucket and, in development, folder). */
export function chatUploadStorage(env: Env = process.env): LibraryStorage | null {
  if (g.__learnthriveChatStorage) return g.__learnthriveChatStorage;
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  let storage: LibraryStorage | null = null;
  if (url && key) storage = new SupabaseLibraryStorage({ url, serviceRoleKey: key, bucket: CHAT_UPLOADS_BUCKET });
  else if (env.NODE_ENV !== "production") storage = new DiskLibraryStorage(`${env.LIBRARY_DEV_STORAGE_DIR?.trim() || ".library-dev-storage"}/${CHAT_UPLOADS_BUCKET}`);
  if (storage) g.__learnthriveChatStorage = storage;
  return storage;
}
