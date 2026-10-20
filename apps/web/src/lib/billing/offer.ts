import type { LibraryStore } from "@learnthrive/data/library";
import { libraryPhase, libraryPrices, type LibraryPhase, type LibraryPrices } from "@/lib/library-config";
import { checkoutConfigured, contentReady, type Unavailable } from "./config";
import type { VatStatus } from "./consumer";

type Env = Record<string, string | undefined>;

/**
 * Whether the site may offer a paid subscription right now, for the pages (the routes check the same things again).
 * Everything has to be true: the phase is `live`, Stripe is configured with a price for the plan, the VAT treatment has
 * been set, the content threshold is set AND met by what is actually published, and the plan has a price to show. If any
 * piece is missing the pages behave as the `enrolled` phase (no payment form, "subscription coming soon"): live never
 * overrides what is not ready.
 */
export type Offer =
  | { open: true; vat: VatStatus; prices: LibraryPrices; plans: Array<{ plan: "monthly" | "annual"; period: "month" | "year"; price: string }> }
  | { open: false; reason: Unavailable | "content" | "display_price" };

export async function subscriptionOffer(store: LibraryStore | null, env: Env = process.env): Promise<Offer> {
  const phase = libraryPhase(env);
  const configured = checkoutConfigured(phase, env);
  if (!configured.ok) return { open: false, reason: configured.reason };
  if (!store) return { open: false, reason: "stripe" };
  const counts = (await store.resources.facets()).subjects;
  if (!contentReady(configured.gate, counts).ok) return { open: false, reason: "content" };
  const prices = libraryPrices(env);
  const plans: Array<{ plan: "monthly" | "annual"; period: "month" | "year"; price: string }> = [];
  if (configured.config.prices.month && prices.monthly) plans.push({ plan: "monthly", period: "month", price: prices.monthly });
  if (configured.config.prices.year && prices.annual) plans.push({ plan: "annual", period: "year", price: prices.annual });
  if (plans.length === 0) return { open: false, reason: "display_price" };
  return { open: true, vat: configured.vat, prices, plans };
}

/** The phase the pages should behave as: `live` only when the offer really is open, otherwise `enrolled`. */
export function effectivePhase(phase: LibraryPhase, offer: Offer): LibraryPhase {
  return phase === "live" && !offer.open ? "enrolled" : phase;
}
