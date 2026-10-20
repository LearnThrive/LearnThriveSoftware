#!/usr/bin/env node
/**
 * Billing reconciliation (plan19 phase E): re-sync the database's mirror of Stripe, and every entitlement derived from it.
 *
 *   npm run billing:reconcile                      dry run: reads Stripe and the database, writes nothing, reports
 *   npm run billing:reconcile -- --apply           brings the mirror into line and recomputes every entitlement
 *   npm run billing:reconcile -- --mark-refunded sub_XXXX   ends access for one subscription whose full refund the
 *                                                  webhook could not trace (see docs/BILLING.md)
 *
 * Stripe is the source of truth: nothing here changes Stripe. A subscription for a customer this site has no account for
 * is reported, never created. A mirrored subscription Stripe no longer lists is reported and left alone.
 *
 * Settings come from the environment and are never printed: STRIPE_SECRET_KEY, DATABASE_URL (and STRIPE_API_VERSION if the
 * server pins one). Do a test-mode run against the staging project first.
 */
import { SqlLibraryStore } from "@learnthrive/data/library";
import { stripeConfig } from "../src/lib/billing/config.ts";
import { markRefunded, reconcile } from "../src/lib/billing/reconcile.ts";
import { HttpStripeApi } from "../src/lib/billing/stripe.ts";
import { createExecutor } from "../src/lib/db.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const refundAt = args.indexOf("--mark-refunded");
const refundId = refundAt >= 0 ? args[refundAt + 1] : undefined;

function usage(message) {
  if (message) console.error(`${message}\n`);
  console.error("Usage: npm run billing:reconcile [-- --apply | --mark-refunded sub_XXXX]");
  process.exit(message ? 2 : 0);
}
if (args.includes("--help") || args.includes("-h")) usage();
if (refundAt >= 0 && !/^sub_[A-Za-z0-9]+$/.test(refundId ?? "")) usage("--mark-refunded needs a Stripe subscription id (sub_...).");

const env = process.env;
if (!env.DATABASE_URL?.trim()) usage("DATABASE_URL is required.");
const config = stripeConfig({ ...env, STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET ?? "whsec_unusedunusedunused" });
if (refundAt < 0 && !config) usage("STRIPE_SECRET_KEY is required (a sk_test_ or sk_live_ key, or a restricted rk_ key).");

const { executor, close } = await createExecutor(env.DATABASE_URL.trim());
const store = new SqlLibraryStore(executor);
const now = () => new Date();

try {
  if (refundAt >= 0) {
    const ok = await markRefunded({ store, now }, refundId);
    console.log(ok ? `Marked ${refundId} refunded: access ended.` : `No mirrored subscription ${refundId}.`);
    process.exitCode = ok ? 0 : 1;
  } else {
    console.log(`Mode: Stripe ${config.mode}. ${apply ? "APPLYING changes." : "Dry run: nothing will be written."}`);
    const report = await reconcile({ store, stripe: new HttpStripeApi(config), now }, { apply });
    console.log(`Stripe lists ${report.seenAtStripe} subscription(s): ${report.unchanged} already match.`);
    for (const c of report.changed) console.log(`${apply ? "updated" : "would update"}  ${c.id}  (${c.why})`);
    for (const id of report.unresolved) console.log(`unresolved   ${id}  (a customer this site has no account for; not created)`);
    for (const id of report.unreadable) console.log(`unreadable   ${id}`);
    for (const id of report.missingAtStripe) console.log(`missing      ${id}  (mirrored here, not listed by Stripe; left alone)`);
    if (apply) console.log(`Entitlements recomputed for ${report.resynced} subscription(s).`);
    else if (report.changed.length > 0) console.log("\nRun again with --apply to bring the database into line.");
  }
} finally {
  await close();
}
