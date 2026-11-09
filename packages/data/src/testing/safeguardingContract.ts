/**
 * One behavioural contract for the safeguarding records (the tutor vetting register and the concern log), run against the in-memory
 * repository and the Postgres one on PGlite. The access rules are tested here too, because they are the point: only a named safeguarding
 * lead reads a concern, and every opening and every refused attempt is on the record.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  SafeguardingError, isSafeguardingLead, listConcerns, myConcernReceipts, needsAttention, parseLeads, raiseConcern, readConcern, updateConcern, vettingStatus,
  type NewConcern, type SafeguardingRepository,
} from "../safeguarding";

export interface SafeguardingHarness {
  repo: SafeguardingRepository;
  /** A tutor record that exists, and its id. */
  tutor(): Promise<string>;
  /** A login (a profile) an actor id can point at. */
  login(): Promise<string>;
}

async function rejects(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error) => error instanceof SafeguardingError && error.code === code, `expected a SafeguardingError ${code}`);
}

const TODAY = "2026-11-09";
const LEADS = parseLeads("lead@example.test, deputy@example.test");

export function safeguardingContract(name: string, make: () => Promise<{ harness: SafeguardingHarness; close(): Promise<void> }>): void {
  describe(`safeguarding contract: ${name}`, () => {
    let h: SafeguardingHarness;
    let close: () => Promise<void>;
    let repo: SafeguardingRepository;
    let admin: string;

    test("setup", async () => {
      ({ harness: h, close } = await make());
      repo = h.repo;
      admin = await h.login();
    });

    // ---- vetting ---------------------------------------------------------------------------------------------------------------------

    test("vetting: a check is recorded as seen, and the newest of a kind is the current one", async () => {
      const tutorId = await h.tutor();
      const base = { tutorId, kind: "DBS" as const, how: "Update Service", note: "", recordedBy: admin };
      await repo.vetting.record({ ...base, checkedOn: "2025-09-01", expiresOn: "2026-09-01" }, TODAY);
      const newer = await repo.vetting.record({ ...base, checkedOn: "2026-09-02", expiresOn: "2027-09-02" }, TODAY);
      const checks = await repo.vetting.list(tutorId);
      assert.equal(checks.length, 2);
      const dbs = vettingStatus(checks, TODAY).find((l) => l.kind === "DBS")!;
      assert.equal(dbs.check?.id, newer.id);
      assert.equal(dbs.state, "VALID");
      assert.ok((await repo.vetting.list()).some((c) => c.id === newer.id), "the register lists every tutor's checks");
    });

    test("vetting: missing, due soon and expired are told apart, and a required gap needs attention", async () => {
      const tutorId = await h.tutor();
      assert.equal(needsAttention(vettingStatus(await repo.vetting.list(tutorId), TODAY)), true, "nothing recorded: the required checks are missing");
      const base = { tutorId, how: "Certificate seen in person", note: "", recordedBy: admin };
      await repo.vetting.record({ ...base, kind: "DBS", checkedOn: "2025-12-01", expiresOn: "2026-12-01" }, TODAY);
      await repo.vetting.record({ ...base, kind: "SAFEGUARDING_TRAINING", checkedOn: "2025-10-01", expiresOn: "2026-10-01" }, TODAY);
      await repo.vetting.record({ ...base, kind: "IDENTITY", checkedOn: "2026-01-05", expiresOn: null }, TODAY);
      const lines = vettingStatus(await repo.vetting.list(tutorId), TODAY);
      const state = (kind: string) => lines.find((l) => l.kind === kind)!.state;
      assert.equal(state("DBS"), "DUE_SOON", "runs out within 60 days");
      assert.equal(state("SAFEGUARDING_TRAINING"), "EXPIRED");
      assert.equal(state("IDENTITY"), "VALID", "a check with no expiry stays valid");
      assert.equal(state("REFERENCES"), "MISSING");
      assert.equal(needsAttention(lines), true);
    });

    test("vetting: a certificate number, a future date and an expiry before the check are refused", async () => {
      const tutorId = await h.tutor();
      const ok = { tutorId, kind: "DBS" as const, checkedOn: "2026-11-01", expiresOn: null, how: "Update Service", note: "", recordedBy: admin };
      await rejects(repo.vetting.record({ ...ok, how: "Certificate 001234567890" }, TODAY), "INVALID");
      await rejects(repo.vetting.record({ ...ok, note: "number is 001234567890" }, TODAY), "INVALID");
      await rejects(repo.vetting.record({ ...ok, checkedOn: "2026-11-10" }, TODAY), "INVALID");
      await rejects(repo.vetting.record({ ...ok, checkedOn: "2026-02-30" }, TODAY), "INVALID");
      await rejects(repo.vetting.record({ ...ok, expiresOn: "2026-11-01" }, TODAY), "INVALID");
      await rejects(repo.vetting.record({ ...ok, how: "" }, TODAY), "INVALID");
      await rejects(repo.vetting.record({ ...ok, kind: "PASSPORT_NUMBER" as never }, TODAY), "INVALID");
      await rejects(repo.vetting.record({ ...ok, tutorId: "00000000-0000-4000-8000-000000000000" }, TODAY), "NOT_FOUND");
      assert.deepEqual(await repo.vetting.list(tutorId), [], "a refused check stores nothing");
    });

    test("vetting: a mistake is voided with a reason and drops out of the register", async () => {
      const tutorId = await h.tutor();
      const wrong = await repo.vetting.record({ tutorId, kind: "REFERENCES", checkedOn: "2026-10-01", expiresOn: null, how: "Two referees phoned", note: "", recordedBy: admin }, TODAY);
      await rejects(repo.vetting.void(wrong.id, "", admin), "INVALID");
      await repo.vetting.void(wrong.id, "Recorded against the wrong tutor", admin);
      assert.deepEqual(await repo.vetting.list(tutorId), []);
      await rejects(repo.vetting.void(wrong.id, "Recorded against the wrong tutor", admin), "NOT_FOUND");
      await rejects(repo.vetting.void("not-an-id", "Some reason", admin), "NOT_FOUND");
    });

    // ---- concerns --------------------------------------------------------------------------------------------------------------------

    const concern = (raisedBy: string, over: Partial<NewConcern> = {}): NewConcern => ({
      raisedBy, raisedByRole: "TUTOR", category: "CHILD_WELFARE", about: "A learner in my Tuesday lesson", studentRef: null, lessonRef: null,
      details: "The learner seemed frightened and said something that worried me.", immediateDanger: false, ...over,
    });

    test("concerns: the named leads come only from the configured list", () => {
      assert.equal(isSafeguardingLead({ id: "a", email: " Lead@Example.test " }, LEADS), true);
      assert.equal(isSafeguardingLead({ id: "a", email: "admin@example.test" }, LEADS), false);
      assert.deepEqual(parseLeads(undefined).emails, [], "nobody is a lead until someone is named");
      assert.deepEqual(parseLeads("not-an-address, , *").emails, [], "a typo never makes everyone a lead");
    });

    test("concerns: raising one stores it, and gives back a receipt with no content", async () => {
      const tutor = await h.login();
      const receipt = await raiseConcern(repo, concern(tutor, { immediateDanger: true }));
      assert.match(receipt.reference, /^SC-\d{8}-[0-9A-F]{6}$/);
      assert.deepEqual(Object.keys(receipt).sort(), ["id", "raisedAt", "reference", "status"]);
      assert.equal(receipt.status, "OPEN");
      const stored = await repo.concerns.get(receipt.id);
      assert.equal(stored?.immediateDanger, true);
      assert.deepEqual((await repo.concerns.events(receipt.id)).map((e) => [e.kind, e.actorId]), [["RAISED", tutor]]);
    });

    test("concerns: an incomplete concern is refused and nothing is stored", async () => {
      const tutor = await h.login();
      const before = (await repo.concerns.list()).length;
      await rejects(raiseConcern(repo, concern(tutor, { details: "short" })), "INVALID");
      await rejects(raiseConcern(repo, concern(tutor, { about: "" })), "INVALID");
      await rejects(raiseConcern(repo, concern(tutor, { category: "GOSSIP" as never })), "INVALID");
      await rejects(raiseConcern(repo, concern(tutor, { raisedByRole: "CLIENT" as never })), "INVALID");
      assert.equal((await repo.concerns.list()).length, before);
    });

    test("concerns: only a named lead can list or open one; anyone else is refused and the attempt is recorded", async () => {
      const tutor = await h.login();
      const otherAdmin = { id: await h.login(), email: "brian@example.test" };
      const lead = { id: await h.login(), email: "lead@example.test" };
      const receipt = await raiseConcern(repo, concern(tutor));

      // The tutor who raised it, another administrator, and nobody-with-an-empty-list: all refused.
      assert.deepEqual(await listConcerns(repo, { id: tutor, email: "tutor@example.test" }, LEADS), { ok: false, reason: "not_lead" });
      assert.deepEqual(await listConcerns(repo, otherAdmin, LEADS), { ok: false, reason: "not_lead" });
      assert.deepEqual(await readConcern(repo, receipt.id, { id: tutor, email: "tutor@example.test" }, LEADS), { ok: false, reason: "not_lead" });
      assert.deepEqual(await readConcern(repo, receipt.id, otherAdmin, LEADS), { ok: false, reason: "not_lead" });
      assert.deepEqual(await readConcern(repo, receipt.id, lead, parseLeads("")), { ok: false, reason: "not_lead" }, "with no leads configured nobody reads");
      assert.deepEqual(await updateConcern(repo, receipt.id, otherAdmin, LEADS, { status: "CLOSED" }), { ok: false, reason: "not_lead" });
      assert.equal((await repo.concerns.get(receipt.id))?.status, "OPEN", "a refused update changes nothing");
      // A refused person learns nothing about whether an id exists.
      assert.deepEqual(await readConcern(repo, "00000000-0000-4000-8000-000000000000", otherAdmin, LEADS), { ok: false, reason: "not_lead" });

      const opened = await readConcern(repo, receipt.id, lead, LEADS);
      assert.ok(opened.ok);
      assert.equal(opened.value.concern.details, "The learner seemed frightened and said something that worried me.");
      const kinds = opened.value.events.map((e) => e.kind);
      assert.deepEqual(kinds, ["RAISED", "ACCESS_REFUSED", "ACCESS_REFUSED", "ACCESS_REFUSED", "ACCESS_REFUSED", "VIEWED"], "every refusal and the opening are on the record");
      assert.equal(opened.value.events.at(-1)!.actorId, lead.id);
      const listed = await listConcerns(repo, lead, LEADS);
      assert.ok(listed.ok && listed.value.some((c) => c.id === receipt.id));
      assert.deepEqual(await readConcern(repo, "00000000-0000-4000-8000-000000000000", lead, LEADS), { ok: false, reason: "not_found" });
    });

    test("concerns: the person who raised one sees a receipt afterwards, never the content, and never someone else's", async () => {
      const tutorA = await h.login();
      const tutorB = await h.login();
      const a = await raiseConcern(repo, concern(tutorA));
      await raiseConcern(repo, concern(tutorB, { about: "Another learner entirely" }));
      const mine = await myConcernReceipts(repo, tutorA);
      assert.deepEqual(mine.map((r) => r.id), [a.id]);
      assert.equal(JSON.stringify(mine).includes("frightened"), false);
      assert.equal(JSON.stringify(mine).includes("Tuesday"), false);
    });

    test("concerns: a lead moves it on and adds notes; the concern's own words never change", async () => {
      const tutor = await h.login();
      const lead = { id: await h.login(), email: "deputy@example.test" };
      const receipt = await raiseConcern(repo, concern(tutor));
      const reviewing = await updateConcern(repo, receipt.id, lead, LEADS, { status: "IN_REVIEW", note: "Spoke to the tutor" });
      assert.ok(reviewing.ok && reviewing.value.status === "IN_REVIEW");
      await updateConcern(repo, receipt.id, lead, LEADS, { note: "Parent phoned" });
      await rejects(updateConcern(repo, receipt.id, lead, LEADS, {}), "INVALID");
      await rejects(updateConcern(repo, receipt.id, lead, LEADS, { status: "DELETED" as never }), "INVALID");
      const closed = await updateConcern(repo, receipt.id, lead, LEADS, { status: "CLOSED" });
      assert.ok(closed.ok && closed.value.status === "CLOSED");
      const after = await repo.concerns.get(receipt.id);
      assert.equal(after?.details, "The learner seemed frightened and said something that worried me.");
      const events = await repo.concerns.events(receipt.id);
      assert.deepEqual(events.map((e) => e.kind), ["RAISED", "STATUS", "NOTE", "STATUS"]);
      assert.equal(events[1]!.note, "OPEN to IN_REVIEW: Spoke to the tutor");
      assert.equal((await myConcernReceipts(repo, tutor))[0]!.status, "CLOSED", "the reporter sees where it has got to");
    });

    test("teardown", async () => {
      await close();
    });
  });
}
