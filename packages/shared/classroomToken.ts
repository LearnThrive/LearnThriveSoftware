import { createHmac, timingSafeEqual } from "node:crypto";
import type { ParticipantRole } from "./protocol";

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

function secret(): string {
  return process.env.CLASSROOM_JOIN_SECRET || DEV_FALLBACK_SECRET;
}

export interface ClassroomJoinTokenPayload {
  roomId: string;
  lessonId: string;
  name: string;
  role: ParticipantRole;
  exp: number; // epoch ms
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
      typeof payload.name !== "string" || (payload.role !== "tutor" && payload.role !== "student") ||
      typeof payload.exp !== "number"
    ) return null;
    if (payload.exp < Date.now()) return null;
    return payload as ClassroomJoinTokenPayload;
  } catch {
    return null;
  }
}
