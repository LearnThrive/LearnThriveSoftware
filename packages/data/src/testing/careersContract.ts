/**
 * One behavioural contract for the careers store (launch checklist 3.12), run against memory, Postgres on PGlite and the real local stack.
 * Every application is made by the test itself, and assertions are about those, so a store may hold others.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test } from "node:test";
import { addMonths, CAREERS_RETENTION, retentionFor, type CareersStore, type NewApplication } from "../careers";

export interface CareersHarness {
  store: CareersStore;
  /** A profile id an administrator acts as. */
  admin(): Promise<string>;
}

const PDF_TYPE = "application/pdf";

let counter = 0;
/** A reference in the real format, unique per call. */
function reference(): string {
  counter += 1;
  const tail = `${Date.now().toString(36)}${counter.toString(36)}`.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-6).padStart(6, "A");
  return `LT-APP-20261106-${tail}`;
}

export function application(over: Partial<NewApplication> = {}, files: Array<{ kind?: "CV" | "COVER_LETTER" | "SUPPORTING"; sensitive?: boolean; label?: string }> = [{}]): NewApplication {
  const id = over.id ?? randomUUID();
  return {
    id,
    reference: reference(),
    roleSlug: "maths-tutor",
    firstName: "Jane",
    lastName: "Applicant",
    email: "jane@example.test",
    talentPool: false,
    answers: { subjects: ["Mathematics"], whyTutor: "I like teaching." },
    agreement: { version: "1.0", typedName: "Jane Applicant" },
    files: files.map((f) => {
      const fileId = randomUUID();
      return {
        id: fileId, kind: f.kind ?? "CV", label: f.label ?? "CV", documentType: f.kind === "SUPPORTING" ? (f.sensitive ? "identity" : "qualification") : null,
        sensitive: f.sensitive ?? false, filename: "CV - jane.pdf", contentType: PDF_TYPE, sizeBytes: 1234, storagePath: `${id}/${fileId}.pdf`,
      };
    }),
    ...over,
  };
}

