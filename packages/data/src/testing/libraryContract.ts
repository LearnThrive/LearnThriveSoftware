/**
 * One behavioural contract for the Library store, run against the in-memory store (libraryMemory.test.ts) and the
 * Postgres store on PGlite (librarySql.test.ts). If the two ever disagree, a test here fails for one of them.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AccountRole, LibraryStore, ResourceInput, SubscriptionInput } from "../library";

export interface ContractHarness {
  store: LibraryStore;
  profile(options?: { role?: AccountRole; adult?: boolean }): Promise<string>;
  student(profileId: string): Promise<string>;
  assignment(studentId: string, status?: "ACTIVE" | "PAUSED" | "ENDED"): Promise<void>;
  entitlement(profileId: string, source: "subscription" | "admin_grant", startsAt: Date, endsAt: Date | null): Promise<void>;
}

const HOUR = 3_600_000;
const SHA = "a".repeat(64);

function resource(overrides: Partial<ResourceInput> = {}): ResourceInput {
  return {
    slug: "quadratics-worksheet",
    title: "Quadratic equations worksheet",
    description: "Factorising and the formula, with worked answers.",
    subject: "Maths",
    level: "GCSE",
    examBoard: null,
    topic: "Algebra",
    resourceType: "worksheet",
    yearGroup: null,
    tags: ["algebra", "quadratics"],
    accessTier: "members",
    authorship: "LearnThrive Tuition",
    publishedAt: new Date(Date.now() - HOUR),
    ...overrides,
  };
}

export function libraryContract(name: string, make: () => Promise<{ harness: ContractHarness; close(): Promise<void> }>): void {
  describe(`library store contract: ${name}`, () => {
    let h: ContractHarness;
    let close: () => Promise<void>;
    let store: LibraryStore;

    test("setup", async () => {
      ({ harness: h, close } = await make());
      store = h.store;
    });

    test("accounts: a profile has no family account until one is ensured, and ensuring is idempotent", async () => {
      const id = await h.profile({ role: "CLIENT", adult: true });
      const before = await store.accounts.getAccount(id);
      assert.equal(before?.profileId, id);
      assert.equal(before?.role, "CLIENT");
      assert.equal(before?.adultConfirmed, true);
      assert.equal(before?.clientId, null);
      const a = await store.accounts.ensureClient(id);
      const b = await store.accounts.ensureClient(id);
      assert.equal(a, b);
      assert.equal((await store.accounts.getAccount(id))?.clientId, a);
      assert.equal(await store.accounts.getAccount("00000000-0000-4000-8000-000000000000"), null);
      await assert.rejects(() => store.accounts.ensureClient("00000000-0000-4000-8000-000000000000"));
    });

    test("accounts: the display name can be changed, and only for a profile that exists", async () => {
      const id = await h.profile();
      await store.accounts.updateDisplayName(id, "Pat Example");
      assert.equal((await store.accounts.getAccount(id))?.displayName, "Pat Example");
      await store.accounts.updateDisplayName(id, "");
      assert.equal((await store.accounts.getAccount(id))?.displayName, "");
      await assert.rejects(() => store.accounts.updateDisplayName("00000000-0000-4000-8000-000000000000", "Nobody"));
    });

    test("accounts: the adult declaration is read back", async () => {
      const id = await h.profile({ adult: false });
      assert.equal((await store.accounts.getAccount(id))?.adultConfirmed, false);
    });

    test("resources: upsert inserts, then updates by slug and keeps the id and version unless set", async () => {
      const first = await store.resources.upsert(resource());
      assert.equal(first.version, 1);
      const second = await store.resources.upsert(resource({ title: "Quadratics, revised" }));
      assert.equal(second.id, first.id);
      assert.equal(second.title, "Quadratics, revised");
      assert.equal(second.version, 1);
      const third = await store.resources.upsert(resource({ title: "Quadratics, revised", version: 2 }));
      assert.equal(third.version, 2);
    });

    test("resources: drafts and scheduled resources are invisible to public reads", async () => {
      const now = new Date();
      await store.resources.upsert(resource({ slug: "draft-one", title: "Draft only", publishedAt: null }));
      await store.resources.upsert(resource({ slug: "later-one", title: "Scheduled later", publishedAt: new Date(now.getTime() + HOUR) }));
      assert.equal(await store.resources.getBySlug("draft-one", now), null);
      assert.equal(await store.resources.getBySlug("later-one", now), null);
      assert.ok(await store.resources.getBySlug("later-one", new Date(now.getTime() + 2 * HOUR)), "visible once the date has passed");
      const page = await store.resources.list({}, now);
      assert.ok(!page.items.some((r) => r.slug === "draft-one" || r.slug === "later-one"));
      const draft = await store.resources.upsert(resource({ slug: "draft-one", title: "Draft only", publishedAt: null }));
      assert.equal((await store.resources.getById(draft.id))?.slug, "draft-one", "getById is for the server and does show drafts");
      assert.equal((await store.resources.findBySlug("draft-one"))?.id, draft.id, "so does findBySlug, for the import tool");
      assert.equal(await store.resources.findBySlug("no-such-slug"), null);
    });

    test("resources: filters, facets, paging and the clamp on limit", async () => {
      await store.resources.upsert(resource({ slug: "eng-1", title: "Persuasive writing", subject: "English", level: "KS3", topic: "Writing", resourceType: "notes", tags: ["writing"], accessTier: "free_sample", description: "Techniques." }));
      await store.resources.upsert(resource({ slug: "sci-1", title: "Cells and organs", subject: "Science", level: "GCSE", examBoard: "AQA", topic: "Biology", resourceType: "exam paper", tags: ["biology"], description: "Questions." }));
      assert.deepEqual((await store.resources.list({ subject: "English" })).items.map((r) => r.slug), ["eng-1"]);
      assert.deepEqual((await store.resources.list({ level: "GCSE", examBoard: "AQA" })).items.map((r) => r.slug), ["sci-1"]);
      assert.deepEqual((await store.resources.list({ tier: "free_sample" })).items.map((r) => r.slug), ["eng-1"]);
      assert.deepEqual((await store.resources.list({ resourceType: "exam paper" })).items.map((r) => r.slug), ["sci-1"]);
      assert.deepEqual((await store.resources.list({ topic: "Writing" })).items.map((r) => r.slug), ["eng-1"]);
      const all = await store.resources.list({});
      assert.equal(all.total, all.items.length);
      const paged = await store.resources.list({ limit: 1, offset: 1 });
      assert.equal(paged.items.length, 1);
      assert.equal(paged.total, all.total);
      assert.equal((await store.resources.list({ limit: 100000 })).items.length, all.total, "an oversized limit is clamped, not an error");
      const facets = await store.resources.facets();
      assert.ok(facets.subjects.some((f) => f.value === "English" && f.count === 1));
      assert.ok(facets.levels.some((f) => f.value === "KS3"));
      assert.ok(facets.examBoards.some((f) => f.value === "AQA"));
      assert.ok(!facets.subjects.some((f) => f.value === "Nothing"));
      assert.ok(facets.topics.some((f) => f.value === "Writing" && f.count === 1));
      const english = await store.resources.facets(new Date(), { subject: "English" });
      assert.deepEqual(english.subjects.map((f) => f.value), ["English"], "a scoped facet list holds only that subject");
      assert.ok(english.topics.every((f) => f.value === "Writing"));
      assert.ok(!english.levels.some((f) => f.value === "GCSE"));
    });

    test("resources: search matches every word, plurals, and ranks a title hit above a description hit", async () => {
      await store.resources.upsert(resource({ slug: "frac-title", title: "Fractions practice", subject: "Maths", level: "KS2", topic: "Number", tags: [], description: "Plain.", accessTier: "members" }));
      await store.resources.upsert(resource({ slug: "frac-desc", title: "Number revision", subject: "Maths", level: "KS2", topic: "Number", tags: [], description: "Includes fractions at the end.", accessTier: "members" }));
      const hit = await store.resources.list({ q: "fraction" });
      assert.deepEqual(hit.items.map((r) => r.slug), ["frac-title", "frac-desc"]);
      assert.equal(hit.total, 2);
      assert.equal((await store.resources.list({ q: "fractions biology" })).total, 0, "all words must match");
      assert.equal((await store.resources.list({ q: "zzzzqq" })).total, 0);
      assert.ok((await store.resources.list({ q: "   " })).total > 0, "a blank query is no query");
      // The query text is data, never SQL.
      assert.equal((await store.resources.list({ q: "'; drop table resources; --" })).total, 0);
      assert.ok((await store.resources.list({})).total > 0);
    });

    test("files: setFiles replaces the set and never leaks across resources", async () => {
      const one = await store.resources.upsert(resource({ slug: "files-one" }));
      const two = await store.resources.upsert(resource({ slug: "files-two" }));
      const set = await store.resources.setFiles(one.id, [{ storagePath: "files-one/v1/a.pdf", bytes: 1234, contentType: "application/pdf", checksumSha256: SHA }]);
      assert.equal(set.length, 1);
      assert.equal(set[0]!.resourceId, one.id);
      assert.equal(set[0]!.bytes, 1234);
      assert.deepEqual((await store.resources.files(two.id)), []);
      const replaced = await store.resources.setFiles(one.id, [{ storagePath: "files-one/v2/a.pdf", bytes: 99, contentType: "application/pdf", checksumSha256: SHA }]);
      assert.deepEqual((await store.resources.files(one.id)).map((f) => f.storagePath), ["files-one/v2/a.pdf"]);
      assert.equal(replaced.length, 1);
    });

    test("access facts: nothing, then enrolled, and only while an assignment is ACTIVE", async () => {
      const parent = await h.profile();
      const clientId = await store.accounts.ensureClient(parent);
      assert.deepEqual(await store.access.facts(clientId), { enrolled: false, subscription: false, adminGrant: false });
      const student = await h.student(parent);
      await h.assignment(student, "PAUSED");
      assert.equal((await store.access.facts(clientId)).enrolled, false);
      await h.assignment(student, "ENDED");
      assert.equal((await store.access.facts(clientId)).enrolled, false);
      await h.assignment(student, "ACTIVE");
      assert.equal((await store.access.facts(clientId)).enrolled, true);
    });

    test("access facts: another family's enrolment is not mine", async () => {
      const enrolled = await h.profile();
      const other = await h.profile();
      const otherClient = await store.accounts.ensureClient(other);
      await h.assignment(await h.student(enrolled), "ACTIVE");
      assert.equal((await store.access.facts(otherClient)).enrolled, false);
    });

    test("access facts: a subscription or grant counts only inside its window", async () => {
      const now = new Date();
      const p = await h.profile();
      const clientId = await store.accounts.ensureClient(p);
      await h.entitlement(p, "subscription", new Date(now.getTime() - 2 * HOUR), new Date(now.getTime() - HOUR));
      assert.equal((await store.access.facts(clientId, now)).subscription, false, "expired");
      await h.entitlement(p, "subscription", new Date(now.getTime() + 3 * HOUR), null);
      assert.equal((await store.access.facts(clientId, now)).subscription, false, "not started");
      await h.entitlement(p, "subscription", new Date(now.getTime() - HOUR), new Date(now.getTime() + HOUR));
      assert.equal((await store.access.facts(clientId, now)).subscription, true);
      assert.equal((await store.access.facts(clientId, new Date(now.getTime() + 2 * HOUR))).subscription, false, "ends");
      assert.equal((await store.access.facts(clientId, now)).adminGrant, false);
      await h.entitlement(p, "admin_grant", new Date(now.getTime() - HOUR), null);
      assert.equal((await store.access.facts(clientId, now)).adminGrant, true, "open ended");
    });

    test("downloads: counted per account and per window", async () => {
      const a = await store.accounts.ensureClient(await h.profile());
      const b = await store.accounts.ensureClient(await h.profile());
      const res = await store.resources.upsert(resource({ slug: "dl-1" }));
      const now = new Date();
      await store.downloads.record({ clientId: a, resourceId: res.id, at: new Date(now.getTime() - 30 * 60_000) });
      await store.downloads.record({ clientId: a, resourceId: res.id, at: new Date(now.getTime() - 2 * HOUR), flags: ["rapid_repeat"] });
      await store.downloads.record({ clientId: b, resourceId: res.id, at: now });
      assert.equal(await store.downloads.countSince(a, new Date(now.getTime() - HOUR)), 1);
      assert.equal(await store.downloads.countSince(a, new Date(now.getTime() - 3 * HOUR)), 2);
      assert.equal(await store.downloads.countSince(b, new Date(now.getTime() - HOUR)), 1);
      const other = await store.resources.upsert(resource({ slug: "dl-2" }));
      await store.downloads.record({ clientId: a, resourceId: other.id, at: new Date(now.getTime() - 60_000) });
      assert.equal(await store.downloads.countForResourceSince(a, res.id, new Date(now.getTime() - HOUR)), 1);
      assert.equal(await store.downloads.countForResourceSince(a, other.id, new Date(now.getTime() - HOUR)), 1);
      assert.equal(await store.downloads.countForResourceSince(b, other.id, new Date(now.getTime() - HOUR)), 0);
    });

    const sub = (id: string, over: Partial<SubscriptionInput> = {}): SubscriptionInput => ({
      stripeSubscriptionId: `sub_${id}`,
      stripePriceId: "price_monthly1",
      status: "active",
      planInterval: "month",
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * HOUR),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      endedAt: null,
      ...over,
    });

    test("billing: a Stripe customer is linked to one account and one account only", async () => {
      const a = await store.accounts.ensureClient(await h.profile());
      const b = await store.accounts.ensureClient(await h.profile());
      assert.equal(await store.billing.getStripeCustomerId(a), null);
      await store.billing.linkCustomer(a, "cus_AAA111");
      await store.billing.linkCustomer(a, "cus_AAA111");
      assert.equal(await store.billing.getStripeCustomerId(a), "cus_AAA111");
      assert.equal(await store.billing.getClientByStripeCustomer("cus_AAA111"), a);
      assert.equal(await store.billing.getClientByStripeCustomer("cus_unknown"), null);
      await assert.rejects(() => store.billing.linkCustomer(a, "cus_BBB222"), /different Stripe customer/);
      await assert.rejects(() => store.billing.linkCustomer(b, "cus_AAA111"), /another account/);
    });

    test("billing: subscriptions mirror Stripe, update in place, and never move between accounts", async () => {
      const a = await store.accounts.ensureClient(await h.profile());
      const b = await store.accounts.ensureClient(await h.profile());
      const first = await store.billing.upsertSubscription(a, sub("mirror1"));
      assert.equal(first.clientId, a);
      assert.equal(first.status, "active");
      assert.equal(first.refundedAt, null);
      assert.ok(first.createdAt instanceof Date);
      const periodEnd = new Date(Date.now() + 30 * 24 * HOUR);
      const second = await store.billing.upsertSubscription(a, sub("mirror1", { status: "past_due", cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd, canceledAt: new Date(), planInterval: "year" }));
      assert.equal(second.id, first.id);
      assert.equal(second.status, "past_due");
      assert.equal(second.cancelAtPeriodEnd, true);
      assert.equal(second.planInterval, "year");
      assert.equal(second.currentPeriodEnd?.getTime(), periodEnd.getTime());
      assert.ok(second.canceledAt);
      assert.deepEqual((await store.billing.getSubscriptionByStripeId("sub_mirror1"))?.id, first.id);
      assert.equal(await store.billing.getSubscriptionByStripeId("sub_nope"), null);
      await assert.rejects(() => store.billing.upsertSubscription(b, sub("mirror1")), /another account/);
      await store.billing.upsertSubscription(a, sub("mirror2"));
      assert.equal((await store.billing.listSubscriptions(a)).length, 2);
      assert.equal((await store.billing.listSubscriptions(b)).length, 0);
      assert.ok((await store.billing.listAllSubscriptions()).length >= 2);
    });

    test("billing: the entitlement follows the subscription, and goes when it should", async () => {
      const now = new Date();
      const p = await h.profile();
      const client = await store.accounts.ensureClient(p);
      const created = await store.billing.upsertSubscription(client, sub("derive1", { currentPeriodEnd: new Date(now.getTime() + 10 * 24 * HOUR) }));
      assert.equal((await store.access.facts(client, now)).subscription, false, "nothing until it is synced");
      assert.ok(await store.billing.syncEntitlement(created, new Date(now.getTime() + 1000)));
      const later = new Date(now.getTime() + 2000);
      assert.equal((await store.access.facts(client, later)).subscription, true);
      await store.billing.syncEntitlement(created, later);
      assert.equal((await store.access.facts(client, later)).subscription, true, "syncing twice leaves one open entitlement");

      const failing = await store.billing.upsertSubscription(client, sub("derive1", { status: "unpaid" }));
      assert.equal(await store.billing.syncEntitlement(failing, later), null);
      assert.equal((await store.access.facts(client, later)).subscription, false, "unpaid removes it");

      const back = await store.billing.upsertSubscription(client, sub("derive1", { status: "active" }));
      await store.billing.syncEntitlement(back, later);
      assert.equal((await store.access.facts(client, later)).subscription, true);
      assert.equal(await store.billing.markRefunded("sub_derive1", later), true);
      assert.equal(await store.billing.markRefunded("sub_nope", later), false);
      await store.billing.syncEntitlement(back, later);
      assert.equal((await store.access.facts(client, later)).subscription, false, "a refund removes it, whatever Stripe says");
      const stillRefunded = await store.billing.upsertSubscription(client, sub("derive1", { status: "active" }));
      assert.ok(stillRefunded.refundedAt, "a later Stripe update does not clear the refund");
      assert.equal(await store.billing.syncEntitlement(stillRefunded, later), null);

      const ended = await store.billing.upsertSubscription(client, sub("derive2", { status: "canceled", currentPeriodEnd: new Date(now.getTime() + 3 * HOUR), endedAt: new Date(now.getTime() + 3 * HOUR) }));
      await store.billing.syncEntitlement(ended, later);
      assert.equal((await store.access.facts(client, later)).subscription, true, "a cancelled subscription runs to the end of the paid period");
      assert.equal((await store.access.facts(client, new Date(now.getTime() + 4 * HOUR))).subscription, false);
    });

    test("billing: a webhook event is processed once; one that did not finish is tried again", async () => {
      const now = new Date();
      assert.equal(await store.billing.claimEvent("evt_one1", "invoice.paid", false, now), "process");
      assert.equal(await store.billing.claimEvent("evt_one1", "invoice.paid", false, now), "process", "claimed but not completed: a retry is allowed");
      await store.billing.failEvent("evt_one1", "send_failed");
      assert.equal(await store.billing.claimEvent("evt_one1", "invoice.paid", false, now), "process");
      await store.billing.completeEvent("evt_one1", now);
      assert.equal(await store.billing.claimEvent("evt_one1", "invoice.paid", false, now), "duplicate");
      assert.equal(await store.billing.claimEvent("evt_two2", "invoice.paid", true, now), "process", "a different event is a different event");
    });

    test("billing: an administrator grant opens access, can be scheduled, ends, and is revoked at once", async () => {
      const now = new Date();
      const client = await store.accounts.ensureClient(await h.profile());
      const open = await store.billing.createGrant({ clientId: client, reason: "family of an enrolled student", startsAt: new Date(now.getTime() - HOUR) });
      assert.equal(open.revokedAt, null);
      assert.equal((await store.access.facts(client, now)).adminGrant, true);
      assert.equal(await store.billing.revokeGrant(open.id, now), true);
      assert.equal((await store.access.facts(client, now)).adminGrant, false, "revoked");
      assert.equal(await store.billing.revokeGrant(open.id, now), false, "once");
      assert.equal(await store.billing.revokeGrant("00000000-0000-4000-8000-000000000000", now), false);
      assert.equal((await store.access.facts(client, new Date(now.getTime() - 30 * 60_000))).adminGrant, true, "the grant held until it was revoked");

      const scheduled = await store.billing.createGrant({ clientId: client, reason: "starts tomorrow", startsAt: new Date(now.getTime() + 24 * HOUR), endsAt: new Date(now.getTime() + 48 * HOUR) });
      assert.equal((await store.access.facts(client, now)).adminGrant, false, "not yet");
      assert.equal((await store.access.facts(client, new Date(now.getTime() + 30 * HOUR))).adminGrant, true);
      assert.equal((await store.access.facts(client, new Date(now.getTime() + 50 * HOUR))).adminGrant, false, "ended");
      assert.equal(await store.billing.revokeGrant(scheduled.id, now), true, "revoking before it starts removes it");
      assert.equal((await store.access.facts(client, new Date(now.getTime() + 30 * HOUR))).adminGrant, false);

      await assert.rejects(() => store.billing.createGrant({ clientId: client, reason: "backwards", startsAt: now, endsAt: new Date(now.getTime() - HOUR) }));
    });

    test("teardown", async () => {
      await close();
    });
  });
}
