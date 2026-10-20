/**
 * Everything the public Library and pricing pages, and the Library waitlist, run on, in one place
 * (plan19 phase B2). Nothing here is personal data and nothing here is a secret.
 *
 * /pricing is static: its phase and prices are read when the site is built, so changing either means a new
 * deploy. /library is rendered per request (the catalogue follows the address bar), so it reads the phase then.
 * Nothing is invented. A price is shown only when the owner has set one, and until billing exists (phase E)
 * `live` reads as `enrolled`.
 *
 * Environment variables (documented in docs/DEPLOYMENT.md):
 *   LIBRARY_PHASE            info (the default), enrolled or live
 *   LIBRARY_PRICE_MONTHLY    pounds, for example 9.99 (shown as a price only if set and valid)
 *   LIBRARY_PRICE_ANNUAL     pounds, for example 99 or 99.00
 *   LIBRARY_WAITLIST_EMAIL   where waitlist sign-ups go (then ENQUIRY_EMAIL, then the site's own address)
 *   LIBRARY_DOWNLOADS_PER_HOUR   downloads one family account may make in an hour (default 60)
 */

type Env = Record<string, string | undefined>;

export type LibraryPhase = "info" | "enrolled" | "live";

const PHASES: readonly LibraryPhase[] = ["info", "enrolled", "live"];

/**
 * LIBRARY_ENABLED=true opens the account and Library routes in production (see `decide` in lib/portal.ts). A server
 * variable read per request, never NEXT_PUBLIC. Anything other than exactly `true` is closed.
 */
export function libraryEnabled(env: Env = process.env): boolean {
  return env.LIBRARY_ENABLED?.trim() === "true";
}

/** LIBRARY_DOWNLOADS_PER_HOUR: a whole number from 1 to 1000; anything else is the default of 60. */
export function downloadsPerHour(env: Env = process.env): number {
  const n = Number(env.LIBRARY_DOWNLOADS_PER_HOUR?.trim());
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 60;
}

/** LIBRARY_PHASE. Anything missing or unrecognised is `info`, the safe reading. */
export function libraryPhase(env: Env = process.env): LibraryPhase {
  const value = env.LIBRARY_PHASE?.trim().toLowerCase();
  return PHASES.find((phase) => phase === value) ?? "info";
}

/**
 * What the pages and the waitlist may honestly show for the phase.
 *
 *   info      the default: nothing can be signed in to, bought or downloaded. The waitlist is open.
 *   enrolled  phase D: the catalogue is open and enrolled students (and everyone, for free samples) can sign in and
 *             download. A subscription for everyone else is still "coming soon", so the waitlist stays open.
 *   live      phase E: subscriptions are open (checkout, the customer portal) and the waitlist closes. A page must pass
 *             the phase it is REALLY in, `effectivePhase()` in lib/billing/offer.ts: `live` without Stripe, a price, a
 *             VAT decision and the content threshold behaves as `enrolled`, because nothing may claim what is not ready.
 *
 * `comingSoon` is about subscriptions (what the waitlist is for), not about the catalogue.
 */
export function libraryShows(phase: LibraryPhase = libraryPhase()): { comingSoon: boolean; waitlist: boolean; catalogue: boolean } {
  if (phase === "live") return { comingSoon: false, waitlist: false, catalogue: true };
  return { comingSoon: true, waitlist: true, catalogue: phase === "enrolled" };
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
