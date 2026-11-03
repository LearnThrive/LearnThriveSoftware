import { asString, cleanLine, isPlainEmail } from "@/lib/forms-common";

/**
 * People sign in with a username, not an email address (docs/AUTHENTICATION.md): young children have no email, and LearnThrive makes every
 * account. Supabase Auth still requires an address, so each username has a fixed internal one built from it. That address only ever goes
 * to Auth: nothing is sent to it, and the browser never sees it. Where a person can really be reached is the account's linked email.
 *
 * Deriving the address means signing in needs no database lookup, so an unknown username takes the same path as a known one.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
/** Used for nothing else. It must accept no mail: see docs/AUTHENTICATION.md for the DNS record and the check on the real stack. */
export const INTERNAL_EMAIL_DOMAIN = "accounts.learnthrivetuition.co.uk";

const USERNAME_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/** Names that would read as the company speaking. Compared after lower-casing, so "Admin" is refused too. */
const RESERVED = new Set([
  "abuse", "admin", "administrator", "billing", "help", "info", "learnthrive", "learnthrive-tuition", "moderator", "no-reply", "noreply", "owner",
  "postmaster", "root", "safeguarding", "security", "staff", "student", "support", "system", "teacher", "tutor", "webmaster",
]);

/** What a person typed, as it is stored: one line, lower case. */
export function parseUsername(raw: unknown): string {
  return cleanLine(asString(raw)).toLowerCase();
}

/** Whether this could be a username at all: all that signing in needs to know. */
export function usernameFormatError(username: string): string | undefined {
  if (!username) return "Enter a username.";
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) return `Use ${USERNAME_MIN} to ${USERNAME_MAX} characters.`;
  if (!USERNAME_PATTERN.test(username)) return "Use lower-case letters and digits, with single dots, dashes or underscores between them.";
  return undefined;
}

/** Whether this may be given to a new account. */
export function usernameError(username: string): string | undefined {
  return usernameFormatError(username) ?? (RESERVED.has(username) ? "That username is reserved. Choose another." : undefined);
}

export function internalEmailFor(username: string): string {
  return `${username}@${INTERNAL_EMAIL_DOMAIN}`;
}

export function isInternalEmail(address: string): boolean {
  return address.toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);
}

/**
 * The Auth address for what someone typed at sign-in, or null if it cannot be a login. An email address is accepted only away from
 * production, for accounts from the public sign-up, which exists only on a local server and in tests (lib/account/selfService.ts).
 */
export function signInAddress(identifier: string, env: Record<string, string | undefined> = process.env): string | null {
  if (!usernameFormatError(identifier)) return internalEmailFor(identifier);
  return env.NODE_ENV !== "production" && isPlainEmail(identifier) ? identifier : null;
}
