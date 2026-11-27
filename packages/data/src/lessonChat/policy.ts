import type { Role } from "../roles";
import type { AccessorKind, ChatParty } from "./types";

/**
 * Who may send in, and who may read, a lesson's chat (docs/LESSON_CHAT.md). Pure functions: the web app calls them on EVERY send and read, from
 * the HTTP routes and from the classroom's Socket.IO path alike, so the rules are in one place and are never the client's to enforce.
 *
 * Access follows the RELATIONSHIP to this lesson, never the role alone: being a tutor does not let you into another tutor's lesson, and being
 * a student does not let you into another student's. A person who holds several roles is checked against this lesson with each role's own record.
 */

export interface ChatLesson {
  id: string;
  /** The conversation this lesson belongs to: its assignment, so every occurrence of a weekly lesson shares one chat. Defaults to the lesson itself. */
  threadId?: string;
  tutorId: string;
  studentIds: readonly string[];
  clientIds: readonly string[];
  /** ISO instant. The schedule is an instant, so Europe/London daylight saving is already accounted for. */
  startAt: string;
  durationMinutes: number;
  status: string;
}

/** The person acting, with the record each of their roles stands on (built on the server from their account, never from the request). */
export interface ChatActor {
  accountId: string;
  /** The name shown on what they send. */
  name: string;
  roles: readonly Role[];
  tutorId: string | null;
  studentId: string | null;
  clientId: string | null;
  isSafeguardingLead: boolean;
}

export type Relationship = "tutor" | "junior_tutor" | "student" | "parent" | "admin" | "safeguarding_lead";

/** The conversation a lesson's chat lives in. */
export const threadOf = (lesson: Pick<ChatLesson, "id" | "threadId">): string => lesson.threadId ?? lesson.id;

export function relationshipsOf(lesson: ChatLesson, actor: ChatActor): Set<Relationship> {
  const holds = (role: Role) => actor.roles.includes(role);
  const out = new Set<Relationship>();
  // The lesson's own tutor, through the tutor record the TUTOR role stands on (an administrator who teaches counts, as the tutor).
  if (holds("TUTOR") && actor.tutorId !== null && actor.tutorId === lesson.tutorId) out.add("tutor");
  // A junior tutor assigned to this lesson: may read it, may not send in it. (A person who is also the lesson's full tutor is the tutor.)
  else if (holds("JUNIOR_TUTOR") && actor.tutorId !== null && actor.tutorId === lesson.tutorId) out.add("junior_tutor");
  if (holds("STUDENT") && actor.studentId !== null && lesson.studentIds.includes(actor.studentId)) out.add("student");
  if (holds("CLIENT") && actor.clientId !== null && lesson.clientIds.includes(actor.clientId)) out.add("parent");
  if (holds("ADMIN")) out.add("admin");
  if (actor.isSafeguardingLead) out.add("safeguarding_lead");
  return out;
}

export type SendRefusal =
  | "LESSON_NOT_FOUND"
  | "NOT_PARTICIPANT"
  | "JUNIOR_TUTOR_CANNOT_SEND"
  | "LESSON_CANCELLED"
  | "LESSON_NOT_SCHEDULED";

export type SendDecision = { ok: true; party: ChatParty } | { ok: false; code: SendRefusal; message: string };

const REFUSAL_TEXT: Record<SendRefusal, string> = {
  LESSON_NOT_FOUND: "There is no such lesson.",
  NOT_PARTICIPANT: "You are not part of this lesson, so you cannot message in it.",
  JUNIOR_TUTOR_CANNOT_SEND: "Junior tutors cannot send messages or files yet.",
  LESSON_CANCELLED: "This lesson was cancelled, so there is no chat.",
  LESSON_NOT_SCHEDULED: "This lesson has no scheduled time, so there is no chat.",
};

const refuse = (code: SendRefusal): SendDecision => ({ ok: false, code, message: REFUSAL_TEXT[code] });

