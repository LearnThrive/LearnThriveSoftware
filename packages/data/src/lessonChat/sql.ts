import type { SqlExecutor } from "../library/ports";
import type { FileStore, LessonChatRepository } from "./repository";
import type { AccessLogEntry, ChatParty, LessonMessage, StoredLessonFile } from "./types";

/**
 * Lesson chat in Postgres (supabase/migrations 0027 and 0029). The database stamps the time and the thread and refuses a sender who is not part
 * of the lesson; this repository only adds, lists, and marks a removal. Messages are keyed by THREAD (the lesson's assignment), so a weekly lesson
 * keeps one conversation across its occurrences.
 */
type Row = Record<string, any>;
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

const MESSAGE_SELECT = `select m.id, m.lesson_id, m.thread_id, m.sender_profile_id, m.sender_party, m.sender_record_id, m.sender_name, m.body, m.created_at,
         m.removed_at, m.removed_by, m.removal_reason,
         f.id as file_id, f.display_name as file_name, f.content_type as file_type, f.size_bytes as file_size
    from public.lesson_messages m left join public.lesson_files f on f.message_id = m.id`;

function toMessage(r: Row): LessonMessage {
  return {
    id: r.id,
    lessonId: r.lesson_id,
    threadId: r.thread_id,
    senderAccountId: r.sender_profile_id ?? "",
    senderRecordId: r.sender_record_id,
    senderParty: r.sender_party as ChatParty,
    senderName: r.sender_name,
    text: r.body,
    file: r.file_id ? { id: r.file_id, displayName: r.file_name, contentType: r.file_type, size: Number(r.file_size) } : null,
    createdAt: iso(r.created_at),
    removed: r.removed_at ? { at: iso(r.removed_at), by: r.removed_by ?? "", reason: r.removal_reason } : null,
  };
}

export function createSqlLessonChatRepository(db: SqlExecutor): LessonChatRepository {
  return {
    async addMessage(input) {
      const rows = await db.query<Row>(
        `insert into public.lesson_messages (lesson_id, sender_profile_id, sender_party, sender_record_id, sender_name, body)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [input.lessonId, input.senderAccountId, input.senderParty, input.senderRecordId, input.senderName, input.text],
      );
      return { ...toMessage(rows[0]!), file: input.file };
    },
    async listMessages(threadId) {
      const rows = await db.query<Row>(`${MESSAGE_SELECT} where m.thread_id = $1 order by m.created_at, m.id`, [threadId]);
      return rows.map(toMessage);
    },
    async getMessage(id) {
      const rows = await db.query<Row>(`${MESSAGE_SELECT} where m.id = $1`, [id]);
      return rows[0] ? toMessage(rows[0]) : null;
    },
    async removeMessage(id, removal) {
      const rows = await db.query<Row>(
        `update public.lesson_messages set removed_at = $2, removed_by = $3, removal_reason = $4 where id = $1 and removed_at is null returning id`,
        [id, removal.at.toISOString(), removal.by, removal.reason],
      );
      if (!rows[0]) return null;
      const again = await db.query<Row>(`${MESSAGE_SELECT} where m.id = $1`, [id]);
      return again[0] ? toMessage(again[0]) : null;
    },
    async addFile(file) {
      await db.query(
        `insert into public.lesson_files (id, lesson_id, message_id, storage_key, content_type, size_bytes, display_name, uploaded_by) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [file.id, file.lessonId, file.messageId, file.storageKey, file.contentType, file.size, file.displayName, file.uploadedByAccountId],
      );
    },
    async getFile(id) {
      const rows = await db.query<Row>(
        `select id, lesson_id, thread_id, message_id, storage_key, content_type, size_bytes, display_name, uploaded_by, created_at from public.lesson_files where id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) return null;
      const file: StoredLessonFile = {
        id: r.id, lessonId: r.lesson_id, threadId: r.thread_id, messageId: r.message_id, storageKey: r.storage_key, contentType: r.content_type,
        size: Number(r.size_bytes), displayName: r.display_name, uploadedByAccountId: r.uploaded_by ?? "", createdAt: iso(r.created_at),
      };
      return file;
    },
    async logAccess(entry) {
      const rows = await db.query<Row>(
        `insert into public.lesson_chat_access_log (lesson_id, actor_profile_id, actor_kind, action, target_id) values ($1, $2, $3, $4, $5) returning id, at`,
        [entry.lessonId, entry.actorAccountId, entry.actorKind, entry.action, entry.targetId],
      );
      return { ...entry, id: String(rows[0]!.id), at: iso(rows[0]!.at) } satisfies AccessLogEntry;
    },
    async listAccess(lessonId) {
      const rows = await db.query<Row>(
        `select id, at, lesson_id, actor_profile_id, actor_kind, action, target_id from public.lesson_chat_access_log ${lessonId ? "where lesson_id = $1" : ""} order by id`,
        lessonId ? [lessonId] : [],
      );
      return rows.map((r) => ({ id: String(r.id), at: iso(r.at), lessonId: r.lesson_id, actorAccountId: r.actor_profile_id ?? "", actorKind: r.actor_kind, action: r.action, targetId: r.target_id ?? null }));
    },
  };
}

/** Stored bytes in Postgres (public.lesson_file_objects): private, survives a restart, and needs no storage bucket. */
export function createSqlFileStore(db: SqlExecutor): FileStore {
  return {
    async put(key, bytes, contentType) {
      await db.query(`insert into public.lesson_file_objects (storage_key, content_type, bytes) values ($1, $2, $3)`, [key, contentType, Buffer.from(bytes)]);
    },
    async get(key) {
      const rows = await db.query<Row>(`select content_type, bytes from public.lesson_file_objects where storage_key = $1`, [key]);
      const r = rows[0];
      return r ? { bytes: new Uint8Array(r.bytes), contentType: r.content_type } : null;
    },
  };
}
