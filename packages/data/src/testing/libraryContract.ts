/**
 * One behavioural contract for the Library store, run against the in-memory store (libraryMemory.test.ts) and the
 * Postgres store on PGlite (librarySql.test.ts). If the two ever disagree, a test here fails for one of them.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import type { AccountRole, LibraryStore, ResourceInput, SubscriptionInput } from "../library";

export interface ContractHarness {
  store: LibraryStore;
  profile(options?: { role?: AccountRole; adult?: boolean; email?: string }): Promise<string>;
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

    test("accounts: the sign-in email is readable for the billing emails", async () => {
      const id = await h.profile({ email: "billing-contract@example.com" });
      assert.equal(await store.accounts.getEmail(id), "billing-contract@example.com");
      assert.equal(await store.accounts.getEmail("00000000-0000-4000-8000-000000000000"), null);
    });

    test("accounts: the owner of a family account is found by its id", async () => {
      const id = await h.profile();
      const clientId = await store.accounts.ensureClient(id);
      assert.equal(await store.accounts.getOwnerProfileId(clientId), id);
      assert.equal(await store.accounts.getOwnerProfileId("00000000-0000-4000-8000-000000000000"), null);
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

    test("billing: a consent is recorded against a profile that exists", async () => {
      const id = await h.profile();
      await store.billing.recordConsent({ profileId: id, kind: "digital_content_waiver", version: "v1", textSha256: "d".repeat(64), at: new Date() });
      await assert.rejects(() => store.billing.recordConsent({ profileId: "00000000-0000-4000-8000-000000000000", kind: "digital_content_waiver", version: "v1", textSha256: "d".repeat(64), at: new Date() }));
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

    const DAYS = 24 * HOUR;
    // The owner of a family's own chats (no learner).
    const own = (f: { clientId: string }, studentId: string | null = null) => ({ clientId: f.clientId, studentId });
    const family = async () => {
      const profile = await h.profile();
      return { profile, clientId: await store.accounts.ensureClient(profile) };
    };

    test("chat: a session belongs to one family; another family cannot read, write, list, attach to or delete it", async () => {
      const now = new Date();
      const a = await family();
      const b = await family();
      const student = await h.student(a.profile);
      const session = await store.chat.createSession(own(a), { title: "Fractions" }, now);
      assert.equal(session.title, "Fractions");
      assert.equal(session.studentId, null);
      assert.equal(session.deletionRequestedAt, null);
      assert.equal(session.deleteAfter.getTime(), now.getTime() + 30 * DAYS);
      assert.deepEqual((await store.chat.listSessions(own(a))).map((s) => s.id), [session.id]);
      assert.deepEqual(await store.chat.listSessions(own(b)), []);
      assert.equal((await store.chat.getSession(own(a), session.id))?.id, session.id);
      assert.equal(await store.chat.getSession(own(b), session.id), null);
      await store.chat.appendMessage(own(a), session.id, "user", "What is 1/2 + 1/3?", now);
      assert.deepEqual(await store.chat.listMessages(own(b), session.id), []);
      await assert.rejects(() => store.chat.appendMessage(own(b), session.id, "user", "intruder", now), /no such chat/);
      await assert.rejects(() => store.chat.addFile(own(b), session.id, { storagePath: "x/y.png", bytes: 5, contentType: "image/png" }, now), /no such chat/);
      assert.equal(await store.chat.requestDeletion(own(b), session.id, now), false);
      assert.deepEqual(await store.chat.listFiles(own(b), session.id), []);
      assert.equal((await store.chat.listMessages(own(a), session.id)).length, 1, "the intruder wrote nothing");

      assert.equal(await store.chat.renameSession(own(a), session.id, "Fractions homework"), true);
      assert.equal((await store.chat.getSession(own(a), session.id))?.title, "Fractions homework");
      assert.equal(await store.chat.renameSession(own(b), session.id, "stolen"), false, "only the family that owns a chat can rename it");
      assert.equal((await store.chat.getSession(own(a), session.id))?.title, "Fractions homework");
      assert.equal(await store.chat.renameSession(own(a), session.id, "x".repeat(200)), true);
      assert.equal((await store.chat.getSession(own(a), session.id))?.title.length, 120);

      const forStudent = await store.chat.createSession(own(a, student), {}, now);
      assert.equal(forStudent.studentId, student);
      await assert.rejects(() => store.chat.createSession(own(b, student), {}, now), /not in this family/);
    });

    test("chat: a learner's conversations are theirs alone: a sibling and even the guardian cannot find, read, write, export or rename them; the guardian may delete them", async () => {
      const now = new Date();
      const f = await family();
      const stranger = await family();
      const strangerStudent = await h.student(stranger.profile);
      const ava = await h.student(f.profile);
      const ben = await h.student(f.profile);
      const guardian = own(f);
      const asAva = own(f, ava);
      const asBen = own(f, ben);
      const session = await store.chat.createSession(asAva, { title: "Ava's maths" }, now);
      assert.equal(session.studentId, ava);
      const message = await store.chat.appendMessage(asAva, session.id, "user", "a private question", now);
      const file = await store.chat.addFile(asAva, session.id, { storagePath: `${session.id}/ava.png`, bytes: 3, contentType: "image/png" }, now);
      const own_ = await store.chat.createSession(guardian, { title: "Guardian's own" }, now);

      for (const [who, name] of [[asBen, "a sibling"], [guardian, "the guardian"], [own(stranger), "another family"], [own(stranger, strangerStudent), "another family's learner"]] as const) {
        assert.equal(await store.chat.getSession(who, session.id), null, `${name}: getSession`);
        assert.deepEqual(await store.chat.listMessages(who, session.id), [], `${name}: listMessages`);
        assert.deepEqual(await store.chat.listFiles(who, session.id), [], `${name}: listFiles`);
        assert.equal(await store.chat.getFile(who, file.id), null, `${name}: getFile`);
        assert.deepEqual(await store.chat.getUnattachedFiles(who, session.id, [file.id]), [], `${name}: getUnattachedFiles`);
        await assert.rejects(() => store.chat.appendMessage(who, session.id, "user", "intruder", now), /no such chat/, `${name}: appendMessage`);
        await assert.rejects(() => store.chat.addFile(who, session.id, { storagePath: "x/y.png", bytes: 1, contentType: "image/png" }, now), /no such chat/, `${name}: addFile`);
        assert.equal(await store.chat.attachFiles(who, session.id, [file.id], message.id), 0, `${name}: attachFiles`);
        assert.equal(await store.chat.renameSession(who, session.id, "stolen"), false, `${name}: renameSession`);
        assert.equal(await store.chat.requestDeletion(who, session.id, now), false, `${name}: requestDeletion`);
        assert.ok(!(await store.chat.listSessions(who)).some((x) => x.id === session.id), `${name}: listSessions`);
        assert.ok(!JSON.stringify(await store.chat.exportAll(who, now)).includes("a private question"), `${name}: exportAll`);
      }
      assert.deepEqual((await store.chat.listSessions(asAva)).map((x) => x.id), [session.id], "Ava sees hers, not the guardian's own");
      assert.deepEqual((await store.chat.listSessions(guardian)).map((x) => x.id), [own_.id], "the guardian sees their own, not Ava's");
      assert.equal((await store.chat.listMessages(asAva, session.id)).length, 1, "the intruders wrote nothing");
      assert.equal(await store.chat.requestDeletionAll(asBen, now), 0, "Ben deleting all his chats touches none of Ava's");
      assert.equal((await store.chat.getSession(asAva, session.id))?.id, session.id);

      await assert.rejects(() => store.chat.createSession(own(f, strangerStudent), {}, now), /not in this family/, "a chat for another family's student");

      // The guardian cannot read a learner's chats but may delete them: only their own family's, and only for an active link.
      assert.equal(await store.chat.requestLearnerDeletionAll(stranger.clientId, ava, now), 0, "another family cannot");
      assert.equal(await store.chat.requestLearnerDeletionAll(f.clientId, ava, now), 1);
      assert.equal(await store.chat.getSession(asAva, session.id), null, "hidden at once");
      assert.equal((await store.chat.getSession(guardian, own_.id))?.id, own_.id, "the guardian's own chat is untouched");
      assert.equal(await store.chat.requestLearnerDeletionAll(f.clientId, ava, now), 0, "once");
      // Leave nothing queued for the retention tests that count what is due.
      await store.chat.purgeDue(now);
    });

    test("chat: messages keep their order, and each one moves the chat's last activity and deletion date on", async () => {
      const now = new Date();
      const { clientId } = await family();
      const s = await store.chat.createSession(own({ clientId }), {}, now);
      const first = await store.chat.appendMessage(own({ clientId }), s.id, "user", "one", now);
      const second = await store.chat.appendMessage(own({ clientId }), s.id, "assistant", "two", now);
      const later = new Date(now.getTime() + 5 * DAYS);
      const third = await store.chat.appendMessage(own({ clientId }), s.id, "user", "three", later);
      assert.deepEqual((await store.chat.listMessages(own({ clientId }), s.id)).map((m) => m.content), ["one", "two", "three"], "even two messages sent at the same instant");
      assert.ok(second.createdAt.getTime() > first.createdAt.getTime());
      assert.equal(third.deleteAfter.getTime(), later.getTime() + 30 * DAYS);
      const moved = await store.chat.getSession(own({ clientId }), s.id);
      assert.equal(moved?.lastActivityAt.getTime(), later.getTime());
      assert.equal(moved?.deleteAfter.getTime(), later.getTime() + 30 * DAYS);
      const other = await store.chat.createSession(own({ clientId }), {}, new Date(later.getTime() + 1000));
      assert.deepEqual((await store.chat.listSessions(own({ clientId }))).slice(0, 2).map((x) => x.id), [other.id, s.id], "newest activity first");
    });

    test("chat: uploads expire in 7 days, attach once, and only to the family's own message", async () => {
      const now = new Date();
      const a = await family();
      const b = await family();
      const s = await store.chat.createSession(own(a), {}, now);
      const f1 = await store.chat.addFile(own(a), s.id, { storagePath: `${s.id}/one.png`, bytes: 100, contentType: "image/png" }, now);
      const f2 = await store.chat.addFile(own(a), s.id, { storagePath: `${s.id}/two.pdf`, bytes: 200, contentType: "application/pdf" }, now);
      assert.equal(f1.deleteAfter.getTime(), now.getTime() + 7 * DAYS);
      assert.equal(f1.messageId, null);
      assert.equal((await store.chat.getUnattachedFiles(own(a), s.id, [f1.id, f2.id])).length, 2);
      assert.deepEqual(await store.chat.getUnattachedFiles(own(b), s.id, [f1.id]), []);
      assert.equal((await store.chat.getFile(own(a), f1.id))?.id, f1.id, "the owner can fetch a file by its id");
      assert.equal(await store.chat.getFile(own(b), f1.id), null, "another family cannot");
      assert.equal(await store.chat.getFile(own(a), "00000000-0000-4000-8000-000000000000"), null);
      const msg = await store.chat.appendMessage(own(a), s.id, "user", "see my working", now);
      assert.equal(await store.chat.attachFiles(own(b), s.id, [f1.id], msg.id), 0, "not another family's");
      assert.equal(await store.chat.attachFiles(own(a), s.id, [f1.id], "00000000-0000-4000-8000-000000000000"), 0, "not a message that is not in this chat");
      assert.equal(await store.chat.attachFiles(own(a), s.id, [f1.id], msg.id), 1);
      assert.equal(await store.chat.attachFiles(own(a), s.id, [f1.id], msg.id), 0, "once");
      assert.deepEqual((await store.chat.getUnattachedFiles(own(a), s.id, [f1.id, f2.id])).map((f) => f.id), [f2.id]);
      assert.equal((await store.chat.listFiles(own(a), s.id)).find((f) => f.id === f1.id)?.messageId, msg.id);
      assert.equal(await store.chat.attachFiles(own(a), s.id, [], msg.id), 0);
    });

    test("chat: deleting a chat hides it at once; the retention job then removes it and says which files to delete", async () => {
      const now = new Date();
      const a = await family();
      const b = await family();
      const gone = await store.chat.createSession(own(a), { title: "to delete" }, now);
      const kept = await store.chat.createSession(own(a), { title: "to keep" }, now);
      const theirs = await store.chat.createSession(own(b), { title: "theirs" }, now);
      await store.chat.appendMessage(own(a), gone.id, "user", "secret", now);
      await store.chat.appendMessage(own(a), kept.id, "user", "fine", now);
      await store.chat.addFile(own(a), gone.id, { storagePath: `${gone.id}/a.png`, bytes: 1, contentType: "image/png" }, now);
      await store.chat.addFile(own(a), kept.id, { storagePath: `${kept.id}/b.png`, bytes: 1, contentType: "image/png" }, now);

      assert.equal(await store.chat.requestDeletion(own(a), gone.id, now), true);
      assert.equal(await store.chat.requestDeletion(own(a), gone.id, now), false, "once");
      assert.equal(await store.chat.getSession(own(a), gone.id), null, "hidden at once");
      assert.deepEqual(await store.chat.listMessages(own(a), gone.id), []);
      assert.deepEqual((await store.chat.listSessions(own(a))).map((s) => s.id), [kept.id]);
      await assert.rejects(() => store.chat.appendMessage(own(a), gone.id, "user", "again", now), /no such chat/);

      assert.deepEqual(await store.chat.dueStoragePaths(now), [`${gone.id}/a.png`], "only the deleted chat's file");
      const purged = await store.chat.purgeDue(now);
      assert.deepEqual(purged, { sessions: 1, messages: 1, files: 1 });
      assert.deepEqual(await store.chat.dueStoragePaths(now), []);
      assert.equal((await store.chat.listMessages(own(a), kept.id)).length, 1, "the other chat is untouched");
      assert.deepEqual(await store.chat.purgeDue(now), { sessions: 0, messages: 0, files: 0 }, "nothing left to do");

      assert.equal(await store.chat.requestDeletionAll(own(a), now), 1);
      assert.deepEqual(await store.chat.listSessions(own(a)), []);
      assert.equal((await store.chat.listSessions(own(b))).length, 1);
      assert.equal(theirs.title, "theirs");
      await store.chat.purgeDue(now);
      assert.equal((await store.chat.listSessions(own(b))).length, 1, "another family's chats are never touched");
    });

    test("chat: text is removed after 30 days and uploads after 7, with the chat itself going when its last message does", async () => {
      // Dated years ago, so the job's global counts cannot include rows other tests made.
      const now = new Date("2020-03-01T00:00:00Z");
      const { clientId } = await family();
      const s = await store.chat.createSession(own({ clientId }), {}, now);
      const old = await store.chat.appendMessage(own({ clientId }), s.id, "user", "old question", now);
      await store.chat.addFile(own({ clientId }), s.id, { storagePath: `${s.id}/early.png`, bytes: 1, contentType: "image/png" }, now);
      const recent = new Date(now.getTime() + 29 * DAYS);
      await store.chat.appendMessage(own({ clientId }), s.id, "user", "recent question", recent);
      await store.chat.addFile(own({ clientId }), s.id, { storagePath: `${s.id}/late.png`, bytes: 1, contentType: "image/png" }, recent);

      const day8 = new Date(now.getTime() + 8 * DAYS);
      assert.deepEqual(await store.chat.dueStoragePaths(day8), [`${s.id}/early.png`], "the first upload is a week old");
      assert.deepEqual(await store.chat.purgeDue(day8), { sessions: 0, messages: 0, files: 1 });
      const day31 = new Date(now.getTime() + 31 * DAYS);
      assert.deepEqual(await store.chat.purgeDue(day31), { sessions: 0, messages: 1, files: 0 }, "the old message goes; the chat stays and so does the second upload (a week from day 29)");
      assert.deepEqual((await store.chat.listMessages(own({ clientId }), s.id)).map((m) => m.content), ["recent question"]);
      assert.equal(old.deleteAfter.getTime(), now.getTime() + 30 * DAYS);
      const day60 = new Date(now.getTime() + 60 * DAYS);
      assert.deepEqual(await store.chat.purgeDue(day60), { sessions: 1, messages: 1, files: 1 });
      assert.deepEqual(await store.chat.listSessions(own({ clientId })), []);
    });

    test("chat: an export holds the family's own chats and not deleted ones or anyone else's", async () => {
      const now = new Date();
      const a = await family();
      const b = await family();
      const mine = await store.chat.createSession(own(a), { title: "Mine" }, now);
      await store.chat.appendMessage(own(a), mine.id, "user", "hello", now);
      await store.chat.appendMessage(own(a), mine.id, "assistant", "hi", now);
      await store.chat.addFile(own(a), mine.id, { storagePath: `${mine.id}/x.png`, bytes: 7, contentType: "image/png" }, now);
      const hidden = await store.chat.createSession(own(a), { title: "Deleted" }, now);
      await store.chat.requestDeletion(own(a), hidden.id, now);
      await store.chat.createSession(own(b), { title: "Theirs" }, now);
      const out = await store.chat.exportAll(own(a), now);
      assert.equal(out.exportedAt, now.toISOString());
      assert.deepEqual(out.sessions.map((s) => s.title), ["Mine"]);
      assert.deepEqual(out.sessions[0]!.messages.map((m) => [m.role, m.content]), [["user", "hello"], ["assistant", "hi"]]);
      assert.deepEqual(out.sessions[0]!.files.map((f) => [f.contentType, f.bytes]), [["image/png", 7]]);
      assert.ok(!JSON.stringify(out).includes("storage"), "no storage path in an export");
      assert.deepEqual((await store.chat.exportAll(own(b), now)).sessions.map((s) => s.title), ["Theirs"]);
    });

    test("chat: usage counters add up per family, kind and window", async () => {
      const a = await family();
      const b = await family();
      const window = new Date("2026-10-20T00:00:00Z");
      assert.equal(await store.chat.usageCount(a.clientId, "assistant_message_day", window), 0);
      assert.equal(await store.chat.incrementUsage(a.clientId, "assistant_message_day", window, 1), 1);
      assert.equal(await store.chat.incrementUsage(a.clientId, "assistant_message_day", window, 2), 3);
      assert.equal(await store.chat.usageCount(a.clientId, "assistant_message_day", window), 3);
      assert.equal(await store.chat.usageCount(b.clientId, "assistant_message_day", window), 0);
      assert.equal(await store.chat.usageCount(a.clientId, "assistant_message_minute", window), 0);
      assert.equal(await store.chat.usageCount(a.clientId, "assistant_message_day", new Date("2026-10-21T00:00:00Z")), 0);
    });

    describe("papers: durable jobs", () => {
      const W1 = { id: "worker-1", leaseMs: 60_000 };
      const W2 = { id: "worker-2", leaseMs: 60_000 };
      type Created = { ok: true; job: { id: string } };
      const start = async (owner: { clientId: string; studentId: string | null }, now: Date, worker = W1, kind: "solve" | "mark" = "solve") => {
        const session = await store.chat.createSession(owner, {}, now);
        const result = await store.papers.create(owner, { sessionId: session.id, fileId: randomUUID(), schemeFileId: null, kind }, worker, now);
        return { session, result };
      };

      test("one active job per family, whichever learner started it; a finished or waiting job does not block", async () => {
        const now = new Date();
        const f = await family();
        const ava = await h.student(f.profile);
        const a = await start(own(f), now);
        assert.equal(a.result.ok, true);
        const job = (a.result as Created).job;
        assert.equal((await store.papers.activeForFamily(f.clientId))?.id, job.id);
        const second = await start(own(f, ava), now);
        assert.deepEqual(second.result, { ok: false, code: "busy" }, "a sibling or the guardian cannot start another while one is running");
        assert.equal(await store.papers.finish(job.id, W1.id, { state: "ready" }, now), true);
        assert.equal(await store.papers.activeForFamily(f.clientId), null, "waiting for a choice is not active");
        const third = await start(own(f, ava), now);
        assert.equal(third.result.ok, true);
        const other = await family();
        assert.equal((await start(own(other), now)).result.ok, true, "another family is independent");
      });

      test("only the owner (family and learner) can see, begin or cancel a job; a chat that is not theirs is refused", async () => {
        const now = new Date();
        const f = await family();
        const stranger = await family();
        const ava = await h.student(f.profile);
        const ben = await h.student(f.profile);
        const { session, result } = await start(own(f, ava), now);
        assert.equal(result.ok, true);
        const id = (result as Created).job.id;
        for (const [who, name] of [[own(f, ben), "a sibling"], [own(f), "the guardian"], [own(stranger), "another family"]] as const) {
          assert.equal(await store.papers.get(who, id), null, `${name}: get`);
          assert.equal(await store.papers.cancel(who, id, now), false, `${name}: cancel`);
          assert.deepEqual(await store.papers.begin(who, id, { mode: "inline", selectedIds: null }, W2, now), { ok: false, code: "not_found" }, `${name}: begin`);
          assert.deepEqual(await store.papers.create(who, { sessionId: session.id, fileId: randomUUID(), schemeFileId: null, kind: "solve" }, W2, now), { ok: false, code: "not_found" }, `${name}: create on Ava's chat`);
        }
        assert.equal((await store.papers.get(own(f, ava), id))?.state, "extracting");
        assert.equal((await store.papers.get(own(f, ava), id))?.studentId, ava);
      });

      test("a job runs extracting -> ready -> solving -> done, with a checkpoint per question and a lease renewed by each", async () => {
        const now = new Date("2026-10-22T10:00:00Z");
        const f = await family();
        const { result } = await start(own(f), now);
        const id = (result as Created).job.id;
        const questions = [{ id: "q1" }, { id: "q2" }];
        const later = new Date(now.getTime() + 30_000);
        const saved = await store.papers.save(id, W1.id, { questions, message: "Found 2." }, W1, later);
        assert.deepEqual(saved?.questions, questions);
        assert.equal(saved?.leaseExpiresAt?.getTime(), later.getTime() + W1.leaseMs, "saving renews the lease");
        assert.equal(await store.papers.finish(id, W1.id, { state: "ready" }, later), true);
        const ready = await store.papers.get(own(f), id);
        assert.deepEqual([ready?.state, ready?.leaseOwner, ready?.leaseExpiresAt, ready?.message], ["ready", null, null, "Found 2."]);
        const begun = await store.papers.begin(own(f), id, { mode: "inline", selectedIds: ["q2"] }, W1, later);
        assert.equal(begun.ok, true);
        assert.deepEqual(await store.papers.begin(own(f), id, { mode: "inline", selectedIds: null }, W1, later), { ok: false, code: "not_ready" }, "begins once");
        const solving = await store.papers.get(own(f), id);
        assert.deepEqual([solving?.state, solving?.mode, solving?.selectedIds, solving?.leaseOwner], ["solving", "inline", ["q2"], W1.id]);
        await store.papers.save(id, W1.id, { checkpoint: { questionId: "q2", value: { answer: "x = 4", steps: [{ math: "2x = 8" }] } }, progress: [{ questionId: "q2", state: "done" }] }, W1, later);
        await store.papers.save(id, W1.id, { checkpoint: { questionId: "q1", value: { answer: "7" } } }, W1, later);
        const mid = await store.papers.get(own(f), id);
        assert.deepEqual(Object.keys(mid!.checkpoints).sort(), ["q1", "q2"]);
        assert.deepEqual(mid!.checkpoints.q2, { answer: "x = 4", steps: [{ math: "2x = 8" }] }, "checkpoints keep their structure");
        assert.deepEqual(mid!.progress, [{ questionId: "q2", state: "done" }]);
        const file = randomUUID();
        assert.equal(await store.papers.finish(id, W1.id, { state: "done", resultFileId: file, pageCount: 5, workedPages: [4, 5] }, later), true);
        const done = await store.papers.get(own(f), id);
        assert.deepEqual([done?.state, done?.resultFileId, done?.pageCount, done?.workedPages, done?.leaseOwner], ["done", file, 5, [4, 5], null]);
        assert.equal(await store.papers.save(id, W1.id, { message: "late" }, W1, later), null, "a finished job is not written to");
      });

      test("fencing: a worker that has lost its lease cannot save or finish, and cancelling stops the worker", async () => {
        const now = new Date("2026-10-22T10:00:00Z");
        const f = await family();
        const { result } = await start(own(f), now);
        const id = (result as Created).job.id;
        assert.equal(await store.papers.save(id, W2.id, { message: "intruder" }, W2, now), null, "not the lease holder");
        assert.equal(await store.papers.finish(id, W2.id, { state: "done" }, now), false);
        const expired = new Date(now.getTime() + 5 * 60_000);
        const { claimed } = await store.papers.claimStale(W2, expired);
        assert.deepEqual(claimed.filter((j) => j.id === id).map((j) => [j.attempts, j.leaseOwner]), [[2, W2.id]]);
        assert.equal(await store.papers.save(id, W1.id, { message: "zombie" }, W1, expired), null, "the old worker is fenced out");
        assert.equal(await store.papers.finish(id, W1.id, { state: "done" }, expired), false);
        assert.ok(await store.papers.save(id, W2.id, { message: "new owner" }, W2, expired));
        assert.equal(await store.papers.cancel(own(f), id, expired), true);
        const cancelled = await store.papers.get(own(f), id);
        assert.deepEqual([cancelled?.state, cancelled?.message, cancelled?.leaseOwner], ["cancelled", "Cancelled.", null]);
        assert.equal(await store.papers.save(id, W2.id, { message: "still going" }, W2, expired), null, "the worker finds out it was cancelled");
        assert.equal(await store.papers.cancel(own(f), id, expired), true, "cancelling again is harmless");
        assert.equal((await store.papers.get(own(f), id))?.state, "cancelled");
      });

      test("recovery: only jobs whose lease ran out are claimed; one that has run too often is failed, not retried for ever", async () => {
        const now = new Date("2026-10-22T10:00:00Z");
        const f = await family();
        const { result } = await start(own(f), now);
        const id = (result as Created).job.id;
        await store.papers.save(id, W1.id, { questions: [{ id: "q1" }], checkpoint: { questionId: "q1", value: { answer: "1" } } }, W1, now);
        const soon = new Date(now.getTime() + 30_000);
        assert.deepEqual((await store.papers.claimStale(W2, soon)).claimed.filter((j) => j.id === id), [], "a live lease is left alone");
        let at = new Date(now.getTime() + 10 * 60_000);
        const first = (await store.papers.claimStale(W2, at)).claimed.find((j) => j.id === id);
        assert.deepEqual(first?.checkpoints, { q1: { answer: "1" } }, "the checkpoints come with the claim");
        assert.equal(first?.attempts, 2);
        at = new Date(at.getTime() + 10 * 60_000);
        assert.equal((await store.papers.claimStale(W1, at)).claimed.find((j) => j.id === id)?.attempts, 3);
        at = new Date(at.getTime() + 10 * 60_000);
        const last = await store.papers.claimStale(W2, at);
        assert.ok(last.failed >= 1);
        assert.equal(last.claimed.some((j) => j.id === id), false);
        const failed = await store.papers.get(own(f), id);
        assert.deepEqual([failed?.state, failed?.leaseOwner], ["failed", null]);
        assert.equal(await store.papers.activeForFamily(f.clientId), null, "a failed job frees the family");
      });

      test("assessment versions: the AI's value is kept as version 1, each change adds one and becomes current, and only the owner or staff can make or read them", async () => {
        const now = new Date("2026-10-22T10:00:00Z");
        const f = await family();
        const stranger = await family();
        const ava = await h.student(f.profile);
        const ben = await h.student(f.profile);
        const { result } = await start(own(f, ava), now);
        const id = (result as Created).job.id;
        const ai = { id: "q1", student: { answer: "5" }, marks: 0 };
        assert.deepEqual(await store.papers.amend({ kind: "owner", owner: own(f, ava) }, id, "q1", { kind: "correction", actorKind: "student", actorId: null, value: ai, note: null }, now), { ok: false, code: "not_done" }, "not before the job is finished");
        await store.papers.save(id, W1.id, { checkpoint: { questionId: "q1", value: ai } }, W1, now);
        await store.papers.finish(id, W1.id, { state: "done" }, now);

        const asAva = { kind: "owner" as const, owner: own(f, ava) };
        assert.deepEqual(await store.papers.amend(asAva, id, "q9", { kind: "correction", actorKind: "student", actorId: null, value: {}, note: null }, now), { ok: false, code: "no_question" });
        for (const [who, name] of [[{ kind: "owner" as const, owner: own(f, ben) }, "a sibling"], [{ kind: "owner" as const, owner: own(f) }, "the guardian"], [{ kind: "owner" as const, owner: own(stranger) }, "another family"]] as const) {
          assert.deepEqual(await store.papers.amend(who, id, "q1", { kind: "correction", actorKind: "student", actorId: null, value: { id: "q1", intruder: true }, note: null }, now), { ok: false, code: "not_found" }, `${name}: amend`);
          assert.deepEqual(await store.papers.versions(who, id, "q1"), [], `${name}: versions`);
        }

        const fixed = { id: "q1", student: { answer: "6" }, marks: 2 };
        const later = new Date(now.getTime() + 60_000);
        assert.deepEqual(await store.papers.amend(asAva, id, "q1", { kind: "correction", actorKind: "student", actorId: null, value: fixed, note: "I misread my own 6" }, later), { ok: true, version: 2 });
        assert.deepEqual((await store.papers.get(own(f, ava), id))?.checkpoints.q1, fixed, "the current value is the latest");
        const reviewed = { id: "q1", student: { answer: "6" }, marks: 1, override: true };
        const tutor = randomUUID();
        assert.deepEqual(await store.papers.amend({ kind: "staff" }, id, "q1", { kind: "review", actorKind: "tutor", actorId: tutor, value: reviewed, note: "one method mark only" }, later), { ok: true, version: 3 });
        const history = await store.papers.versions(asAva, id, "q1");
        assert.deepEqual(history.map((v) => [v.version, v.kind, v.actorKind]), [[1, "ai", "system"], [2, "correction", "student"], [3, "review", "tutor"]]);
        assert.deepEqual(history.map((v) => v.value), [ai, fixed, reviewed], "nothing was overwritten");
        assert.equal(history[2]!.actorId, tutor);
        assert.equal(history[2]!.note, "one method mark only");
        assert.equal((await store.papers.versions({ kind: "staff" }, id, "q1")).length, 3);
        assert.deepEqual(await store.papers.versions(asAva, id, "q2"), []);
        assert.equal((await store.papers.getById(id))?.id, id);
        assert.equal(await store.papers.getById(randomUUID()), null);
      });

      test("the blank paper is recorded with the job; versions go with the job", async () => {
        const now = new Date("2026-10-22T10:00:00Z");
        const f = await family();
        const session = await store.chat.createSession(own(f), {}, now);
        const blank = randomUUID();
        const made = await store.papers.create(own(f), { sessionId: session.id, fileId: randomUUID(), schemeFileId: null, blankFileId: blank, kind: "mark" }, W1, now);
        assert.equal(made.ok, true);
        const id = (made as Created).job.id;
        assert.equal((await store.papers.get(own(f), id))?.blankFileId, blank);
        await store.papers.save(id, W1.id, { checkpoint: { questionId: "q1", value: { id: "q1" } } }, W1, now);
        await store.papers.finish(id, W1.id, { state: "done" }, now);
        await store.papers.amend({ kind: "owner", owner: own(f) }, id, "q1", { kind: "correction", actorKind: "guardian", actorId: null, value: { id: "q1", v: 2 }, note: null }, now);
        assert.equal((await store.papers.versions({ kind: "staff" }, id, "q1")).length, 2);
        await store.papers.purgeDue(new Date(now.getTime() + 8 * DAYS));
        assert.equal(await store.papers.getById(id), null);
        assert.deepEqual(await store.papers.versions({ kind: "staff" }, id, "q1"), [], "the history goes with its job");
      });

      test("retention: finished jobs go after seven days, active ones stay, and a deleted chat takes its jobs with it", async () => {
        const now = new Date("2026-10-22T10:00:00Z");
        const f = await family();
        const a = await start(own(f), now);
        const id = (a.result as Created).job.id;
        await store.papers.finish(id, W1.id, { state: "failed", message: "x" }, now);
        const b = await start(own(f), now);
        const running = (b.result as Created).job.id;
        const day6 = new Date(now.getTime() + 6 * DAYS);
        assert.equal(await store.papers.purgeDue(day6), 0);
        const day8 = new Date(now.getTime() + 8 * DAYS);
        await store.papers.purgeDue(day8);
        assert.equal(await store.papers.get(own(f), id), null, "the finished job is gone");
        assert.equal((await store.papers.get(own(f), running))?.id, running, "a running one is kept");
        await store.chat.requestDeletion(own(f), b.session.id, now);
        await store.chat.purgeDue(now);
        assert.equal(await store.papers.get(own(f), running), null, "it goes with its chat");
      });
    });

    test("teardown", async () => {
      await close();
    });
  });
}
