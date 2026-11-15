import { randomUUID } from "node:crypto";
import type { FileStore, LessonChatRepository } from "./repository";
import type { AccessLogEntry, LessonMessage, StoredLessonFile } from "./types";

/** In-memory lesson chat: development, tests, and the launch until the database tables are applied. Nothing survives a restart. */
export class InMemoryLessonChatRepository implements LessonChatRepository {
  private messages = new Map<string, LessonMessage>();
  private files = new Map<string, StoredLessonFile>();
  private access: AccessLogEntry[] = [];

  async addMessage(input: Omit<LessonMessage, "id" | "createdAt" | "removed">, now: Date): Promise<LessonMessage> {
    const message: LessonMessage = { ...input, id: randomUUID(), createdAt: now.toISOString(), removed: null };
    this.messages.set(message.id, message);
    return { ...message };
  }

  async listMessages(lessonId: string): Promise<LessonMessage[]> {
    return [...this.messages.values()].filter((m) => m.lessonId === lessonId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((m) => ({ ...m }));
  }

  async getMessage(id: string): Promise<LessonMessage | null> {
    const message = this.messages.get(id);
    return message ? { ...message } : null;
  }

  async removeMessage(id: string, removal: { by: string; reason: string; at: Date }): Promise<LessonMessage | null> {
    const message = this.messages.get(id);
    if (!message || message.removed) return null;
    message.removed = { at: removal.at.toISOString(), by: removal.by, reason: removal.reason };
    return { ...message };
  }

  async addFile(file: StoredLessonFile): Promise<void> {
    this.files.set(file.id, { ...file });
  }

  async getFile(id: string): Promise<StoredLessonFile | null> {
    const file = this.files.get(id);
    return file ? { ...file } : null;
  }

  async logAccess(entry: Omit<AccessLogEntry, "id" | "at">, now: Date): Promise<AccessLogEntry> {
    const row: AccessLogEntry = { ...entry, id: randomUUID(), at: now.toISOString() };
    this.access.push(row);
    return { ...row };
  }

  async listAccess(lessonId?: string): Promise<AccessLogEntry[]> {
    return this.access.filter((a) => lessonId === undefined || a.lessonId === lessonId).map((a) => ({ ...a }));
  }
}

export class InMemoryFileStore implements FileStore {
  private objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType });
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const found = this.objects.get(key);
    return found ? { bytes: new Uint8Array(found.bytes), contentType: found.contentType } : null;
  }

  /** For tests: how many objects are stored (a refused upload must leave this unchanged). */
  get size(): number {
    return this.objects.size;
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }
}
