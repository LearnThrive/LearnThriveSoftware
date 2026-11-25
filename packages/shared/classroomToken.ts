import { createHmac, timingSafeEqual } from "node:crypto";
import type { ParticipantRole, StaffTitle } from "./protocol";

// The trust boundary between the platform (apps/web, which knows about accounts, Lessons, and
// who's actually allowed to join which one) and the classroom (apps/realtime/apps/classroom,
// which has no concept of platform identity at all — see plan section 37: "Do not use obvious
// sequential lesson IDs as the sole access secret. Authentication/authorisation is what secures
// access."). apps/web signs a short-lived token after doing every check in plan section 34
// (logged in, assigned to the Lesson, Lesson online, within the join window, not cancelled);
// apps/realtime verifies it and uses ONLY the token's own name/role — never a client-declared
// one — for a token-authenticated join. See docs/CLASSROOM_INTEGRATION.md.
//
// Both sides need the same secret. In development, both fall back to the same hardcoded string
// if CLASSROOM_JOIN_SECRET isn't set in either app's .env — fine for a prototype, explicitly not
// how a real shared secret should be managed in production (a proper secrets manager, rotated,
// never defaulted). See docs/PRODUCTION_GAPS.md.
const DEV_FALLBACK_SECRET = "learnthrive-dev-only-classroom-join-secret-not-for-production";

// plan13.md task 11.2: the fallback above is checked into source, so it can never be a real secret
// once a production deployment exists to read this file. Fail closed rather than silently signing
// and accepting join tokens anyone could forge — a production process without the real secret set
// should refuse to run, not quietly degrade to a publicly-known one.
function secret(): string {
  const configured = process.env.CLASSROOM_JOIN_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CLASSROOM_JOIN_SECRET is not set. Refusing to sign/verify classroom join tokens with the " +
        "dev-only fallback secret in production — set CLASSROOM_JOIN_SECRET in both apps/web and " +
        "apps/realtime's environment.",
    );
  }
  return DEV_FALLBACK_SECRET;
}

export interface ClassroomJoinTokenPayload {
  roomId: string;
  lessonId: string;
  name: string;
  role: ParticipantRole;
  exp: number; // epoch ms
  /**
   * Who this is on the platform (the account id), set by apps/web when it signs the token. The classroom keeps it for the life of the socket
   * and sends it with each chat message, so apps/web can check the lesson chat rules (docs/LESSON_CHAT.md) against the real person, with their
   * roles and records looked up fresh, never from anything the browser sent. Optional so older tokens still verify.
   */
  uid?: string;
  /**
   * "meeting": a staff meeting, not a lesson. Its `lessonId` is only a label (the meeting's id). The room has no lesson chat to check, so its chat is a
   * plain, unsaved relay between the people in the room, who are all staff the web app has already let in. Absent for a lesson.
   */
  kind?: "meeting";
  /** A staff meeting only: the badge shown beside this person's name ("Admin" or "Tutor"), set by apps/web from their real roles. */
  title?: StaffTitle;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function signClassroomJoinToken(payload: ClassroomJoinTokenPayload): string {
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Returns the verified payload, or null for anything malformed, tampered with, or expired.
 * Never throws — a bad token should behave exactly like "no token", not crash the join flow. */
export function verifyClassroomJoinToken(token: string): ClassroomJoinTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, providedSig] = parts;
  const expectedSig = sign(body);
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ClassroomJoinTokenPayload>;
    if (
      typeof payload.roomId !== "string" || typeof payload.lessonId !== "string" ||
      typeof payload.name !== "string" || (payload.role !== "tutor" && payload.role !== "student" && payload.role !== "supervisor") ||
      typeof payload.exp !== "number"
    ) return null;
    if (payload.uid !== undefined && (typeof payload.uid !== "string" || payload.uid.length > 100)) return null;
    if (payload.kind !== undefined && payload.kind !== "meeting") return null;
    // A supervisor is an administrator watching a LESSON. A staff meeting has a host and guests and nothing else.
    if (payload.role === "supervisor" && payload.kind === "meeting") return null;
    if (payload.title !== undefined && payload.title !== "Admin" && payload.title !== "Tutor") return null;
    if (payload.exp < Date.now()) return null;
    return payload as ClassroomJoinTokenPayload;
  } catch {
    return null;
  }
}

// ---- apps/realtime -> apps/web service calls ---------------------------------------------------------------------------------------------
// The classroom server has no database. For the lesson chat it asks apps/web, which decides everything (who, when, which lesson). The request is
// signed with the same shared secret as the join token: HMAC over the timestamp and the exact body, so a captured request cannot be changed,
// and goes stale after a minute. See docs/LESSON_CHAT.md.

export const SERVICE_TIMESTAMP_HEADER = "x-learnthrive-timestamp";
export const SERVICE_SIGNATURE_HEADER = "x-learnthrive-signature";
const SERVICE_MAX_SKEW_MS = 60_000;

export function signServiceRequest(rawBody: string, timestamp: number): string {
  return sign(`service.${timestamp}.${rawBody}`);
}

/** True only for a fresh request whose signature matches this exact body. Never throws. */
export function verifyServiceRequest(rawBody: string, timestamp: unknown, signature: unknown, now: number = Date.now()): boolean {
  const ts = typeof timestamp === "string" ? Number(timestamp) : typeof timestamp === "number" ? timestamp : Number.NaN;
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SERVICE_MAX_SKEW_MS || typeof signature !== "string") return false;
  try {
    const expected = Buffer.from(signServiceRequest(rawBody, ts));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}
