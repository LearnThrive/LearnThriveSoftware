import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import type { AuthenticatedUser } from "./types";

export const SESSION_COOKIE_NAME = "learnthrive_session";

// Short-lived by default; "Remember me" extends this — see createSession(). Independent of
// the cookie's own maxAge below, since a server restart wipes this Map either way (see the
// globalThis singleton note) and both need to agree on when a session is actually still valid.
const DEFAULT_SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours
const REMEMBER_ME_SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface SessionRecord {
  user: AuthenticatedUser;
  expiresAt: number;
}

// Same Fast-Refresh-survival reasoning as devProvider.ts's user store.
const globalForSessions = globalThis as unknown as { __learnthriveSessions?: Map<string, SessionRecord> };
function sessionStore(): Map<string, SessionRecord> {
  if (!globalForSessions.__learnthriveSessions) globalForSessions.__learnthriveSessions = new Map();
  return globalForSessions.__learnthriveSessions;
}

export async function createSession(user: AuthenticatedUser, rememberMe: boolean): Promise<void> {
  const sessionId = randomUUID();
  const ttlMs = rememberMe ? REMEMBER_ME_SESSION_MS : DEFAULT_SESSION_MS;
  sessionStore().set(sessionId, { user, expiresAt: Date.now() + ttlMs });

  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Omitting maxAge for a non-remembered login makes it a real browser session cookie
    // (cleared when the browser closes) rather than a server-forgotten-but-cookie-still-there
    // 12-hour cookie the browser would keep offering back.
    ...(rememberMe ? { maxAge: Math.floor(ttlMs / 1000) } : {}),
  });
}

/** Reads and validates the session cookie against the server-side store — never trusts the
 * cookie's mere presence, and never trusts a client-supplied role/user id directly (see plan
 * section 10's explicit warning against `role=tutor` query-parameter "authentication"). */
export async function getSession(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionId) return null;
  const record = sessionStore().get(sessionId);
  if (!record) return null;
  if (record.expiresAt < Date.now()) {
    sessionStore().delete(sessionId);
    return null;
  }
  return record.user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE_NAME)?.value;
  if (sessionId) sessionStore().delete(sessionId);
  store.delete(SESSION_COOKIE_NAME);
}
