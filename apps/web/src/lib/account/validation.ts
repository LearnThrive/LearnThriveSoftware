import { asBoolean, asString, cleanLine, isPlainEmail } from "@/lib/forms-common";

/**
 * What the account routes accept. Pure; the forms use the same limits only to save a round trip, the routes repeat
 * every check. The password is never trimmed or normalised (spaces are allowed), only length-bounded.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const EMAIL_MAX = 160;
export const NAME_MAX = 80;

export interface AccountErrors {
  email?: string;
  password?: string;
  confirmAdult?: string;
  displayName?: string;
}

export function parseEmail(raw: unknown): string {
  return cleanLine(asString(raw)).toLowerCase();
}

export function emailError(email: string): string | undefined {
  if (!email) return "Enter your email address.";
  if (email.length > EMAIL_MAX || !isPlainEmail(email)) return "Enter a valid email address.";
  return undefined;
}

export function passwordError(password: string): string | undefined {
  if (password.length < PASSWORD_MIN) return `Choose a password of at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use a password of at most ${PASSWORD_MAX} characters.`;
  return undefined;
}

export interface SignUpFields {
  email: string;
  password: string;
  displayName: string;
  confirmAdult: boolean;
}

export function parseSignUp(raw: unknown): SignUpFields {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { email: parseEmail(r.email), password: asString(r.password), displayName: cleanLine(asString(r.displayName)).slice(0, NAME_MAX), confirmAdult: asBoolean(r.confirmAdult) };
}

export function validateSignUp(f: SignUpFields): AccountErrors {
  const e: AccountErrors = {};
  const email = emailError(f.email);
  if (email) e.email = email;
  const password = passwordError(f.password);
  if (password) e.password = password;
  if (!f.confirmAdult) e.confirmAdult = "Confirm that you are 18 or over to create an account.";
  return e;
}

export function parseSignIn(raw: unknown): { email: string; password: string } {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return { email: parseEmail(r.email), password: asString(r.password) };
}

/** A token_hash from an email link: opaque, URL-safe, bounded. Anything else is rejected before it reaches the provider. */
export function parseTokenHash(raw: unknown): string | null {
  const value = asString(raw).trim();
  return /^[A-Za-z0-9_-]{8,200}$/.test(value) ? value : null;
}
