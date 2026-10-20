import { createHash } from "node:crypto";
import type { LibraryPrices } from "@/lib/library-config";

/**
 * The words a customer sees before paying (plan19 phase E, consumer law built in from day one): the price and whether
 * it includes VAT, the billing period and automatic renewal, how to cancel, the refunds policy, and the express
 * acknowledgement that digital content starts at once and the 14-day right to cancel is lost once access begins.
 *
 * DRAFT WORDING FOR LEGAL REVIEW (apps/web/LEGAL_REVIEW.md, "Library accounts and billing"). Not final: the owners and a
 * solicitor must approve it, and the subscription terms and content licence it points to must exist, before any
 * production sign-up. A change to ACKNOWLEDGEMENT must bump CONSENT_VERSION: the version and a hash of the exact text
 * are recorded each time someone ticks the box.
 */
export const CONSENT_KIND = "digital_content_waiver";
export const CONSENT_VERSION = "2026-10-draft-1";

/** Shown beside the unticked box. The route refuses a checkout without it. */
export const ACKNOWLEDGEMENT = "I ask for access to start now, and I understand I lose my 14-day right to cancel once access begins.";

/** Shown above the box. */
export const COOLING_OFF_DRAFT =
  "You normally have 14 days to change your mind. The Library is digital content that starts straight away, so once you are given access you lose your right to cancel within those 14 days.";

export const consentHash = (): string => createHash("sha256").update(`${CONSENT_VERSION}\n${COOLING_OFF_DRAFT}\n${ACKNOWLEDGEMENT}`).digest("hex");

export type VatStatus = "registered" | "not_registered";

export function priceLine(price: string, period: "month" | "year", vat: VatStatus): string {
  return `${price} per ${period}${vat === "registered" ? ", including VAT" : ". No VAT is charged"}.`;
}

/** The bullet list under the price on the live card: everything that must be clear before the button. */
export function checkoutDisclosures(prices: LibraryPrices, period: "month" | "year", vat: VatStatus): string[] {
  const price = period === "month" ? prices.monthly : prices.annual;
  return [
    price ? `You pay ${priceLine(price, period, vat)}` : "",
    `You pay when you subscribe, and again every ${period} on the same date until you cancel. The subscription renews automatically.`,
    "You can cancel at any time, online, from your account (Manage billing). It then runs to the end of the period you have paid for. There is nothing to phone or write.",
    "We will email you before each renewal.",
    "Refunds: contact us within 14 days of paying and tell us why; we decide each request fairly and in line with your legal rights.",
  ].filter(Boolean);
}
