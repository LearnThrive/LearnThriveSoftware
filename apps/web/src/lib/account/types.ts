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
export type SignInFailure = "invalid_credentials" | "email_not_confirmed" | "unavailable";
export type TokenFailure = "invalid_token" | "unavailable";

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
  /** The adult (18 or over) declaration. The caller refuses to get here without it. */
  adultConfirmed: true;
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
}
