import type { AccessLogEntry, LessonMessage, StoredLessonFile } from "./types";

/**
 * Where lesson messages, file records and the audit log are kept. The only writes are ADDING a message, ADDING a file, ADDING an audit line, and an
 * administrator's REMOVAL (which marks a message, it does not delete it). There is deliberately no edit and no delete: nothing a person does can
 * change or erase what was said (docs/LESSON_CHAT.md). An in-memory implementation comes first (memory.ts); the Postgres tables and row-level
 * security are in supabase/migrations/0027_lesson_chat.sql, written as a file and not applied anywhere.
 */
export interface LessonChatRepository {
  addMessage(input: Omit<LessonMessage, "id" | "createdAt" | "removed">, now: Date): Promise<LessonMessage>;
  /** Oldest first. Removed messages are included, marked: what each reader sees of them is decided by the policy, not here. */
  listMessages(lessonId: string): Promise<LessonMessage[]>;
  getMessage(id: string): Promise<LessonMessage | null>;
  /** The administrator's removal. Marks the message (once); returns null if there is no such message or it was already removed. */
  removeMessage(id: string, removal: { by: string; reason: string; at: Date }): Promise<LessonMessage | null>;
  addFile(file: StoredLessonFile): Promise<void>;
  getFile(id: string): Promise<StoredLessonFile | null>;
  /** Append-only. */
  logAccess(entry: Omit<AccessLogEntry, "id" | "at">, now: Date): Promise<AccessLogEntry>;
  listAccess(lessonId?: string): Promise<AccessLogEntry[]>;
}

/** Private storage for the bytes. Never public: files are served only through a short-lived signed URL the web app issues after a read check. */
export interface FileStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
}

export type ScanResult = { status: "clean" } | { status: "infected" | "error"; detail: string };

/**
 * THE HOOK for malware scanning. Every upload passes through `scan` after validation and before storage; anything but "clean" (including a scanner
 * that failed) is refused, so a broken scanner fails closed. None is installed yet: `allowAllScanner` is a placeholder that says everything is
 * clean. TODO(malware-scan) replace it with a real scanner (for example ClamAV over a socket, or a hosted scanning API) in the runtime that builds
 * the service (apps/web/src/lib/lessonChat/runtime.ts), with no other change needed.
 */
export interface FileScanner {
  scan(bytes: Uint8Array, meta: { contentType: string; lessonId: string }): Promise<ScanResult>;
}

export const allowAllScanner: FileScanner = { scan: async () => ({ status: "clean" }) };
