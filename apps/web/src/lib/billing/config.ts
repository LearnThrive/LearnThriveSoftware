import type { VatStatus } from "./consumer";

type Env = Record<string, string | undefined>;

/**
 * Stripe and checkout settings, all from the environment, none in the repo, none ever logged (plan19 phase E).
 * Prices live in Stripe: the code reads Stripe price IDs, never an amount. Checkout fails CLOSED: any missing piece, and
 * it is simply not offered (the pricing card stays "coming soon", the route answers 503).
 *
 *   STRIPE_SECRET_KEY         sk_test_... or sk_live_... (a restricted key, rk_..., works if it may create sessions
 *                             and read subscriptions, invoices and customers)
 *   STRIPE_WEBHOOK_SECRET     whsec_... for the /api/billing/webhook endpoint (comma-separate two while rotating)
 *   STRIPE_PRICE_MONTHLY      price_... of the monthly recurring price (GBP)
 *   STRIPE_PRICE_ANNUAL       price_... of the annual recurring price (GBP)
 *   STRIPE_API_VERSION        optional; the Stripe API version the server's calls use
 *   STRIPE_AUTOMATIC_TAX      "true" asks Stripe to calculate tax at checkout (needs Stripe Tax set up)
 *   LIBRARY_TERMS_APPROVED     "true" once the owners and a solicitor have approved the subscription terms, the content licence
 *                             and the checkout wording (consumer.ts). Until then checkout is not offered
 *   LIBRARY_VAT_STATUS        "registered" (the prices include VAT) or "not_registered". REQUIRED, set by the owner
 *                             once the accountant has confirmed the treatment: no default is safe
 *   LIBRARY_MIN_PER_SUBJECT   whole number: the least published resources each required subject must have first
 *   LIBRARY_REQUIRED_SUBJECTS comma-separated subject names as they appear on resources, for example Maths,English
 *   LIBRARY_PRICE_MONTHLY / LIBRARY_PRICE_ANNUAL   display text of the same prices, "9.99" (lib/library-config.ts)
 */
export const DEFAULT_STRIPE_API_VERSION = "2025-09-30.clover";

export type StripeMode = "test" | "live";

export interface BillingConfig {
  secretKey: string;
  mode: StripeMode;
  webhookSecrets: string[];
  prices: { month: string | null; year: string | null };
  apiVersion: string;
  automaticTax: boolean;
}

const KEY = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]{8,}$/;
const PRICE = /^price_[A-Za-z0-9]+$/;
const SECRET = /^whsec_[A-Za-z0-9+/=_-]{8,}$/;

const pick = (value: string | undefined) => value?.trim() || undefined;

/** What the webhook needs: the key (to read the truth back from Stripe) and the signing secret. */
export function stripeConfig(env: Env = process.env): BillingConfig | null {
  const key = pick(env.STRIPE_SECRET_KEY);
  const match = key ? KEY.exec(key) : null;
  const secrets = (env.STRIPE_WEBHOOK_SECRET ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!key || !match || secrets.length === 0 || secrets.some((s) => !SECRET.test(s))) return null;
  const month = pick(env.STRIPE_PRICE_MONTHLY);
  const year = pick(env.STRIPE_PRICE_ANNUAL);
  return {
    secretKey: key,
    mode: match[1] === "live" ? "live" : "test",
    webhookSecrets: secrets,
    prices: { month: month && PRICE.test(month) ? month : null, year: year && PRICE.test(year) ? year : null },
    apiVersion: pick(env.STRIPE_API_VERSION) ?? DEFAULT_STRIPE_API_VERSION,
    automaticTax: pick(env.STRIPE_AUTOMATIC_TAX) === "true",
  };
}

export function vatStatus(env: Env = process.env): VatStatus | null {
  const value = pick(env.LIBRARY_VAT_STATUS)?.toLowerCase();
  return value === "registered" || value === "not_registered" ? value : null;
}

export interface Readiness {
  /** null = no gate configured, which closes checkout. */
  minPerSubject: number | null;
  subjects: string[];
}

export function readinessConfig(env: Env = process.env): Readiness {
  const n = Number(pick(env.LIBRARY_MIN_PER_SUBJECT));
  return {
    minPerSubject: Number.isInteger(n) && n >= 1 ? n : null,
    subjects: (env.LIBRARY_REQUIRED_SUBJECTS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

/** The owners and a solicitor have approved the Library terms, the licence and the checkout wording. */
export function termsApproved(env: Env = process.env): boolean {
  return pick(env.LIBRARY_TERMS_APPROVED) === "true";
}

export type Unavailable = "phase" | "stripe" | "price" | "vat" | "gate" | "legal";

/**
 * Whether paid sign-up may be offered at all, and if not, the first thing that is missing. The content gate's counts
 * are checked separately, against the catalogue (`contentReady`).
 */
export function checkoutConfigured(phase: string, env: Env = process.env): { ok: true; config: BillingConfig; vat: VatStatus; gate: Readiness } | { ok: false; reason: Unavailable } {
  if (phase !== "live") return { ok: false, reason: "phase" };
  const config = stripeConfig(env);
  if (!config) return { ok: false, reason: "stripe" };
  if (!config.prices.month && !config.prices.year) return { ok: false, reason: "price" };
  const vat = vatStatus(env);
  if (!vat) return { ok: false, reason: "vat" };
  const gate = readinessConfig(env);
  if (gate.minPerSubject === null || gate.subjects.length === 0) return { ok: false, reason: "gate" };
  if (!termsApproved(env)) return { ok: false, reason: "legal" };
  return { ok: true, config, vat, gate };
}

/** The content gate: every required subject has at least the agreed number of published resources. */
export function contentReady(gate: Readiness, subjectCounts: ReadonlyArray<{ value: string; count: number }>): { ok: boolean; short: Array<{ subject: string; have: number; need: number }> } {
  const need = gate.minPerSubject ?? Number.POSITIVE_INFINITY;
  const short = gate.subjects.map((subject) => ({ subject, have: subjectCounts.find((c) => c.value === subject)?.count ?? 0, need })).filter((s) => s.have < s.need);
  return { ok: gate.minPerSubject !== null && gate.subjects.length > 0 && short.length === 0, short };
}
