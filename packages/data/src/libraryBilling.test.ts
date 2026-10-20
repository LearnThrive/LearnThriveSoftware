import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIVE_GRACE_MS, deriveEntitlement, SUBSCRIPTION_STATUSES, type SubscriptionRecord } from "./library";

const now = new Date("2026-10-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const ahead = (days: number) => new Date(now.getTime() + days * DAY);

type Probe = Pick<SubscriptionRecord, "status" | "currentPeriodEnd" | "endedAt" | "refundedAt" | "createdAt">;
const sub = (over: Partial<Probe>): Probe => ({ status: "active", currentPeriodEnd: ahead(10), endedAt: null, refundedAt: null, createdAt: ago(20), ...over });
const open = (probe: Probe, at: Date = now) => {
  const w = deriveEntitlement(probe, at);
  return w !== null && w.startsAt <= at && (w.endsAt === null || w.endsAt > at);
};

test("every status, with the paid period still ahead: who gets access", () => {
  const expected: Record<string, boolean> = { active: true, trialing: true, past_due: true, canceled: false, unpaid: false, incomplete: false, incomplete_expired: false, paused: false };
  assert.deepEqual(Object.keys(expected).sort(), [...SUBSCRIPTION_STATUSES].sort(), "every status is covered");
  for (const status of SUBSCRIPTION_STATUSES) {
    // `canceled` is only open until Stripe's end date, which is absent here, so it falls back to the paid-through date.
    const probe = sub({ status, endedAt: status === "canceled" ? ago(1) : null });
    assert.equal(open(probe), expected[status], status);
  }
});

test("active and trialing: paid-through plus the grace, then closed (webhooks that stop do not keep access open for ever)", () => {
  for (const status of ["active", "trialing"] as const) {
    const end = ago(1);
    const w = deriveEntitlement(sub({ status, currentPeriodEnd: end }), now)!;
    assert.equal(w.endsAt!.getTime(), end.getTime() + ACTIVE_GRACE_MS);
    assert.equal(open(sub({ status, currentPeriodEnd: end })), true, "a day late: still open (a late renewal webhook)");
    assert.equal(open(sub({ status, currentPeriodEnd: ago(4) })), false, "four days late: closed");
    assert.equal(open(sub({ status, currentPeriodEnd: ago(4) }), ago(2)), true, "and it was open when that date was still current");
  }
  assert.equal(deriveEntitlement(sub({ status: "active", currentPeriodEnd: null }), now)!.endsAt!.getTime(), now.getTime() + ACTIVE_GRACE_MS);
});

test("past due: only the period already paid for, no grace", () => {
  assert.equal(open(sub({ status: "past_due", currentPeriodEnd: ahead(2) })), true);
  assert.equal(open(sub({ status: "past_due", currentPeriodEnd: ago(1) })), false);
  assert.equal(deriveEntitlement(sub({ status: "past_due", currentPeriodEnd: null }), now), null);
});

test("cancelled: until Stripe ended it (the end of the paid period, or at once), never longer", () => {
  assert.equal(open(sub({ status: "canceled", currentPeriodEnd: ahead(5), endedAt: ahead(5) })), true, "cancelled at period end: the rest of the paid period");
  assert.equal(open(sub({ status: "canceled", currentPeriodEnd: ahead(5), endedAt: ago(0.01) })), false, "cancelled now: closed now, though the period was paid");
  assert.equal(open(sub({ status: "canceled", currentPeriodEnd: ahead(5), endedAt: null })), true, "no end date: the paid-through date");
  assert.equal(deriveEntitlement(sub({ status: "canceled", currentPeriodEnd: null, endedAt: null }), now), null);
});

test("a refund removes access whatever the status, for every status", () => {
  for (const status of SUBSCRIPTION_STATUSES) assert.equal(deriveEntitlement(sub({ status, refundedAt: ago(1) }), now), null, status);
});

test("a window never ends before it starts", () => {
  const w = deriveEntitlement(sub({ status: "canceled", createdAt: now, endedAt: ago(5) }), now)!;
  assert.ok(w.startsAt < w.endsAt!);
  assert.equal(open(sub({ status: "canceled", createdAt: now, endedAt: ago(5) })), false);
});
