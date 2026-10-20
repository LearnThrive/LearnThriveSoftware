import { createHash } from "node:crypto";
import type { AccountRuntime } from "./runtime";
import type { AuthTokens, AuthUser } from "./types";

/**
 * The account session: two httpOnly cookies, nothing readable by scripts, nothing in browser storage.
 *
 *   learnthrive_acct    the access token (short lived, about an hour)
 *   learnthrive_acct_r  the refresh token
 *
 * Both are SESSION cookies (no Max-Age, so the browser drops them on close): "remember me" is out of scope (plan19
 * section 3). httpOnly, SameSite=Lax, Secure in production, Path=/. They are strictly necessary and are set only
 * after a person signs in or opens an emailed link; the public marketing pages set no cookie.
 *
 * A Server Component cannot set cookies, so an expired access token is renewed by a tiny route
 * (/api/account/refresh) that pages redirect through; route handlers renew in place.
 */
export const ACCESS_COOKIE = "learnthrive_acct";
export const REFRESH_COOKIE = "learnthrive_acct_r";

export interface CookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
}

export interface CookieJar {
  get(name: string): string | undefined;
  set(name: string, value: string, options: CookieOptions): void;
  delete(name: string): void;
}

function options(env: Record<string, string | undefined>): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/" };
}

export function setSessionCookies(jar: CookieJar, tokens: AuthTokens, env: Record<string, string | undefined> = process.env): void {
  jar.set(ACCESS_COOKIE, tokens.accessToken, options(env));
  jar.set(REFRESH_COOKIE, tokens.refreshToken, options(env));
}

export function clearSessionCookies(jar: CookieJar): void {
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

// A short cache so one page view does not ask the auth server several times. Keyed by a hash, never the token.
const CACHE_MS = 30_000;
const verified = new Map<string, { user: AuthUser; until: number }>();
const key = (token: string) => createHash("sha256").update(token).digest("hex");

export function forgetAccessToken(token: string): void {
  verified.delete(key(token));
}

export function resetSessionCache(): void {
  verified.clear();
}

async function userFor(rt: AccountRuntime, token: string, now: number): Promise<AuthUser | null> {
  const k = key(token);
  const hit = verified.get(k);
  if (hit && hit.until > now) return hit.user;
  verified.delete(k);
  const user = await rt.auth.getUser(token);
  if (user) {
    verified.set(k, { user, until: now + CACHE_MS });
    if (verified.size > 2000) for (const [oldKey, v] of verified) if (v.until <= now) verified.delete(oldKey);
  }
  return user;
}

export type SessionState =
  | { status: "ok"; user: AuthUser }
  /** The access token is missing or expired but a refresh token exists: renew, then try again. */
  | { status: "refresh_needed" }
  | { status: "none" };

/** Reads the session without changing any cookie. */
export async function readSession(jar: CookieJar, rt: AccountRuntime, now: number = Date.now()): Promise<SessionState> {
  const access = jar.get(ACCESS_COOKIE);
  if (access) {
    const user = await userFor(rt, access, now);
    if (user) return { status: "ok", user };
  }
  return jar.get(REFRESH_COOKIE) ? { status: "refresh_needed" } : { status: "none" };
}

/**
 * For route handlers, which can set cookies: renews an expired access token, or clears a dead session. A refresh
 * token is single use, so two overlapping requests can race; the loser simply signs in again.
 */
export async function renewSession(jar: CookieJar, rt: AccountRuntime, now: number = Date.now()): Promise<SessionState> {
  const state = await readSession(jar, rt, now);
  if (state.status !== "refresh_needed") return state;
  const refreshToken = jar.get(REFRESH_COOKIE)!;
  const tokens = await rt.auth.refresh(refreshToken);
  if (!tokens) {
    clearSessionCookies(jar);
    return { status: "none" };
  }
  setSessionCookies(jar, tokens);
  const user = await userFor(rt, tokens.accessToken, now);
  return user ? { status: "ok", user } : { status: "none" };
}

/** Only a path on this site: starts with one slash, not two, no backslash, no scheme. Used for `next`. */
export function safeNextPath(raw: string | null | undefined, fallback = "/account"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f]/.test(raw)) return fallback;
  return raw;
}
