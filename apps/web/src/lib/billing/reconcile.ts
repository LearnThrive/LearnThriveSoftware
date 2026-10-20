import type { LibraryStore, SubscriptionInput } from "@learnthrive/data/library";
import { clientHint, customerOf, toSubscriptionInput } from "./mapper";
import type { StripeApi } from "./stripe";

/**
 * Re-syncs the mirror (and every entitlement derived from it) from Stripe, the source of truth (plan19 phase E). The
 * webhook keeps it right from minute to minute; this is the safety net for a webhook that was down, a bad deploy, or a
 * change made in the Stripe dashboard that no event reached. Run it after an outage, and now and then. scripts/billing-
 * reconcile.mjs wires it to the command line; it is a dry run unless told to apply.
 *
 *   - Every Stripe subscription is read. One for a customer or client this site does not know is reported, never created.
 *   - A mirrored subscription that differs from Stripe is brought into line (apply) or listed (dry run).
 *   - Every mirrored subscription's entitlement is recomputed (apply), which also closes any whose window has run out.
 *   - A mirrored subscription Stripe no longer lists is reported and left alone: deleting access on a missing record is a
 *     decision for a person.
 */
export interface ReconcileReport {
  seenAtStripe: number;
  unchanged: number;
  /** Stripe ids that were new to the mirror or differed from it. */
  changed: Array<{ id: string; why: string }>;
  /** Stripe ids for a customer this site has no account for. */
  unresolved: string[];
  unreadable: string[];
  /** Mirrored subscriptions Stripe did not list. */
  missingAtStripe: string[];
  resynced: number;
}

const time = (date: Date | null) => (date ? date.getTime() : null);

function differences(have: SubscriptionInput, want: SubscriptionInput): string[] {
  const out: string[] = [];
  if (have.status !== want.status) out.push(`status ${have.status} -> ${want.status}`);
  if (have.stripePriceId !== want.stripePriceId) out.push("price");
  if (have.planInterval !== want.planInterval) out.push("interval");
  if (time(have.currentPeriodEnd) !== time(want.currentPeriodEnd)) out.push("period end");
  if (have.cancelAtPeriodEnd !== want.cancelAtPeriodEnd) out.push("cancel at period end");
  if (time(have.endedAt) !== time(want.endedAt)) out.push("ended at");
  return out;
}

export async function reconcile(deps: { store: LibraryStore; stripe: StripeApi; now: () => Date }, options: { apply: boolean }): Promise<ReconcileReport> {
  const report: ReconcileReport = { seenAtStripe: 0, unchanged: 0, changed: [], unresolved: [], unreadable: [], missingAtStripe: [], resynced: 0 };
  const seen = new Set<string>();
  let after: string | undefined;
  for (;;) {
    const page = await deps.stripe.listSubscriptions(after);
    for (const raw of page.data) {
      const id = typeof raw.id === "string" ? raw.id : "(no id)";
      report.seenAtStripe += 1;
      const input = toSubscriptionInput(raw);
      if (!input) {
        report.unreadable.push(id);
        continue;
      }
      seen.add(input.stripeSubscriptionId);
      let clientId = (customerOf(raw) && (await deps.store.billing.getClientByStripeCustomer(customerOf(raw)!))) || null;
      const hint = clientHint(raw);
      if (!clientId && hint && (await deps.store.accounts.getOwnerProfileId(hint))) {
        clientId = hint;
        if (options.apply && customerOf(raw)) await deps.store.billing.linkCustomer(hint, customerOf(raw)!).catch(() => undefined);
      }
      if (!clientId) {
        report.unresolved.push(input.stripeSubscriptionId);
        continue;
      }
      const existing = await deps.store.billing.getSubscriptionByStripeId(input.stripeSubscriptionId);
      const why = existing ? differences(existing, input) : ["not mirrored yet"];
      if (why.length === 0) report.unchanged += 1;
      else {
        report.changed.push({ id: input.stripeSubscriptionId, why: why.join(", ") });
        if (options.apply) await deps.store.billing.upsertSubscription(clientId, input);
      }
    }
    if (!page.hasMore || page.data.length === 0) break;
    const last = page.data[page.data.length - 1]!.id;
    if (typeof last !== "string") break;
    after = last;
  }

  for (const sub of await deps.store.billing.listAllSubscriptions()) {
    if (!seen.has(sub.stripeSubscriptionId)) report.missingAtStripe.push(sub.stripeSubscriptionId);
    if (options.apply) {
      const fresh = (await deps.store.billing.getSubscriptionByStripeId(sub.stripeSubscriptionId)) ?? sub;
      await deps.store.billing.syncEntitlement(fresh, deps.now());
      report.resynced += 1;
    }
  }
  return report;
}

/** For a refund the webhook could not trace (docs/BILLING.md): ends access for one subscription at once. */
export async function markRefunded(deps: { store: LibraryStore; now: () => Date }, stripeSubscriptionId: string): Promise<boolean> {
  const sub = await deps.store.billing.getSubscriptionByStripeId(stripeSubscriptionId);
  if (!sub) return false;
  await deps.store.billing.markRefunded(stripeSubscriptionId, deps.now());
  await deps.store.billing.syncEntitlement(sub, deps.now());
  return true;
}
