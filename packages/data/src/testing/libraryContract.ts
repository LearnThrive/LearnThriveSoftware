/**
 * One behavioural contract for the Library store, run against the in-memory store (libraryMemory.test.ts) and the
 * Postgres store on PGlite (librarySql.test.ts). If the two ever disagree, a test here fails for one of them.
 */
import assert from "node:assert/strict";
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
    const family = async () => {
      const profile = await h.profile();
      return { profile, clientId: await store.accounts.ensureClient(profile) };
    };

    test("chat: a session belongs to one family; another family cannot read, write, list, attach to or delete it", async () => {
      const now = new Date();
      const a = await family();
      const b = await family();
      const student = await h.student(a.profile);
      const session = await store.chat.createSession(a.clientId, { title: "Fractions" }, now);
      assert.equal(session.title, "Fractions");
      assert.equal(session.studentId, null);
      assert.equal(session.deletionRequestedAt, null);
      assert.equal(session.deleteAfter.getTime(), now.getTime() + 30 * DAYS);
      assert.deepEqual((await store.chat.listSessions(a.clientId)).map((s) => s.id), [session.id]);
      assert.deepEqual(await store.chat.listSessions(b.clientId), []);
      assert.equal((await store.chat.getSession(a.clientId, session.id))?.id, session.id);
      assert.equal(await store.chat.getSession(b.clientId, session.id), null);
      await store.chat.appendMessage(a.clientId, session.id, "user", "What is 1/2 + 1/3?", now);
      assert.deepEqual(await store.chat.listMessages(b.clientId, session.id), []);
      await assert.rejects(() => store.chat.appendMessage(b.clientId, session.id, "user", "intruder", now), /no such chat/);
      await assert.rejects(() => store.chat.addFile(b.clientId, session.id, { storagePath: "x/y.png", bytes: 5, contentType: "image/png" }, now), /no such chat/);
      assert.equal(await store.chat.requestDeletion(b.clientId, session.id, now), false);
      assert.deepEqual(await store.chat.listFiles(b.clientId, session.id), []);
      assert.equal((await store.chat.listMessages(a.clientId, session.id)).length, 1, "the intruder wrote nothing");

      const forStudent = await store.chat.createSession(a.clientId, { studentId: student }, now);
      assert.equal(forStudent.studentId, student);
      await assert.rejects(() => store.chat.createSession(b.clientId, { studentId: student }, now), /not in this family/);
    });

    test("chat: messages keep their order, and each one moves the chat's last activity and deletion date on", async () => {
      const now = new Date();
      const { clientId } = await family();
      const s = await store.chat.createSession(clientId, {}, now);
      const first = await store.chat.appendMessage(clientId, s.id, "user", "one", now);
      const second = await store.chat.appendMessage(clientId, s.id, "assistant", "two", now);
      const later = new Date(now.getTime() + 5 * DAYS);
      const third = await store.chat.appendMessage(clientId, s.id, "user", "three", later);
      assert.deepEqual((await store.chat.listMessages(clientId, s.id)).map((m) => m.content), ["one", "two", "three"], "even two messages sent at the same instant");
      assert.ok(second.createdAt.getTime() > first.createdAt.getTime());
      assert.equal(third.deleteAfter.getTime(), later.getTime() + 30 * DAYS);
      const moved = await store.chat.getSession(clientId, s.id);
      assert.equal(moved?.lastActivityAt.getTime(), later.getTime());
      assert.equal(moved?.deleteAfter.getTime(), later.getTime() + 30 * DAYS);
      const other = await store.chat.createSession(clientId, {}, new Date(later.getTime() + 1000));
      assert.deepEqual((await store.chat.listSessions(clientId)).slice(0, 2).map((x) => x.id), [other.id, s.id], "newest activity first");
    });

    test("chat: uploads expire in 7 days, attach once, and only to the family's own message", async () => {
      const now = new Date();
      const a = await family();
      const b = await family();
      const s = await store.chat.createSession(a.clientId, {}, now);
      const f1 = await store.chat.addFile(a.clientId, s.id, { storagePath: `${s.id}/one.png`, bytes: 100, contentType: "image/png" }, now);
      const f2 = await store.chat.addFile(a.clientId, s.id, { storagePath: `${s.id}/two.pdf`, bytes: 200, contentType: "application/pdf" }, now);
      assert.equal(f1.deleteAfter.getTime(), now.getTime() + 7 * DAYS);
      assert.equal(f1.messageId, null);
      assert.equal((await store.chat.getUnattachedFiles(a.clientId, s.id, [f1.id, f2.id])).length, 2);
      assert.deepEqual(await store.chat.getUnattachedFiles(b.clientId, s.id, [f1.id]), []);
      const msg = await store.chat.appendMessage(a.clientId, s.id, "user", "see my working", now);
      assert.equal(await store.chat.attachFiles(b.clientId, s.id, [f1.id], msg.id), 0, "not another family's");
      assert.equal(await store.chat.attachFiles(a.clientId, s.id, [f1.id], "00000000-0000-4000-8000-000000000000"), 0, "not a message that is not in this chat");
      assert.equal(await store.chat.attachFiles(a.clientId, s.id, [f1.id], msg.id), 1);
      assert.equal(await store.chat.attachFiles(a.clientId, s.id, [f1.id], msg.id), 0, "once");
      assert.deepEqual((await store.chat.getUnattachedFiles(a.clientId, s.id, [f1.id, f2.id])).map((f) => f.id), [f2.id]);
      assert.equal((await store.chat.listFiles(a.clientId, s.id)).find((f) => f.id === f1.id)?.messageId, msg.id);
      assert.equal(await store.chat.attachFiles(a.clientId, s.id, [], msg.id), 0);
    });

    test("chat: deleting a chat hides it at once; the retention job then removes it and says which files to delete", async () => {
      const now = new Date();
      const a = await family();
      const b = await family();
      const gone = await store.chat.createSession(a.clientId, { title: "to delete" }, now);
      const kept = await store.chat.createSession(a.clientId, { title: "to keep" }, now);
      const theirs = await store.chat.createSession(b.clientId, { title: "theirs" }, now);
      await store.chat.appendMessage(a.clientId, gone.id, "user", "secret", now);
      await store.chat.appendMessage(a.clientId, kept.id, "user", "fine", now);
      await store.chat.addFile(a.clientId, gone.id, { storagePath: `${gone.id}/a.png`, bytes: 1, contentType: "image/png" }, now);
      await store.chat.addFile(a.clientId, kept.id, { storagePath: `${kept.id}/b.png`, bytes: 1, contentType: "image/png" }, now);

      assert.equal(await store.chat.requestDeletion(a.clientId, gone.id, now), true);
      assert.equal(await store.chat.requestDeletion(a.clientId, gone.id, now), false, "once");
      assert.equal(await store.chat.getSession(a.clientId, gone.id), null, "hidden at once");
      assert.deepEqual(await store.chat.listMessages(a.clientId, gone.id), []);
      assert.deepEqual((await store.chat.listSessions(a.clientId)).map((s) => s.id), [kept.id]);
      await assert.rejects(() => store.chat.appendMessage(a.clientId, gone.id, "user", "again", now), /no such chat/);

      assert.deepEqual(await store.chat.dueStoragePaths(now), [`${gone.id}/a.png`], "only the deleted chat's file");
      const purged = await store.chat.purgeDue(now);
      assert.deepEqual(purged, { sessions: 1, messages: 1, files: 1 });
      assert.deepEqual(await store.chat.dueStoragePaths(now), []);
      assert.equal((await store.chat.listMessages(a.clientId, kept.id)).length, 1, "the other chat is untouched");
      assert.deepEqual(await store.chat.purgeDue(now), { sessions: 0, messages: 0, files: 0 }, "nothing left to do");

      assert.equal(await store.chat.requestDeletionAll(a.clientId, now), 1);
      assert.deepEqual(await store.chat.listSessions(a.clientId), []);
      assert.equal((await store.chat.listSessions(b.clientId)).length, 1);
      assert.equal(theirs.title, "theirs");
      await store.chat.purgeDue(now);
      assert.equal((await store.chat.listSessions(b.clientId)).length, 1, "another family's chats are never touched");
    });

    test("chat: text is removed after 30 days and uploads after 7, with the chat itself going when its last message does", async () => {
      // Dated years ago, so the job's global counts cannot include rows other tests made.
      const now = new Date("2020-03-01T00:00:00Z");
      const { clientId } = await family();
      const s = await store.chat.createSession(clientId, {}, now);
      const old = await store.chat.appendMessage(clientId, s.id, "user", "old question", now);
      await store.chat.addFile(clientId, s.id, { storagePath: `${s.id}/early.png`, bytes: 1, contentType: "image/png" }, now);
      const recent = new Date(now.getTime() + 29 * DAYS);
      await store.chat.appendMessage(clientId, s.id, "user", "recent question", recent);
      await store.chat.addFile(clientId, s.id, { storagePath: `${s.id}/late.png`, bytes: 1, contentType: "image/png" }, recent);

      const day8 = new Date(now.getTime() + 8 * DAYS);
      assert.deepEqual(await store.chat.dueStoragePaths(day8), [`${s.id}/early.png`], "the first upload is a week old");
      assert.deepEqual(await store.chat.purgeDue(day8), { sessions: 0, messages: 0, files: 1 });
      const day31 = new Date(now.getTime() + 31 * DAYS);
      assert.deepEqual(await store.chat.purgeDue(day31), { sessions: 0, messages: 1, files: 0 }, "the old message goes; the chat stays and so does the second upload (a week from day 29)");
      assert.deepEqual((await store.chat.listMessages(clientId, s.id)).map((m) => m.content), ["recent question"]);
      assert.equal(old.deleteAfter.getTime(), now.getTime() + 30 * DAYS);
      const day60 = new Date(now.getTime() + 60 * DAYS);
      assert.deepEqual(await store.chat.purgeDue(day60), { sessions: 1, messages: 1, files: 1 });
      assert.deepEqual(await store.chat.listSessions(clientId), []);
    });

    test("chat: an export holds the family's own chats and not deleted ones or anyone else's", async () => {
      const now = new Date();
      const a = await family();
      const b = await family();
      const mine = await store.chat.createSession(a.clientId, { title: "Mine" }, now);
      await store.chat.appendMessage(a.clientId, mine.id, "user", "hello", now);
      await store.chat.appendMessage(a.clientId, mine.id, "assistant", "hi", now);
      await store.chat.addFile(a.clientId, mine.id, { storagePath: `${mine.id}/x.png`, bytes: 7, contentType: "image/png" }, now);
      const hidden = await store.chat.createSession(a.clientId, { title: "Deleted" }, now);
      await store.chat.requestDeletion(a.clientId, hidden.id, now);
      await store.chat.createSession(b.clientId, { title: "Theirs" }, now);
      const out = await store.chat.exportAll(a.clientId, now);
      assert.equal(out.exportedAt, now.toISOString());
      assert.deepEqual(out.sessions.map((s) => s.title), ["Mine"]);
      assert.deepEqual(out.sessions[0]!.messages.map((m) => [m.role, m.content]), [["user", "hello"], ["assistant", "hi"]]);
      assert.deepEqual(out.sessions[0]!.files.map((f) => [f.contentType, f.bytes]), [["image/png", 7]]);
      assert.ok(!JSON.stringify(out).includes("storage"), "no storage path in an export");
      assert.deepEqual((await store.chat.exportAll(b.clientId, now)).sessions.map((s) => s.title), ["Theirs"]);
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

    test("teardown", async () => {
      await close();
    });
  });
}
