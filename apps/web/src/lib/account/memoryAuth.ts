import { createHash, randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "@/lib/auth/passwords";
import { passwordError } from "./validation";
import type { AccountAuth, AuthTokens, AuthUser, EmailLinkKind, SignUpInput } from "./types";

/**
 * The in-memory AccountAuth: local development and tests only (runtime.ts refuses it in production). It enforces the
 * same rules Supabase Auth does for this site: the email must be verified before sign-in, links are one use and
 * expire, a wrong password and an unknown address look the same, and sign-up never reveals whether an address is
 * already registered. "Emails" land in `outbox` instead of being sent.
 */
export interface OutboxMessage {
  to: string;
  kind: EmailLinkKind;
  /** The token_hash the real email would carry in its link. Development only: never logged. */
  tokenHash: string;
  at: number;
}

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  confirmed: boolean;
}

const ACCESS_MS = 60 * 60 * 1000;
const LINK_MS = 60 * 60 * 1000;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

export interface MemoryAuthOptions {
  now?: () => number;
  /** Called once per new account, so the Library store can hold the matching profile. */
  onUserCreated?: (user: { id: string; displayName: string }) => void;
}

export class MemoryAccountAuth implements AccountAuth {
  readonly outbox: OutboxMessage[] = [];
  private readonly users = new Map<string, UserRow>(); // by email
  private readonly byId = new Map<string, UserRow>();
  private readonly links = new Map<string, { userId: string; kind: EmailLinkKind; expiresAt: number }>();
  private readonly access = new Map<string, { userId: string; expiresAt: number }>();
  private readonly refreshTokens = new Map<string, string>(); // refresh token -> userId
  private readonly now: () => number;
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly options: MemoryAuthOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  private publicUser(row: UserRow): AuthUser {
    return { id: row.id, email: row.email, displayName: row.displayName };
  }

  private issueLink(row: UserRow, kind: EmailLinkKind): void {
    const tokenHash = randomBytes(24).toString("base64url");
    this.links.set(tokenHash, { userId: row.id, kind, expiresAt: this.now() + LINK_MS });
    this.outbox.push({ to: row.email, kind, tokenHash, at: this.now() });
  }

  private issueTokens(row: UserRow): AuthTokens {
    const accessToken = `at_${randomBytes(24).toString("base64url")}`;
    const refreshToken = `rt_${randomBytes(24).toString("base64url")}`;
    const expiresAt = this.now() + ACCESS_MS;
    this.access.set(sha(accessToken), { userId: row.id, expiresAt });
    this.refreshTokens.set(sha(refreshToken), row.id);
    return { accessToken, refreshToken, expiresAt };
  }

  async signUp(input: SignUpInput) {
    if (!input.email.includes("@")) return { ok: false as const, reason: "invalid_email" as const };
    if (passwordError(input.password)) return { ok: false as const, reason: "weak_password" as const };
    const existing = this.users.get(input.email);
    if (existing) {
      // Same answer as a new address. An unconfirmed account gets a fresh link; a confirmed one gets nothing.
      if (!existing.confirmed) this.issueLink(existing, "signup");
      return { ok: true as const };
    }
    const row: UserRow = { id: crypto.randomUUID(), email: input.email, displayName: input.displayName, passwordHash: await hashPassword(input.password), confirmed: false };
    this.users.set(row.email, row);
    this.byId.set(row.id, row);
    this.options.onUserCreated?.({ id: row.id, displayName: row.displayName });
    this.issueLink(row, "signup");
    return { ok: true as const };
  }

  async signIn(email: string, password: string) {
    const row = this.users.get(email);
    // Always do one password check, so an unknown address takes as long as a wrong password.
    this.dummyHash ??= hashPassword("not-a-real-password");
    const correct = await verifyPassword(password, row ? row.passwordHash : await this.dummyHash);
    if (!row || !correct) return { ok: false as const, reason: "invalid_credentials" as const };
    if (!row.confirmed) return { ok: false as const, reason: "email_not_confirmed" as const };
    return { ok: true as const, user: this.publicUser(row), tokens: this.issueTokens(row) };
  }

  async verifyEmailLink(tokenHash: string, kind: EmailLinkKind) {
    const link = this.links.get(tokenHash);
    this.links.delete(tokenHash); // one use, even if it turns out to be the wrong kind or expired
    if (!link || link.kind !== kind || link.expiresAt < this.now()) return { ok: false as const, reason: "invalid_token" as const };
    const row = this.byId.get(link.userId);
    if (!row) return { ok: false as const, reason: "invalid_token" as const };
    row.confirmed = true; // a recovery link proves control of the address too
    return { ok: true as const, user: this.publicUser(row), tokens: this.issueTokens(row) };
  }

  async requestPasswordReset(email: string) {
    const row = this.users.get(email);
    if (row) this.issueLink(row, "recovery");
    return { ok: true as const };
  }

  async resendVerification(email: string) {
    const row = this.users.get(email);
    if (row && !row.confirmed) this.issueLink(row, "signup");
    return { ok: true as const };
  }

  async updatePassword(accessToken: string, newPassword: string) {
    const user = await this.getUser(accessToken);
    if (!user) return { ok: false as const, reason: "invalid_token" as const };
    if (passwordError(newPassword)) return { ok: false as const, reason: "weak_password" as const };
    const row = this.byId.get(user.id)!;
    row.passwordHash = await hashPassword(newPassword);
    // Changing the password ends every other session, as Supabase does on request; keep this one.
    const keep = sha(accessToken);
    for (const [key, session] of this.access) if (session.userId === row.id && key !== keep) this.access.delete(key);
    for (const [key, userId] of this.refreshTokens) if (userId === row.id) this.refreshTokens.delete(key);
    return { ok: true as const };
  }

  async getUser(accessToken: string): Promise<AuthUser | null> {
    const session = this.access.get(sha(accessToken));
    if (!session || session.expiresAt < this.now()) return null;
    const row = this.byId.get(session.userId);
    return row ? this.publicUser(row) : null;
  }

  async refresh(refreshToken: string): Promise<AuthTokens | null> {
    const key = sha(refreshToken);
    const userId = this.refreshTokens.get(key);
    if (!userId) return null;
    this.refreshTokens.delete(key); // rotated: a refresh token is used once
    const row = this.byId.get(userId);
    return row ? this.issueTokens(row) : null;
  }

  async signOut(accessToken: string): Promise<void> {
    const session = this.access.get(sha(accessToken));
    if (!session) return;
    for (const [key, s] of this.access) if (s.userId === session.userId) this.access.delete(key);
    for (const [key, userId] of this.refreshTokens) if (userId === session.userId) this.refreshTokens.delete(key);
  }
}
