import { accountRuntime } from "@/lib/account/runtime";
import { fakeSubscription, FakeStripeApi } from "@/lib/billing/devStripe";
import { stripeApi } from "@/lib/billing/runtime";
import { jsonResponse } from "@/lib/request-guards";

export const dynamic = "force-dynamic";

/**
 * DEVELOPMENT AND TESTS ONLY (STRIPE_FAKE=1): sets what the fake Stripe will answer, so a browser test can play Stripe.
 *
 *   { "action": "subscription", "email": "...", "id": "sub_x", "status": "active", "interval": "month",
 *     "periodEndDays": 30, "cancelAtPeriodEnd": false, "endedAtDays": null }
 *   { "action": "invoice", "id": "in_x", "subscription": "sub_x" }
 *
 * The test then POSTs a correctly signed event to the real /api/billing/webhook route. A 404 in production twice over: the
 * proxy refuses /api/dev/**, and this refuses to run with NODE_ENV=production or without the fake.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return jsonResponse(404, { error: "Not found." });
  const rt = await accountRuntime();
  const api = stripeApi();
  if (!rt?.memory || !(api instanceof FakeStripeApi)) return jsonResponse(404, { error: "Not found." });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  if (body?.action === "subscription") {
    const userId = (rt.auth as { userIdFor?: (email: string) => string | null }).userIdFor?.(String(body.email ?? "").trim().toLowerCase());
    if (!userId) return jsonResponse(404, { error: "No such account." });
    const clientId = await rt.store.accounts.ensureClient(userId);
    const id = String(body.id ?? "sub_devfake1");
    const now = Date.now();
    const days = (n: unknown) => (typeof n === "number" ? Math.floor((now + n * 86_400_000) / 1000) : null);
    api.subscriptions.set(
      id,
      fakeSubscription({
        id,
        customer: `cus_${id.slice(4)}`,
        clientId,
        status: typeof body.status === "string" ? body.status : "active",
        interval: body.interval === "year" ? "year" : "month",
        periodEnd: days(body.periodEndDays ?? 30) ?? undefined,
        cancelAtPeriodEnd: body.cancelAtPeriodEnd === true,
        endedAt: days(body.endedAtDays),
        canceledAt: body.cancelAtPeriodEnd === true ? Math.floor(now / 1000) : null,
      }),
    );
    return jsonResponse(200, { clientId, customer: `cus_${id.slice(4)}` });
  }
  if (body?.action === "invoice") {
    api.invoices.set(String(body.id), { id: String(body.id), subscription: String(body.subscription) });
    return jsonResponse(200, { ok: true });
  }
  return jsonResponse(400, { error: "Unknown action." });
}