/** The lesson's scheduled time. Null if the lesson has no usable schedule. */
export function lessonWindow(lesson: Pick<ChatLesson, "startAt" | "durationMinutes">): { start: number; end: number } | null {
  const start = Date.parse(lesson.startAt);
  if (!Number.isFinite(start) || !Number.isFinite(lesson.durationMinutes) || lesson.durationMinutes <= 0) return null;
  return { start, end: start + lesson.durationMinutes * 60_000 };
}

/**
 * May this person send a message or a file in this lesson? In this order, so a refusal never reveals more than the person may know: their
 * relationship to the lesson first, then whether it can have a chat at all (cancelled, unscheduled).
 *
 * The lesson's own tutor, a student enrolled in it and any administrator may send AT ANY TIME, before, during or after the lesson, so that somebody
 * running late or unable to come can say so. A cancelled or no-show lesson has no chat. A junior tutor cannot send at all for now:
 * TODO(supervision) when the supervision rules exist (a tutor overseeing a junior's messages), decide here what a junior may send and who sees it.
 * Parents and the safeguarding lead only read. An administrator who is not the lesson's tutor or student sends AS AN ADMINISTRATOR, so the tutor
 * and the students always know who is speaking.
 */
export function canSend(lesson: ChatLesson | null, actor: ChatActor): SendDecision {
  if (!lesson) return refuse("LESSON_NOT_FOUND");
  const relations = relationshipsOf(lesson, actor);
  const party: ChatParty | null = relations.has("tutor") ? "tutor" : relations.has("student") ? "student" : relations.has("admin") ? "admin" : null;
  if (party === null) return refuse(relations.has("junior_tutor") ? "JUNIOR_TUTOR_CANNOT_SEND" : "NOT_PARTICIPANT");
  if (lesson.status === "CANCELLED" || lesson.status === "NO_SHOW") return refuse("LESSON_CANCELLED");
  if (lessonWindow(lesson) === null) return refuse("LESSON_NOT_SCHEDULED");
  return { ok: true, party };
}

export type ReadRefusal = "LESSON_NOT_FOUND" | "NOT_ALLOWED" | "NOT_YET";
export type ReadDecision =
  | {
      ok: true;
      /** "participant": the lesson's own tutor, junior tutor or a student on it. Otherwise how the access is recorded in the audit log. */
      kind: "participant" | AccessorKind;
      /** Must this read be written to the audit log? Everyone but the lesson's own participants. */
      audited: boolean;
      /** May they see a removed message's original content (an administrator, the safeguarding lead). */
      seesRemoved: boolean;
    }
  | { ok: false; code: ReadRefusal; message: string };

/**
 * May this person read this lesson's messages and files? The lesson's tutor, its junior tutor and its students may. A parent may read their OWN
 * child's lessons, read-only and only AFTERWARDS (once the scheduled end has passed). Administrators and the safeguarding lead may read, and
 * every one of those reads is audited. Nobody else.
 */
export function canRead(lesson: ChatLesson | null, actor: ChatActor, now: Date): ReadDecision {
  if (!lesson) return { ok: false, code: "LESSON_NOT_FOUND", message: REFUSAL_TEXT.LESSON_NOT_FOUND };
  const relations = relationshipsOf(lesson, actor);
  if (relations.has("tutor") || relations.has("junior_tutor") || relations.has("student")) return { ok: true, kind: "participant", audited: false, seesRemoved: relations.has("admin") || relations.has("safeguarding_lead") };
  if (relations.has("admin")) return { ok: true, kind: "admin", audited: true, seesRemoved: true };
  if (relations.has("safeguarding_lead")) return { ok: true, kind: "safeguarding_lead", audited: true, seesRemoved: true };
  if (relations.has("parent")) {
    const window = lessonWindow(lesson);
    if (window === null || now.getTime() < window.end) return { ok: false, code: "NOT_YET", message: "You can read your child's lesson messages once the lesson has finished." };
    return { ok: true, kind: "parent", audited: true, seesRemoved: false };
  }
  return { ok: false, code: "NOT_ALLOWED", message: "You do not have access to this lesson's messages." };
}

/** Only an administrator removes a message. Nobody edits or deletes one, the sender included. */
export const canRemove = (actor: ChatActor): boolean => actor.roles.includes("ADMIN");