export function careersContract(name: string, make: () => Promise<{ harness: CareersHarness; close(): Promise<void> }>): void {
  describe(`careers store contract: ${name}`, () => {
    let h: CareersHarness;
    let close: () => Promise<void>;
    let s: CareersStore;

    test("setup", async () => {
      ({ harness: h, close } = await make());
      s = h.store;
    });

    test("an application is stored with its files and a RECEIVED event, and reads back as sent", async () => {
      const input = application({}, [{}, { kind: "COVER_LETTER", label: "Cover letter" }, { kind: "SUPPORTING", label: "Identity document", sensitive: true }]);
      const created = await s.create(input);
      assert.equal(created.id, input.id);
      assert.equal(created.status, "NEW");
      assert.equal(created.fileCount, 3);
      assert.equal(created.sensitiveFileCount, 1);
      assert.equal(created.decidedAt, null);
      assert.equal(created.deleteAfter, null);

      const detail = await s.get(input.id);
      assert.ok(detail);
      assert.equal(detail.reference, input.reference);
      assert.deepEqual(detail.answers, input.answers);
      assert.deepEqual(detail.agreement, input.agreement);
      assert.deepEqual(detail.files.map((f) => f.storagePath), input.files.map((f) => f.storagePath), "in the order they were given");
      assert.ok(detail.files.every((f) => f.applicationId === input.id));
      assert.deepEqual(detail.events.map((e) => e.kind), ["RECEIVED"]);
      assert.equal(detail.identitySeen, null);
      assert.equal(detail.dbsSeen, null);

      assert.ok((await s.list()).some((a) => a.id === input.id));
      assert.ok((await s.list({ status: "NEW" })).some((a) => a.id === input.id));
      assert.ok(!(await s.list({ status: "REJECTED" })).some((a) => a.id === input.id));
    });

    test("a file stored outside its application, or a reference used twice, is refused and nothing is stored", async () => {
      const input = application();
      input.files[0]!.storagePath = `${randomUUID()}/${input.files[0]!.id}.pdf`;
      await assert.rejects(s.create(input));
      assert.equal(await s.get(input.id), null);

      const first = await s.create(application());
      const again = application({ reference: first.reference });
      await assert.rejects(s.create(again));
      assert.equal(await s.get(again.id), null, "the second one left nothing behind, not even its files");
    });

    test("a made-up or malformed id finds nothing", async () => {
      assert.equal(await s.get("not-a-uuid"), null);
      assert.equal(await s.get(randomUUID()), null);
      assert.equal(await s.setStatus(randomUUID(), "REVIEWING", await h.admin()), null);
      assert.equal(await s.addNote(randomUUID(), "hello", await h.admin()), null);
      assert.equal(await s.remove(randomUUID(), await h.admin(), "OTHER"), null);
    });

    test("status changes are recorded with who and from what, and a decision starts the retention clock", async () => {
      const admin = await h.admin();
      const app = await s.create(application());
      await s.setStatus(app.id, "REVIEWING", admin);
      const same = await s.setStatus(app.id, "REVIEWING", admin);
      assert.equal(same?.status, "REVIEWING");
      assert.equal(same?.decidedAt, null, "an open status has no decision date");

      const decided = new Date("2026-11-06T10:00:00.000Z");
      const rejected = await s.setStatus(app.id, "REJECTED", admin, decided);
      assert.equal(rejected?.decidedAt, decided.toISOString());
      assert.equal(rejected?.deleteAfter, addMonths(decided, CAREERS_RETENTION.unsuccessfulMonths).toISOString());
      assert.equal(rejected?.identityDeleteAfter, addMonths(decided, CAREERS_RETENTION.identityMonths).toISOString());

      const detail = await s.get(app.id);
      const statuses = detail!.events.filter((e) => e.kind === "STATUS");
      assert.deepEqual(statuses.map((e) => [e.fromStatus, e.toStatus]), [["NEW", "REVIEWING"], ["REVIEWING", "REJECTED"]], "setting the same status twice records it once");
      assert.ok(statuses.every((e) => e.actorId === admin));

      // Reopened: the decision and the dates go, so nothing is deleted while it is being looked at again.
      const reopened = await s.setStatus(app.id, "INTERVIEW", admin);
      assert.equal(reopened?.decidedAt, null);
      assert.equal(reopened?.deleteAfter, null);
      assert.equal(reopened?.identityDeleteAfter, null);
    });

    test("the retention dates follow the rules: 12 months for the talent pool, identity at 6 either way, none for an accepted tutor", async () => {
      const admin = await h.admin();
      const decided = new Date("2026-01-31T09:00:00.000Z");
      const pool = await s.create(application({ talentPool: true }));
      const withdrawn = await s.setStatus(pool.id, "WITHDRAWN", admin, decided);
      assert.equal(withdrawn?.deleteAfter, "2027-01-31T09:00:00.000Z");
      assert.equal(withdrawn?.identityDeleteAfter, "2026-07-31T09:00:00.000Z");

      const hired = await s.create(application());
      const accepted = await s.setStatus(hired.id, "ACCEPTED", admin, decided);
      assert.equal(accepted?.decidedAt, decided.toISOString());
      assert.equal(accepted?.deleteAfter, null);
      assert.equal(accepted?.identityDeleteAfter, null);

      // The month arithmetic does not spill: 31 August plus 6 months is the end of February.
      assert.equal(retentionFor("REJECTED", new Date("2026-08-31T12:00:00.000Z"), false).deleteAfter, "2027-02-28T12:00:00.000Z");
    });

    test("notes are kept in order with their author, trimmed, and an empty one is refused", async () => {
      const admin = await h.admin();
      const app = await s.create(application());
      assert.equal(await s.addNote(app.id, "   ", admin), null);
      await s.addNote(app.id, "  Strong A Level results.  ", admin);
      await s.addNote(app.id, "x".repeat(5000), admin);
      const notes = (await s.get(app.id))!.notes;
      assert.deepEqual(notes.map((n) => n.body.length), ["Strong A Level results.".length, 4000]);
      assert.equal(notes[0]!.body, "Strong A Level results.");
      assert.ok(notes.every((n) => n.authorId === admin));
    });

    test("identity and DBS are recorded as seen, with a date and who, and nothing else", async () => {
      const admin = await h.admin();
      const app = await s.create(application());
      assert.equal(await s.recordIdentitySeen(app.id, "not a date", admin), false);
      assert.equal(await s.recordDbsSeen(app.id, { on: "2026-11-05", how: "COPY" as never }, admin), false);
      assert.equal(await s.recordIdentitySeen(app.id, "2026-11-05", admin), true);
      assert.equal(await s.recordDbsSeen(app.id, { on: "2026-11-04", how: "UPDATE_SERVICE" }, admin), true);
      const detail = await s.get(app.id);
      assert.deepEqual(detail!.identitySeen, { on: "2026-11-05", by: admin });
      assert.deepEqual(detail!.dbsSeen, { on: "2026-11-04", how: "UPDATE_SERVICE", by: admin });
      assert.deepEqual(detail!.events.map((e) => e.kind), ["RECEIVED", "IDENTITY_SEEN", "DBS_SEEN"]);
    });

    test("a file is found only under its own application, and each opening is logged with who", async () => {
      const admin = await h.admin();
      const a = await s.create(application());
      const b = await s.create(application());
      const aFile = (await s.get(a.id))!.files[0]!;
      assert.equal((await s.file(a.id, aFile.id))?.storagePath, aFile.storagePath);
      assert.equal(await s.file(b.id, aFile.id), null, "another application's id does not reach this file");
      assert.equal(await s.file(a.id, randomUUID()), null);

      await s.logFileView(a.id, aFile.id, admin);
      await s.logFileView(b.id, aFile.id, admin); // the wrong pair logs nothing
      const viewed = (await s.get(a.id))!.events.filter((e) => e.kind === "FILE_VIEWED");
      assert.equal(viewed.length, 1);
      assert.equal(viewed[0]!.actorId, admin);
      assert.equal(viewed[0]!.fileId, aFile.id);
      assert.equal(viewed[0]!.detail, "CV");
      assert.equal((await s.get(b.id))!.events.filter((e) => e.kind === "FILE_VIEWED").length, 0);
    });

    test("identity documents can be removed on their own, and the log of who opened them survives", async () => {
      const admin = await h.admin();
      const app = await s.create(application({}, [{}, { kind: "SUPPORTING", label: "Identity document", sensitive: true }, { kind: "SUPPORTING", label: "Right to work", sensitive: true }]));
      const sensitive = (await s.get(app.id))!.files.find((f) => f.sensitive)!;
      await s.logFileView(app.id, sensitive.id, admin);
      assert.equal(await s.removeIdentityFiles(app.id, admin), 2);
      assert.equal(await s.removeIdentityFiles(app.id, admin), 0, "and a second time there is nothing to do");
      const detail = await s.get(app.id);
      assert.equal(detail!.fileCount, 1);
      assert.equal(detail!.sensitiveFileCount, 0);
      const viewed = detail!.events.find((e) => e.kind === "FILE_VIEWED");
      assert.equal(viewed?.fileId, null, "the event no longer points at a file that is gone");
      assert.equal(viewed?.detail, sensitive.label, "but still says which document was opened");
      assert.equal(detail!.events.filter((e) => e.kind === "IDENTITY_FILES_DELETED").length, 1);
    });

    test("deleting an application removes it and everything under it, and the log names no one", async () => {
      const admin = await h.admin();
      const app = await s.create(application({}, [{}, { kind: "COVER_LETTER", label: "Cover letter" }]));
      await s.addNote(app.id, "Note", admin);
      await s.logFileView(app.id, (await s.get(app.id))!.files[0]!.id, admin);

      const logged = await s.remove(app.id, admin, "REQUEST");
      assert.ok(logged);
      assert.equal(logged.files, 2);
      assert.equal(logged.reason, "REQUEST");
      assert.equal(logged.actorId, admin);
      assert.deepEqual(Object.keys(logged).sort(), ["actorId", "at", "files", "id", "reason"], "no reference, name, email or application id");
      assert.equal(await s.get(app.id), null);
      assert.equal(await s.remove(app.id, admin, "REQUEST"), null, "deleting twice logs once");
      assert.equal((await s.deletions(50)).filter((d) => d.id === logged.id).length, 1);
    });

    test("what is due: whole applications by their date, and identity documents only while some are still held", async () => {
      const admin = await h.admin();
      const longAgo = new Date("2020-01-15T09:00:00.000Z");
      const old = await s.create(application({}, [{}, { kind: "SUPPORTING", label: "Identity document", sensitive: true }]));
      await s.setStatus(old.id, "REJECTED", admin, longAgo);
      const pool = await s.create(application({ talentPool: true }, [{}, { kind: "SUPPORTING", label: "Identity document", sensitive: true }]));
      await s.setStatus(pool.id, "REJECTED", admin, new Date("2020-01-15T09:00:00.000Z"));
      const open = await s.create(application());
      const fresh = await s.create(application());
      await s.setStatus(fresh.id, "REJECTED", admin, new Date());

      const at = new Date("2020-08-01T00:00:00.000Z");
      const due = await s.dueBy(at);
      const ids = (list: Array<{ id: string }>) => new Set(list.map((a) => a.id));
      assert.ok(ids(due.applications).has(old.id), "six months after a rejection the application is due");
      assert.ok(!ids(due.applications).has(pool.id), "a talent-pool application is not due until twelve months");
      assert.ok(ids(due.identityDocuments).has(pool.id), "but its identity documents are due at six");
      assert.ok(!ids(due.applications).has(open.id) && !ids(due.identityDocuments).has(open.id), "an open application is never due");
      assert.ok(!ids(due.applications).has(fresh.id));

      await s.removeIdentityFiles(pool.id, admin);
      assert.ok(!ids((await s.dueBy(at)).identityDocuments).has(pool.id), "once the documents are gone they are no longer due");
      // Tidy up the long-ago records so another file's due list is not crowded by these.
      for (const id of [old.id, pool.id, open.id, fresh.id]) await s.remove(id, admin, "OTHER");
    });

    test("teardown", async () => {
      await close();
    });
  });
}
