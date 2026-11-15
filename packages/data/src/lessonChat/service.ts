import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { LessonChatConfig } from "./config";
import { checkUpload, newStorageKey } from "./files";
import { canRead, canRemove, canSend, chatWindow, type ChatActor, type ChatLesson } from "./policy";
import type { FileScanner, FileStore, LessonChatRepository } from "./repository";
import type { AccessorKind, LessonFileType, LessonMessage } from "./types";

/**
 * The lesson chat, in one place (docs/LESSON_CHAT.md). Every send, read, file fetch and removal goes through this service, from the HTTP routes
 * and from the classroom's Socket.IO path alike, and every one asks `policy.ts` first. Nothing here trusts the caller: the actor and the lesson
 * are looked up by the server, and the clock is the server's.
 */

export type ChatStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500;
export interface Refusal { ok: false; status: ChatStatus; code: string; message: string }
const refuse = (status: ChatStatus, code: string, message: string): Refusal => ({ ok: false, status, code, message });

/** What a reader is shown of a message. A removed one is blank to everyone but an administrator or the safeguarding lead. */
export interface MessageView {
  id: string;
  senderParty: "tutor" | "student";
  senderName: string;
  text: string;
  file: { id: string; displayName: string; contentType: LessonFileType; size: number; url: string } | null;
  createdAt: string;
  removed: null | { at: string; by?: string; reason?: string };
}

export interface ChatServiceDeps {
  lessons: { get(id: string): Promise<ChatLesson | null> };
  repo: LessonChatRepository;
  files: FileStore;
  scanner: FileScanner;
  config: LessonChatConfig;
  /** Signs file URLs. Required: there is no default, so no URL is ever signed with a made-up key. */
  urlSecret: string;
  now?: () => Date;
}

const STATUS_FOR_SEND: Record<string, ChatStatus> = { LESSON_NOT_FOUND: 404, NOT_PARTICIPANT: 403, JUNIOR_TUTOR_CANNOT_SEND: 403, LESSON_CANCELLED: 403, LESSON_NOT_SCHEDULED: 403, TOO_EARLY: 403, TOO_LATE: 403 };
const STATUS_FOR_UPLOAD: Record<string, ChatStatus> = { FILE_EMPTY: 400, FILE_TOO_LARGE: 413, FILE_TYPE_NOT_ALLOWED: 415, FILE_NAME_NOT_ALLOWED: 400, FILE_CORRUPT: 400, FILE_UNSAFE: 415 };

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function cleanText(raw: unknown, max: number, allowEmpty: boolean): string | null {
  if (typeof raw !== "string" || raw.length > max * 4) return null;
  const text = raw.replace(CONTROL, "").replace(/\r\n/g, "\n").trim();
  if (text.length > max || (!allowEmpty && text.length === 0)) return null;
  return text;
}

export interface FileToken { lessonId: string; fileId: string; accountId: string; exp: number }

