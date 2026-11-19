/**
 * Lesson chat and file sharing (docs/LESSON_CHAT.md).
 *
 * Tutors and students exchange messages and files ONLY inside a lesson, and only during that lesson's scheduled time. A message belongs to
 * one lesson instance: each occurrence of a recurring lesson is its own `Lesson` row, so it has its own conversation. There is no other
 * tutor-to-student channel.
 */

export type ChatParty = "tutor" | "student";

export const LESSON_FILE_TYPES = ["image/png", "image/jpeg", "application/pdf"] as const;
export type LessonFileType = (typeof LESSON_FILE_TYPES)[number];

/** What a message says about its file. The bytes are in private storage and are reached only through a short-lived signed URL. */
export interface LessonFileRef {
  id: string;
  /** A cleaned name for display only. It is never used to store, find or serve the file. */
  displayName: string;
  contentType: LessonFileType;
  size: number;
}

export interface StoredLessonFile extends LessonFileRef {
  lessonId: string;
  /** The conversation the file belongs to: every lesson of the same assignment (a weekly lesson) shares one. */
  threadId: string;
  /** The message that carries this file. */
  messageId: string;
  /** Where the bytes are in private storage: generated (`lessons/<lesson>/<uuid>.<ext>`), never derived from what the user sent. */
  storageKey: string;
  uploadedByAccountId: string;
  createdAt: string;
}

export interface LessonMessage {
  id: string;
  /** The lesson occurrence it was sent in. */
  lessonId: string;
  /** The conversation it belongs to: all lessons of one assignment (a recurring lesson) share a thread, so the chat and its files carry over week to week. */
  threadId: string;
  /** The sender's account, and the tutor or student record they sent as (the relationship the send was checked against). */
  senderAccountId: string;
  senderRecordId: string;
  senderParty: ChatParty;
  senderName: string;
  /** Plain text, never interpreted as markup. May be empty for a message that is only a file. */
  text: string;
  file: LessonFileRef | null;
  createdAt: string;
  /** Set only by an administrator's removal. The message is never edited or deleted: it is marked, and hidden from everyone but administrators and the safeguarding lead. */
  removed: { at: string; by: string; reason: string } | null;
}

export type AccessAction = "read_messages" | "read_file" | "remove_message";
export type AccessorKind = "admin" | "safeguarding_lead" | "parent";

/** One line of the audit log: who looked at, or removed, what, and when. Append-only. */
export interface AccessLogEntry {
  id: string;
  at: string;
  lessonId: string;
  actorAccountId: string;
  actorKind: AccessorKind;
  action: AccessAction;
  /** The message or file touched, when there is one. */
  targetId: string | null;
}
