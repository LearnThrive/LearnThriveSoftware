import assert from "node:assert/strict";
import { test } from "node:test";
import { canAccess, type AccessFacts, type AccessTier, type AccountRole } from "./library";

const now = new Date("2026-10-20T12:00:00Z");
const past = new Date("2026-10-01T00:00:00Z");
const future = new Date("2026-11-01T00:00:00Z");
const none: AccessFacts = { enrolled: false, subscription: false, adminGrant: false };

const decide = (role: AccountRole, tier: AccessTier, publishedAt: Date | null, facts: Partial<AccessFacts>) =>
  canAccess({ role }, { accessTier: tier, publishedAt }, { ...none, ...facts }, now);

test("a free sample is open to any signed-in account, entitled or not", () => {
  assert.deepEqual(decide("CLIENT", "free_sample", past, {}), { allowed: true, reason: "free_sample" });
});

test("members content: every combination of enrolled, subscribed and granted", () => {
  for (const enrolled of [false, true])
    for (const subscription of [false, true])
      for (const adminGrant of [false, true]) {
        const d = decide("CLIENT", "members", past, { enrolled, subscription, adminGrant });
        const any = enrolled || subscription || adminGrant;
        assert.equal(d.allowed, any, JSON.stringify({ enrolled, subscription, adminGrant }));
        assert.equal(d.reason, enrolled ? "enrolled" : subscription ? "subscription" : adminGrant ? "admin_grant" : "no_entitlement");
      }
});

test("nothing held means no members access (expired and refunded subscriptions arrive as subscription:false)", () => {
  assert.deepEqual(decide("CLIENT", "members", past, none), { allowed: false, reason: "no_entitlement" });
});

test("a draft or scheduled resource is closed to everyone but an administrator, even a free sample, even when entitled", () => {
  const all = { enrolled: true, subscription: true, adminGrant: true };
  for (const tier of ["free_sample", "members"] as const) {
    assert.deepEqual(decide("CLIENT", tier, null, all), { allowed: false, reason: "unpublished" });
    assert.deepEqual(decide("CLIENT", tier, future, all), { allowed: false, reason: "unpublished" });
    assert.deepEqual(decide("ADMIN", tier, null, none), { allowed: true, reason: "admin" });
  }
});

test("roles other than ADMIN get no special treatment", () => {
  for (const role of ["TUTOR", "STUDENT", "CLIENT"] as const) assert.equal(decide(role, "members", past, none).allowed, false);
});

test("a resource published exactly now is open", () => {
  assert.equal(decide("CLIENT", "free_sample", now, {}).allowed, true);
});
