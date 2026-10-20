/**
 * Everything the public Library and pricing pages, and the Library waitlist, run on, in one place
 * (plan19 phase B2). Nothing here is personal data and nothing here is a secret.
 *
 * The pages are static: the phase and the prices are read when the site is built, so changing either one
 * means a new deploy. Nothing is invented. A price is shown only when the owner has set one, and until the
 * later phases exist (sign-in, downloads, billing) every phase other than `info` reads as `info`.
 *
 * Environment variables (documented in docs/DEPLOYMENT.md):
 *   LIBRARY_PHASE            info (the default), enrolled or live
 *   LIBRARY_PRICE_MONTHLY    pounds, for example 9.99 (shown as a price only if set and valid)
 *   LIBRARY_PRICE_ANNUAL     pounds, for example 99 or 99.00
 *   LIBRARY_WAITLIST_EMAIL   where waitlist sign-ups go (then ENQUIRY_EMAIL, then the site's own address)
 */

type Env = Record<string, string | undefined>;

export type LibraryPhase = "info" | "enrolled" | "live";

const PHASES: readonly LibraryPhase[] = ["info", "enrolled", "live"];

/** LIBRARY_PHASE. Anything missing or unrecognised is `info`, the safe reading. */
export function libraryPhase(env: Env = process.env): LibraryPhase {
  const value = env.LIBRARY_PHASE?.trim().toLowerCase();
  return PHASES.find((phase) => phase === value) ?? "info";
}

/**
 * What the pages and the waitlist may honestly show for the phase. Only `info` exists so far: the waitlist is
 * open, nothing can be bought and nothing can be signed in to. The later phases (D: enrolled access, E:
 * billing) turn the other two on as they are built, and update this function and its test with them.
 */
export function libraryShows(phase: LibraryPhase = libraryPhase()): { comingSoon: boolean; waitlist: boolean } {
  void phase;
  return { comingSoon: true, waitlist: true };
}

export interface LibraryPrices {
  /** Display text such as "£9.99", or null when the owner has not set (or has mis-typed) a price. */
  monthly: string | null;
  annual: string | null;
}

/** A price typed as pounds, "9.99" or "100": at most four digits (no leading zero) and optional two decimals, above zero. */
function displayPrice(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text || !/^(?:[1-9]\d{0,3}|0)(\.\d{2})?$/.test(text)) return null;
  return Number(text) > 0 ? `£${text}` : null;
}

export function libraryPrices(env: Env = process.env): LibraryPrices {
  return { monthly: displayPrice(env.LIBRARY_PRICE_MONTHLY), annual: displayPrice(env.LIBRARY_PRICE_ANNUAL) };
}

/** The line shown in place of a price until the owner has set one. */
export const PRICE_ANNOUNCED_AT_LAUNCH = "Price announced at launch";

export const libraryConfig = {
  waitlist: {
    /** Per visitor address and for the whole route, as for the other forms (see lib/rate-limit.ts). */
    rateLimits: { perClient: { max: 5, windowMs: 15 * 60 * 1000 }, global: { max: 150, windowMs: 60 * 60 * 1000 } },
    /** The least time a person plausibly needs for a one-field form. A script is faster. Production only. */
    minFillMs: 2_500,
    /** Months a sign-up is kept in the mailbox if no launch email has gone out by then. OWNER TO CONFIRM. */
    retentionMonths: 12,
    emailMaxLength: 160,
  },
} as const;
