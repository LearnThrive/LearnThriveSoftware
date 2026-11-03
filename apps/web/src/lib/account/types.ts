/**
 * The account sign-in layer for the Library (plan19 phase C). It sits beside the development auth in lib/auth, not
 * inside it: that one is a fixed set of seeded accounts that refuses to run in production, this one is real sign-up
 * with email verification. Both are reached only through small interfaces, so the dev accounts still work locally.
 *
 * `AccountAuth` is the boundary. Two implementations: Supabase Auth (production, over its REST API) and an
 * in-memory one (local development and tests). Everything above the interface (routes, cookies, lockout) is shared.
 */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds when the access token stops being valid. */
  expiresAt: number;
}

export type SignUpFailure = "weak_password" | "invalid_email" | "unavailable";
export type SignInFailure = "invalid_credentials" | "email_not_confirmed" | "account_disabled" | "unavailable";
export type TokenFailure = "invalid_token" | "unavailable";

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
  /**
   * The adult (18 or over) declaration. true for the ordinary sign-up, which refuses to get here without it. false only for a learner's
   * sign-up from a guardian's invitation: the account is made without the declaration, never marked as an adult, and can do nothing
   * until the invitation binds it to the student (docs/IDENTITY.md).
   */
  adultConfirmed: boolean;
}

/** The kinds of link an email can carry. Both are one use. */
export type EmailLinkKind = "signup" | "recovery";

export interface AccountAuth {
  /**
   * Creates the account and sends the verification email. Always `ok` when the address is well formed and the
   * password is strong enough, whether or not the address was already registered: the answer never reveals which.
   */
  signUp(input: SignUpInput): Promise<{ ok: true } | { ok: false; reason: SignUpFailure }>;
  signIn(email: string, password: string): Promise<{ ok: true; user: AuthUser; tokens: AuthTokens } | { ok: false; reason: SignInFailure }>;
  /** Spends a one-use emailed link. A `recovery` link also signs the person in, so they can choose a new password. */
  verifyEmailLink(tokenHash: string, kind: EmailLinkKind): Promise<{ ok: true; user: AuthUser; tokens: AuthTokens } | { ok: false; reason: TokenFailure }>;
  /** Sends a reset email if the address has an account. Always `ok`: the answer never reveals which. */
  requestPasswordReset(email: string): Promise<{ ok: true } | { ok: false; reason: "unavailable" }>;
  /** Sends the verification email again. Always `ok`, for the same reason. */
  resendVerification(email: string): Promise<{ ok: true } | { ok: false; reason: "unavailable" }>;
  updatePassword(accessToken: string, newPassword: string): Promise<{ ok: true } | { ok: false; reason: "weak_password" | "invalid_token" | "unavailable" }>;
  getUser(accessToken: string): Promise<AuthUser | null>;
  refresh(refreshToken: string): Promise<AuthTokens | null>;
  /** Ends the session everywhere it is held. Never throws. */
  signOut(accessToken: string): Promise<void>;
  /** Ends every session of this person but the one holding this token, after a password change. Never throws. */
  signOutOthers(accessToken: string): Promise<void>;
}

export type AdminCreateFailure = "exists" | "weak_password" | "unavailable";

export interface AdminCreateInput {
  /** The internal address built from the username (username.ts). Never mailed. */
  email: string;
  password: string;
  displayName: string;
  adultConfirmed: boolean;
}

/**
 * What only an administrator's server-side call may do, over Supabase's Auth Admin API with the secret key: nothing here is reachable from a
 * browser. A login made here is confirmed from the start, because nobody ever opens a link at its internal address.
 */
export interface AccountAdmin {
  createUser(input: AdminCreateInput): Promise<{ ok: true; id: string } | { ok: false; reason: AdminCreateFailure }>;
  /** Sets a temporary password and ends every session of that person. */
  setPassword(userId: string, password: string): Promise<{ ok: true } | { ok: false; reason: "weak_password" | "unavailable" }>;
  /** A one-time recovery token for this internal address, sending nothing: the site emails the linked address itself. */
  recoveryLink(email: string): Promise<{ tokenHash: string } | null>;
  setDisabled(userId: string, disabled: boolean): Promise<boolean>;
  /** Removes a login that could not be bound to its record. */
  deleteUser(userId: string): Promise<boolean>;
}