export function createLessonChatService(deps: ChatServiceDeps) {
  const { repo, files, scanner, config } = deps;
  const now = () => (deps.now ? deps.now() : new Date());
  const recent = new Map<string, number[]>(); // `${lesson}:${account}` -> send times, for the per-minute limit

  const sign = (t: FileToken) => createHmac("sha256", deps.urlSecret).update(`${t.lessonId}.${t.fileId}.${t.accountId}.${t.exp}`).digest("base64url");

  /** A link to a file that works for one person for `signedUrlSeconds`. Not a way in by itself: opening it re-checks the person's right to read (`openFile`). */
  function fileUrl(lessonId: string, fileId: string, accountId: string): string {
    const exp = now().getTime() + config.signedUrlSeconds * 1000;
    const sig = sign({ lessonId, fileId, accountId, exp });
    return `/api/lessons/${encodeURIComponent(lessonId)}/files/${encodeURIComponent(fileId)}?u=${encodeURIComponent(accountId)}&exp=${exp}&sig=${sig}`;
  }

  function limited(lessonId: string, accountId: string): boolean {
    const key = `${lessonId}:${accountId}`;
    const t = now().getTime();
    const times = (recent.get(key) ?? []).filter((x) => t - x < 60_000);
    if (times.length >= config.messagesPerMinute) { recent.set(key, times); return true; }
    times.push(t);
    recent.set(key, times);
    return false;
  }

  async function view(message: LessonMessage, lessonId: string, accountId: string, seesRemoved: boolean): Promise<MessageView> {
    if (message.removed && !seesRemoved) {
      return { id: message.id, senderParty: message.senderParty, senderName: "", text: "", file: null, createdAt: message.createdAt, removed: { at: message.removed.at } };
    }
    return {
      id: message.id,
      senderParty: message.senderParty,
      senderName: message.senderName,
      text: message.text,
      file: message.file ? { ...message.file, url: fileUrl(lessonId, message.file.id, accountId) } : null,
      createdAt: message.createdAt,
      removed: message.removed ? { at: message.removed.at, by: message.removed.by, reason: message.removed.reason } : null,
    };
  }

  async function checkSend(actor: ChatActor, lessonId: string) {
    const lesson = await deps.lessons.get(lessonId);
    const decision = canSend(lesson, actor, now(), config);
    if (!decision.ok) return refuse(STATUS_FOR_SEND[decision.code] ?? 403, decision.code, decision.message);
    return { ok: true as const, lesson: lesson!, party: decision.party };
  }

  return {
    /** Would a send be allowed right now? The same checks as a send, without sending: so a big upload is refused before it is read. */
    async mayUpload(actor: ChatActor, lessonId: string): Promise<{ ok: true } | Refusal> {
      const allowed = await checkSend(actor, lessonId);
      return allowed.ok ? { ok: true } : allowed;
    },

    /** Sends a text message. */
    async sendText(actor: ChatActor, lessonId: string, rawText: unknown): Promise<{ ok: true; message: MessageView } | Refusal> {
      const allowed = await checkSend(actor, lessonId);
      if (!allowed.ok) return allowed;
      const text = cleanText(rawText, config.maxTextLength, false);
      if (text === null) return refuse(400, "BAD_MESSAGE", `A message is 1 to ${config.maxTextLength} characters.`);
      if (limited(lessonId, actor.accountId)) return refuse(429, "TOO_FAST", "You are sending messages too quickly. Please slow down.");
      const message = await repo.addMessage({ lessonId, senderAccountId: actor.accountId, senderRecordId: (allowed.party === "tutor" ? actor.tutorId : actor.studentId)!, senderParty: allowed.party, senderName: actor.name, text, file: null }, now());
      return { ok: true, message: await view(message, lessonId, actor.accountId, false) };
    },

    /**
     * Shares a file (with an optional caption). The send rules are checked FIRST, so a person who may not send learns nothing about the file rules and
     * nothing is read, scanned or stored for them. Then the file is validated, stripped of metadata, scanned, stored under a generated name, and only
     * then posted.
     */
    async sendFile(actor: ChatActor, lessonId: string, upload: { name: unknown; declaredType: unknown; bytes: Uint8Array; caption?: unknown }): Promise<{ ok: true; message: MessageView } | Refusal> {
      const allowed = await checkSend(actor, lessonId);
      if (!allowed.ok) return allowed;
      const caption = upload.caption === undefined || upload.caption === null ? "" : cleanText(upload.caption, config.maxCaptionLength, true);
      if (caption === null) return refuse(400, "BAD_MESSAGE", `A caption is at most ${config.maxCaptionLength} characters.`);
      const checked = checkUpload({ name: upload.name, declaredType: upload.declaredType, bytes: upload.bytes }, config.maxFileBytes);
      if (!checked.ok) return refuse(STATUS_FOR_UPLOAD[checked.code] ?? 400, checked.code, checked.message);
      const scan = await scanner.scan(checked.bytes, { contentType: checked.contentType, lessonId }).catch((): { status: "error"; detail: string } => ({ status: "error", detail: "scanner failed" }));
      if (scan.status !== "clean") return refuse(415, "FILE_SCAN_FAILED", "That file could not be checked, so it was not shared.");
      if (limited(lessonId, actor.accountId)) return refuse(429, "TOO_FAST", "You are sending messages too quickly. Please slow down.");

      const fileId = randomUUID();
      const storageKey = newStorageKey(lessonId, checked.ext);
      await files.put(storageKey, checked.bytes, checked.contentType);
      const ref = { id: fileId, displayName: checked.displayName, contentType: checked.contentType, size: checked.bytes.length };
      const message = await repo.addMessage({ lessonId, senderAccountId: actor.accountId, senderRecordId: (allowed.party === "tutor" ? actor.tutorId : actor.studentId)!, senderParty: allowed.party, senderName: actor.name, text: caption, file: ref }, now());
      await repo.addFile({ ...ref, lessonId, messageId: message.id, storageKey, uploadedByAccountId: actor.accountId, createdAt: message.createdAt });
      return { ok: true, message: await view(message, lessonId, actor.accountId, false) };
    },

    /** The lesson's messages for this reader, oldest first, with what they may do next. Audited when the reader is not a participant. */
    async list(actor: ChatActor, lessonId: string): Promise<{ ok: true; messages: MessageView[]; canSend: boolean; sendBlockedReason: string | null; window: { start: string; end: string } | null; readerKind: string } | Refusal> {
      const lesson = await deps.lessons.get(lessonId);
      const read = canRead(lesson, actor, now(), config);
      if (!read.ok) return refuse(read.code === "LESSON_NOT_FOUND" ? 404 : 403, read.code, read.message);
      if (read.audited) await repo.logAccess({ lessonId, actorAccountId: actor.accountId, actorKind: read.kind as AccessorKind, action: "read_messages", targetId: null }, now());
      const messages = await Promise.all((await repo.listMessages(lessonId)).map((m) => view(m, lessonId, actor.accountId, read.seesRemoved)));
      const sendDecision = canSend(lesson, actor, now(), config);
      const window = chatWindow(lesson!, config);
      return {
        ok: true,
        messages,
        canSend: sendDecision.ok,
        sendBlockedReason: sendDecision.ok ? null : sendDecision.message,
        window: window ? { start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString() } : null,
        readerKind: read.kind,
      };
    },

    /**
     * Opens a file from a signed link. The link must be valid, not expired, made for THIS person, THIS lesson and THIS file; the file must belong to
     * this lesson (a link or an id from another lesson fails); and the person must still have the right to read the lesson. A removed message's file
     * is served only to those who may see removed content. Reads by non-participants are audited.
     */
    async openFile(actor: ChatActor, lessonId: string, fileId: string, link: { u: string; exp: string; sig: string }): Promise<{ ok: true; bytes: Uint8Array; contentType: string; displayName: string } | Refusal> {
      const exp = Number(link.exp);
      const token: FileToken = { lessonId, fileId, accountId: link.u, exp };
      const expected = Buffer.from(sign(token));
      const given = Buffer.from(typeof link.sig === "string" ? link.sig : "");
      if (!Number.isFinite(exp) || expected.length !== given.length || !timingSafeEqual(expected, given)) return refuse(403, "BAD_LINK", "That link is not valid.");
      if (exp < now().getTime()) return refuse(403, "LINK_EXPIRED", "That link has expired. Reload the lesson to get a new one.");
      if (link.u !== actor.accountId) return refuse(403, "BAD_LINK", "That link is not valid.");
      const file = await repo.getFile(fileId);
      if (!file || file.lessonId !== lessonId) return refuse(404, "NOT_FOUND", "There is no such file.");
      const lesson = await deps.lessons.get(lessonId);
      const read = canRead(lesson, actor, now(), config);
      if (!read.ok) return refuse(read.code === "LESSON_NOT_FOUND" ? 404 : 403, read.code, read.message);
      const message = await repo.getMessage(file.messageId);
      if (message?.removed && !read.seesRemoved) return refuse(404, "NOT_FOUND", "There is no such file.");
      const stored = await files.get(file.storageKey);
      if (!stored) return refuse(404, "NOT_FOUND", "There is no such file.");
      if (read.audited) await repo.logAccess({ lessonId, actorAccountId: actor.accountId, actorKind: read.kind as AccessorKind, action: "read_file", targetId: fileId }, now());
      return { ok: true, bytes: stored.bytes, contentType: stored.contentType, displayName: file.displayName };
    },

    /** An administrator's removal of a message. The message is marked and hidden, never deleted; the removal is audited. */
    async remove(actor: ChatActor, lessonId: string, messageId: string, rawReason: unknown): Promise<{ ok: true } | Refusal> {
      if (!canRemove(actor)) return refuse(403, "NOT_ADMIN", "Only an administrator can remove a message.");
      const reason = cleanText(rawReason, 300, false);
      if (reason === null) return refuse(400, "BAD_REASON", "Give a reason (up to 300 characters).");
      const message = await repo.getMessage(messageId);
      if (!message || message.lessonId !== lessonId) return refuse(404, "NOT_FOUND", "There is no such message in this lesson.");
      const removed = await repo.removeMessage(messageId, { by: actor.accountId, reason, at: now() });
      if (!removed) return refuse(409, "ALREADY_REMOVED", "That message was already removed.");
      await repo.logAccess({ lessonId, actorAccountId: actor.accountId, actorKind: "admin", action: "remove_message", targetId: messageId }, now());
      return { ok: true };
    },
  };
}

export type LessonChatService = ReturnType<typeof createLessonChatService>;
