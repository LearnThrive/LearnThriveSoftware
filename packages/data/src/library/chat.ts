/**
 * Study Buddy records (plan19 phase F). The schema is supabase/migrations/0004_assistant.sql: chat text is kept 30 days,
 * uploads 7 days or until the chat is deleted, and nothing here is ever logged. Plain data only; behaviour is in the stores.
 */
export type ChatRole = "user" | "assistant";

export const CHAT_TEXT_DAYS = 30;
export const CHAT_UPLOAD_DAYS = 7;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whose conversations a chat call is about. Every session-scoped repository method takes this instead of a bare family id, so the
 * scope cannot be forgotten: a guardian's own chats have `studentId: null`; a learner's have theirs. A sibling, and the guardian,
 * never read each other's conversations by guessing a session id, because the id is only ever looked up inside the owner's rows.
 */
export interface ChatOwner {
  clientId: string;
  studentId: string | null;
}

export interface ChatSessionRecord {
  id: string;
  clientId: string;
  /** The student profile the chat is for, if any. Null means the account holder's own chat. */
  studentId: string | null;
  title: string;
  createdAt: Date;
  lastActivityAt: Date;
  deleteAfter: Date;
  deletionRequestedAt: Date | null;
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  createdAt: Date;
  deleteAfter: Date;
}

export interface ChatFileRecord {
  id: string;
  sessionId: string;
  messageId: string | null;
  /** In the private `chat-uploads` bucket. */
  storagePath: string;
  bytes: number;
  contentType: "image/jpeg" | "image/png" | "application/pdf";
  /** What the upload said, once it was read: kept so a follow-up does not re-read and re-picture it. Null until read. */
  extractedText: string | null;
  /** Pages read (a PDF), or 1 for a photo. Null until read. */
  pages: number | null;
  createdAt: Date;
  deleteAfter: Date;
}

export interface ChatFileReading {
  extractedText: string;
  pages: number | null;
}

/** One chunk of an upload with its embedding (0014_chat_retrieval.sql). */
export interface ChatFileChunkRecord {
  id: string;
  fileId: string;
  sessionId: string;
  page: number | null;
  /** "question 4(b)" or "page 2" when the chunk came from a known region; null otherwise. */
  label: string | null;
  ordinal: number;
  text: string;
  model: string;
  digest: string | null;
  dimension: number;
  chunkConfigVersion: string;
  embedding: number[];
  createdAt: Date;
}

export interface ChatFileChunkInput {
  page: number | null;
  label: string | null;
  ordinal: number;
  text: string;
  model: string;
  digest: string | null;
  chunkConfigVersion: string;
  /** The vector. Its length IS the dimension stored with the chunk (the database checks they agree). */
  embedding: number[];
}

export interface ChatFileInput {
  messageId?: string | null;
  storagePath: string;
  bytes: number;
  contentType: ChatFileRecord["contentType"];
}

/** Everything held for one family, for "export my data". Dates are ISO strings so it serialises as is. */
export interface ChatExport {
  exportedAt: string;
  sessions: Array<{
    id: string;
    title: string;
    createdAt: string;
    lastActivityAt: string;
    messages: Array<{ role: ChatRole; content: string; createdAt: string }>;
    files: Array<{ contentType: string; bytes: number; createdAt: string; deleteAfter: string }>;
  }>;
}

export interface PurgeResult {
  sessions: number;
  messages: number;
  files: number;
}
