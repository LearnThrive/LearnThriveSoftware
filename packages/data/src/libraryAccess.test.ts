import assert from "node:assert/strict";
import { test } from "node:test";
import { canAccess, destinationFor, homePath, platformAccess, type AccessFacts, type AccessTier, type AccountRole } from "./library";

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

// ── One sign-in, three kinds of person: platformAccess, homePath, destinationFor ────────────────────────────────────────────────

const facts = (over: Partial<AccessFacts>): AccessFacts => ({ ...none, ...over });
const open = { studyBuddyOpen: true };
const closed = { studyBuddyOpen: false };

test("platformAccess: an enrolled family has everything, a subscriber only the Library and LearnThrive AI, nobody else anything", () => {
  assert.deepEqual(platformAccess("CLIENT", facts({ enrolled: true })), { tier: "enrolled", dashboard: true, library: true, studyBuddy: true });
  // A learner's own login (migration 0010): the household being enrolled gives the Library and LearnThrive AI, but THEIR lessons need THEIR enrolment.
  assert.deepEqual(platformAccess("STUDENT", facts({ enrolled: true })), { tier: "library", dashboard: false, library: true, studyBuddy: true });
  assert.deepEqual(platformAccess("STUDENT", facts({ enrolled: true, ownTuition: true })), { tier: "enrolled", dashboard: true, library: true, studyBuddy: true });
  assert.deepEqual(platformAccess("STUDENT", facts({ ownTuition: true })), { tier: "enrolled", dashboard: true, library: true, studyBuddy: true });
  assert.deepEqual(platformAccess("STUDENT", facts({ subscription: true })), { tier: "library", dashboard: false, library: true, studyBuddy: true });
  assert.deepEqual(platformAccess("STUDENT", none), { tier: "none", dashboard: false, library: false, studyBuddy: false });
  assert.equal(platformAccess("CLIENT", facts({ ownTuition: true })).dashboard, false, "ownTuition is only ever read for a learner");
  assert.deepEqual(platformAccess("CLIENT", facts({ subscription: true })), { tier: "library", dashboard: false, library: true, studyBuddy: true });
  assert.deepEqual(platformAccess("CLIENT", facts({ adminGrant: true })), { tier: "library", dashboard: false, library: true, studyBuddy: true });
  assert.deepEqual(platformAccess("CLIENT", none), { tier: "none", dashboard: false, library: false, studyBuddy: false });
});

test("platformAccess: enrolment beats a subscription (an enrolled family that also subscribes has everything, once)", () => {
  assert.equal(platformAccess("CLIENT", facts({ enrolled: true, subscription: true, adminGrant: true })).tier, "enrolled");
});

test("platformAccess: the dashboard never follows from a subscription or a grant alone, for any role that is not staff", () => {
  for (const role of ["CLIENT", "STUDENT"] as const)
    for (const f of [facts({ subscription: true }), facts({ adminGrant: true }), facts({ subscription: true, adminGrant: true })])
      assert.equal(platformAccess(role, f).dashboard, false, `${role} ${JSON.stringify(f)}`);
});

test("platformAccess: staff always reach the dashboard; an administrator also holds the whole Library, a tutor only what the facts give", () => {
  assert.deepEqual(platformAccess("ADMIN", none), { tier: "staff", dashboard: true, library: true, studyBuddy: true });
  assert.deepEqual(platformAccess("TUTOR", none), { tier: "staff", dashboard: true, library: false, studyBuddy: false });
  assert.deepEqual(platformAccess("TUTOR", facts({ subscription: true })), { tier: "staff", dashboard: true, library: true, studyBuddy: true });
});

test("platformAccess agrees with canAccess for members content, for every role and every combination of facts", () => {
  const published = { accessTier: "members" as const, publishedAt: past };
  for (const role of ["ADMIN", "TUTOR", "CLIENT", "STUDENT"] as const)
    for (const enrolled of [false, true])
      for (const subscription of [false, true])
        for (const adminGrant of [false, true]) {
          const f = { enrolled, subscription, adminGrant };
          assert.equal(platformAccess(role, f).library, canAccess({ role }, published, f, now).allowed, `${role} ${JSON.stringify(f)}`);
        }
});

test("homePath: the dashboard for staff and enrolled, LearnThrive AI for subscribers (the Library when it is closed), the account page for the rest", () => {
  assert.equal(homePath(platformAccess("CLIENT", facts({ enrolled: true })), open), "/dashboard");
  assert.equal(homePath(platformAccess("ADMIN", none), closed), "/dashboard");
  assert.equal(homePath(platformAccess("CLIENT", facts({ subscription: true })), open), "/library/study-buddy");
  assert.equal(homePath(platformAccess("CLIENT", facts({ subscription: true })), closed), "/library");
  assert.equal(homePath(platformAccess("CLIENT", none), open), "/account");
});

test("destinationFor: a page the person asked for is kept when their access includes it, and replaced by their home when it does not", () => {
  const member = platformAccess("CLIENT", facts({ subscription: true }));
  const enrolled = platformAccess("CLIENT", facts({ enrolled: true }));
  const nobody = platformAccess("CLIENT", none);
  // The dashboard is closed to a subscriber, whatever page of it was asked for.
  assert.equal(destinationFor(member, "/dashboard", open), "/library/study-buddy");
  assert.equal(destinationFor(member, "/dashboard/lessons/abc?x=1", open), "/library/study-buddy");
  assert.equal(destinationFor(member, "/dashboardx", open), "/dashboardx", "a different path that merely starts with the same letters is not the dashboard");
  assert.equal(destinationFor(enrolled, "/dashboard/lessons/abc", open), "/dashboard/lessons/abc");
  // LearnThrive AI is closed to someone with no entitlement.
  assert.equal(destinationFor(nobody, "/library/study-buddy", open), "/account");
  assert.equal(destinationFor(member, "/library/study-buddy", open), "/library/study-buddy");
  // Pages open to every signed-in person are kept.
  assert.equal(destinationFor(nobody, "/account/billing", open), "/account/billing");
  assert.equal(destinationFor(member, "/library/search?q=maths", open), "/library/search?q=maths");
});

test("destinationFor: nothing asked for, or the login page itself, or something that is not a path on this site, goes home", () => {
  const enrolled = platformAccess("CLIENT", facts({ enrolled: true }));
  for (const asked of [null, undefined, "", "/login", "https://example.com/", "dashboard"]) assert.equal(destinationFor(enrolled, asked, open), "/dashboard", String(asked));
});

test("a closed signed-in app (production before the portal opens) is nobody's home or destination: enrolled families land on what is open", () => {
  const enrolled = platformAccess("CLIENT", facts({ enrolled: true }));
  const shut = { studyBuddyOpen: true, dashboardOpen: false };
  assert.equal(homePath(enrolled, shut), "/library/study-buddy");
  assert.equal(homePath(enrolled, { studyBuddyOpen: false, dashboardOpen: false }), "/library");
  assert.equal(destinationFor(enrolled, "/dashboard/lessons", shut), "/library/study-buddy");
  assert.equal(destinationFor(enrolled, "/library/search", shut), "/library/search");
  // Staff with no Library right and a closed app have nowhere but their account.
  assert.equal(homePath(platformAccess("TUTOR", none), shut), "/account");
  // Omitting the flag means the app is open.
  assert.equal(homePath(enrolled, { studyBuddyOpen: true }), "/dashboard");
});
