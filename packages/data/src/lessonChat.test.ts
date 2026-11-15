import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  allowAllScanner, canRead, canRemove, canSend, checkUpload, cleanDisplayName, createLessonChatService, DEFAULT_LESSON_CHAT_CONFIG, InMemoryFileStore, InMemoryLessonChatRepository,
  readLessonChatConfig, sniffType, stripJpeg, stripPng, type ChatActor, type ChatLesson, type FileScanner, type LessonChatConfig,
} from "./lessonChat";

// Lesson chat (docs/LESSON_CHAT.md). Every person here is synthetic. The negative cases are the point: each plants someone who must be refused.

const START = Date.parse("2026-11-16T16:00:00Z");
const MIN = 60_000;
const lesson = (over: Partial<ChatLesson> = {}): ChatLesson => ({ id: "lesson-1", tutorId: "tutor-1", studentIds: ["student-1"], clientIds: ["client-1"], startAt: new Date(START).toISOString(), durationMinutes: 60, status: "PLANNED", ...over });

const actor = (over: Partial<ChatActor>): ChatActor => ({ accountId: "acct", name: "Someone", roles: [], tutorId: null, studentId: null, clientId: null, isSafeguardingLead: false, ...over });
const tutor = actor({ accountId: "acct-tutor", name: "Tutor One", roles: ["TUTOR"], tutorId: "tutor-1" });
const student = actor({ accountId: "acct-student", name: "Student One", roles: ["STUDENT"], studentId: "student-1" });
const parent = actor({ accountId: "acct-parent", name: "Parent One", roles: ["CLIENT"], clientId: "client-1" });
const otherParent = actor({ accountId: "acct-parent-2", roles: ["CLIENT"], clientId: "client-2" });
const otherTutor = actor({ accountId: "acct-tutor-2", roles: ["TUTOR"], tutorId: "tutor-2" });
const otherStudent = actor({ accountId: "acct-student-2", roles: ["STUDENT"], studentId: "student-2" });
const junior = actor({ accountId: "acct-junior", roles: ["JUNIOR_TUTOR"], tutorId: "tutor-1" });
const admin = actor({ accountId: "acct-admin", roles: ["ADMIN"] });
const lead = actor({ accountId: "acct-lead", roles: ["TUTOR"], tutorId: "tutor-9", isSafeguardingLead: true });

const at = (offsetMinutes: number) => new Date(START + offsetMinutes * MIN);
const config = (over: Partial<LessonChatConfig> = {}): LessonChatConfig => ({ ...DEFAULT_LESSON_CHAT_CONFIG, messagesPerMinute: 1000, ...over });

// ---- sample files ----------------------------------------------------------------------------------------------------------------------------

const u8 = (...parts: Array<number[] | Uint8Array | string>) => {
  const arrays = parts.map((p) => (typeof p === "string" ? Uint8Array.from(Buffer.from(p, "latin1")) : Uint8Array.from(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
};
const be16 = (n: number) => [n >> 8, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function pngChunk(type: string, data: Uint8Array | number[] | string = []) {
  const body = typeof data === "string" ? u8(data) : Uint8Array.from(data);
  return u8(be32(body.length), type, body, [0, 0, 0, 0]);
}
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = () => u8(PNG_SIG, pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]), pngChunk("tEXt", "Author\0SECRET-AUTHOR-NAME"), pngChunk("eXIf", "SECRET-EXIF-GPS"), pngChunk("tIME", [7, 234, 11, 16, 12, 0, 0]), pngChunk("IDAT", [1, 2, 3]), pngChunk("IEND"));

/** A tiny JPEG: JFIF header, an EXIF block holding a secret and an orientation tag, a quantisation table, a frame header, a scan. */
function jpeg(orientation: number) {
  const tiff = u8([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0], [2, 0], [0x0e, 0x01, 2, 0, 1, 0, 0, 0, 65, 0, 0, 0], [0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0], [0, 0, 0, 0]);
  const exif = u8("Exif\0\0", tiff, "SECRET-GPS-LAT-51.5");
  return u8([0xff, 0xd8], [0xff, 0xe0], be16(16), "JFIF\0\x01\x01\0\0\x01\0\x01\0\0", [0xff, 0xe1], be16(exif.length + 2), exif, [0xff, 0xfe], be16(9), "SECRET!", [0xff, 0xdb], be16(5), [1, 2, 3], [0xff, 0xc0], be16(11), [8, 0, 1, 0, 1, 1, 1, 0x11, 0], [0xff, 0xda], be16(8), [1, 1, 0, 0, 0x3f, 0], [9, 9, 9], [0xff, 0xd9]);
}
const pdf = (extra = "") => u8(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n${extra}\n%%EOF`);
const contains = (bytes: Uint8Array, text: string) => Buffer.from(bytes).toString("latin1").includes(text);

// ---- the service, wired to in-memory storage ------------------------------------------------------------------------------------------------

function world(over: { lessons?: ChatLesson[]; config?: Partial<LessonChatConfig>; scanner?: FileScanner; now?: () => Date } = {}) {
  const lessons = over.lessons ?? [lesson()];
  const repo = new InMemoryLessonChatRepository();
  const files = new InMemoryFileStore();
  let clock = at(10);
  const service = createLessonChatService({
    lessons: { get: async (id) => lessons.find((l) => l.id === id) ?? null },
    repo, files, scanner: over.scanner ?? allowAllScanner, config: config(over.config), urlSecret: "test-only-url-secret-not-real", now: over.now ?? (() => clock),
  });
  return { service, repo, files, setNow: (d: Date) => { clock = d; }, now: () => clock };
}

describe("when a message may be sent: the scheduled window, in Europe/London", () => {
  test("allowed from the scheduled start up to (not including) the scheduled end, and only then", async () => {
    const w = world();
    for (const [minute, ok] of [[-1, false], [0, true], [30, true], [59, true], [60, false], [61, false]] as const) {
      w.setNow(at(minute));
      const result = await w.service.sendText(tutor, "lesson-1", "hello");
      assert.equal(result.ok, ok, `minute ${minute}`);
      if (!result.ok) assert.equal(result.code, minute < 0 ? "TOO_EARLY" : "TOO_LATE");
    }
  });

  test("before the start, after the end and on a cancelled lesson are rejected, for tutor and student alike", async () => {
    for (const [name, who] of [["tutor", tutor], ["student", student]] as const) {
      const w = world();
      w.setNow(at(-30));
      assert.deepEqual(await w.service.sendText(who, "lesson-1", "early"), { ok: false, status: 403, code: "TOO_EARLY", message: "Messages can only be sent once the lesson has started." }, `${name} before`);
      w.setNow(at(120));
      assert.equal((await w.service.sendText(who, "lesson-1", "late")) .ok, false, `${name} after`);
      const cancelled = world({ lessons: [lesson({ status: "CANCELLED" })] });
      cancelled.setNow(at(30));
      const result = await cancelled.service.sendText(who, "lesson-1", "hi");
      assert.equal(result.ok, false);
      assert.equal((result as { code: string }).code, "LESSON_CANCELLED", `${name} cancelled`);
      assert.equal((await cancelled.repo.listMessages("lesson-1")).length, 0, "nothing stored");
    }
  });

  test("a no-show and a lesson with no usable schedule are not chat-able either", async () => {
    const noShow = world({ lessons: [lesson({ status: "NO_SHOW" })] });
    noShow.setNow(at(30));
    assert.equal((await noShow.service.sendText(tutor, "lesson-1", "hi") as { code: string }).code, "LESSON_CANCELLED");
    for (const bad of [{ startAt: "not a date" }, { startAt: "" }, { durationMinutes: 0 }, { durationMinutes: -30 }, { durationMinutes: Number.NaN }]) {
      const w = world({ lessons: [lesson(bad)] });
      w.setNow(at(30));
      assert.equal((await w.service.sendText(tutor, "lesson-1", "hi") as { code: string }).code, "LESSON_NOT_SCHEDULED", JSON.stringify(bad));
    }
    assert.equal((await world().service.sendText(tutor, "no-such-lesson", "hi") as { status: number }).status, 404);
  });

  test("the window is the scheduled instant, so Europe/London daylight saving cannot shift it (a 17:00 summer lesson is 16:00Z)", () => {
    const summer = lesson({ startAt: "2026-07-14T16:00:00.000Z", durationMinutes: 60 }); // 17:00 to 18:00 in London (BST)
    const cfg = config();
    const t = (iso: string) => new Date(iso);
    assert.equal(canSend(summer, tutor, t("2026-07-14T15:59:59Z"), cfg).ok, false, "16:59 London");
    assert.equal(canSend(summer, tutor, t("2026-07-14T16:00:00Z"), cfg).ok, true, "17:00 London");
    assert.equal(canSend(summer, tutor, t("2026-07-14T16:59:59Z"), cfg).ok, true, "17:59 London");
    assert.equal(canSend(summer, tutor, t("2026-07-14T17:00:00Z"), cfg).ok, false, "18:00 London");
    const winter = lesson({ startAt: "2026-11-16T17:00:00.000Z", durationMinutes: 60 }); // 17:00 in London (GMT)
    assert.equal(canSend(winter, tutor, t("2026-11-16T16:59:59Z"), cfg).ok, false);
    assert.equal(canSend(winter, tutor, t("2026-11-16T17:00:00Z"), cfg).ok, true);
  });

  test("the grace window comes from config: default 0 and 0, and each side widens only its own side", async () => {
    assert.equal(DEFAULT_LESSON_CHAT_CONFIG.graceBeforeMinutes, 0);
    assert.equal(DEFAULT_LESSON_CHAT_CONFIG.graceAfterMinutes, 0);
    assert.equal(readLessonChatConfig({}).graceBeforeMinutes, 0);
    assert.equal(readLessonChatConfig({}).graceAfterMinutes, 0);
    const wide = readLessonChatConfig({ LESSON_CHAT_GRACE_BEFORE_MINUTES: "5", LESSON_CHAT_GRACE_AFTER_MINUTES: "10" });
    assert.deepEqual([wide.graceBeforeMinutes, wide.graceAfterMinutes], [5, 10]);
    for (const [minute, ok] of [[-6, false], [-5, true], [-1, true], [69, true], [70, false], [71, false]] as const) {
      const w = world({ config: { graceBeforeMinutes: 5, graceAfterMinutes: 10 } });
      w.setNow(at(minute));
      assert.equal((await w.service.sendText(student, "lesson-1", "hi")).ok, ok, `with grace 5/10, minute ${minute}`);
    }
    const onlyAfter = world({ config: { graceAfterMinutes: 3 } });
    onlyAfter.setNow(at(-1));
    assert.equal((await onlyAfter.service.sendText(tutor, "lesson-1", "hi")).ok, false, "after-grace does not open the start");
    onlyAfter.setNow(at(62));
    assert.equal((await onlyAfter.service.sendText(tutor, "lesson-1", "hi")).ok, true, "but it does extend the end");
    for (const bad of ["-1", "61", "1.5", "abc"]) assert.throws(() => readLessonChatConfig({ LESSON_CHAT_GRACE_AFTER_MINUTES: bad }), /LESSON_CHAT_GRACE_AFTER_MINUTES/, bad);
    for (const bad of ["-1", "61", "x"]) assert.throws(() => readLessonChatConfig({ LESSON_CHAT_GRACE_BEFORE_MINUTES: bad }), /LESSON_CHAT_GRACE_BEFORE_MINUTES/, bad);
    assert.equal(readLessonChatConfig({ LESSON_CHAT_MAX_FILE_MB: "2" }).maxFileBytes, 2 * 1024 * 1024);
    assert.throws(() => readLessonChatConfig({ LESSON_CHAT_MAX_FILE_MB: "0" }));
  });
});

describe("who may send: the lesson's own tutor and a student enrolled in it, by relationship", () => {
  test("the assigned tutor and an enrolled student may send, and a student may reply inside the same window", async () => {
    const w = world();
    const first = await w.service.sendText(tutor, "lesson-1", "Photograph question 3, please.");
    assert.ok(first.ok);
    assert.equal(first.ok && first.message.senderParty, "tutor");
    w.setNow(at(40));
    const reply = await w.service.sendText(student, "lesson-1", "Here it is.");
    assert.ok(reply.ok);
    assert.equal(reply.ok && reply.message.senderParty, "student");
    assert.deepEqual((await w.repo.listMessages("lesson-1")).map((m) => m.senderParty), ["tutor", "student"]);
  });

  test("a tutor who is not assigned to this lesson is rejected, whatever their role", async () => {
    const w = world();
    const result = await w.service.sendText(otherTutor, "lesson-1", "hi");
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "NOT_PARTICIPANT");
    assert.equal((await w.repo.listMessages("lesson-1")).length, 0);
    // The tutor RECORD must match: holding the role with no record, or with a different one, is not enough.
    assert.equal((await w.service.sendText(actor({ accountId: "x", roles: ["TUTOR"], tutorId: null }), "lesson-1", "hi") as { ok: boolean }).ok, false);
  });

  test("a student from another lesson is rejected, and so is one with no student record", async () => {
    const w = world();
    assert.equal((await w.service.sendText(otherStudent, "lesson-1", "hi") as { code: string }).code, "NOT_PARTICIPANT");
    assert.equal((await w.service.sendText(actor({ accountId: "y", roles: ["STUDENT"], studentId: null }), "lesson-1", "hi")).ok, false);
    // Two lessons, one student each: neither may speak in the other's.
    const two = world({ lessons: [lesson(), lesson({ id: "lesson-2", tutorId: "tutor-2", studentIds: ["student-2"], clientIds: ["client-2"] })] });
    assert.equal((await two.service.sendText(student, "lesson-2", "hi")).ok, false);
    assert.equal((await two.service.sendText(otherStudent, "lesson-1", "hi")).ok, false);
    assert.equal((await two.service.sendText(otherStudent, "lesson-2", "hi")).ok, true);
  });

  test("a parent cannot send, and neither can an administrator or the safeguarding lead who is not in the lesson", async () => {
    const w = world();
    for (const [name, who] of [["parent", parent], ["admin", admin], ["lead", lead]] as const) {
      const result = await w.service.sendText(who, "lesson-1", "hi");
      assert.equal(result.ok, false, name);
      assert.equal((result as { code: string }).code, "NOT_PARTICIPANT", name);
    }
    assert.equal((await w.repo.listMessages("lesson-1")).length, 0);
    const file = await w.service.sendFile(parent, "lesson-1", { name: "a.png", declaredType: "image/png", bytes: png() });
    assert.equal(file.ok, false);
    assert.equal(w.files.size, 0, "nothing was stored for a parent");
  });

  test("a junior tutor cannot send messages or files at all, even in their own assigned lesson", async () => {
    const w = world();
    const text = await w.service.sendText(junior, "lesson-1", "hi");
    assert.equal(text.ok, false);
    assert.equal((text as { code: string }).code, "JUNIOR_TUTOR_CANNOT_SEND");
    const file = await w.service.sendFile(junior, "lesson-1", { name: "a.png", declaredType: "image/png", bytes: png() });
    assert.equal((file as { code: string }).code, "JUNIOR_TUTOR_CANNOT_SEND");
    assert.equal(w.files.size, 0);
    assert.equal((await w.repo.listMessages("lesson-1")).length, 0);
    // But they may READ their lesson, and a junior who is a STUDENT in another lesson may send there as a student.
    assert.equal((await w.service.list(junior, "lesson-1")).ok, true);
    const both = actor({ accountId: "acct-both", roles: ["STUDENT", "JUNIOR_TUTOR"], studentId: "student-2", tutorId: "tutor-1" });
    const second = world({ lessons: [lesson(), lesson({ id: "lesson-2", tutorId: "tutor-2", studentIds: ["student-2"] })] });
    second.setNow(at(10));
    assert.equal((await second.service.sendText(both, "lesson-1", "as junior")).ok, false, "junior on lesson 1");
    assert.equal((await second.service.sendText(both, "lesson-2", "as student")).ok, true, "student on lesson 2");
  });

  test("an administrator who is also the lesson's tutor may send as its tutor, and the tutor role is what allows it", async () => {
    const teachingAdmin = actor({ accountId: "acct-ta", roles: ["ADMIN", "TUTOR"], tutorId: "tutor-1" });
    const w = world();
    assert.equal((await w.service.sendText(teachingAdmin, "lesson-1", "hi")).ok, true);
    assert.equal((await w.service.sendText({ ...teachingAdmin, roles: ["ADMIN"] }, "lesson-1", "hi")).ok, false);
  });

  test("each occurrence of a recurring lesson has its own conversation and its own window", async () => {
    const week1 = lesson({ id: "occ-1", recurrenceId: "series" } as Partial<ChatLesson>);
    const week2 = lesson({ id: "occ-2", startAt: new Date(START + 7 * 24 * 60 * MIN).toISOString(), recurrenceId: "series" } as Partial<ChatLesson>);
    const w = world({ lessons: [week1, week2] });
    w.setNow(at(10));
    assert.equal((await w.service.sendText(tutor, "occ-1", "this week")).ok, true);
    assert.equal((await w.service.sendText(tutor, "occ-2", "next week")).ok, false, "next week's lesson has not started");
    w.setNow(at(7 * 24 * 60 + 10));
    assert.equal((await w.service.sendText(tutor, "occ-2", "next week")).ok, true);
    assert.equal((await w.service.sendText(tutor, "occ-1", "back again")).ok, false, "this week's has ended");
    assert.deepEqual((await w.repo.listMessages("occ-1")).map((m) => m.text), ["this week"]);
    assert.deepEqual((await w.repo.listMessages("occ-2")).map((m) => m.text), ["next week"]);
  });

  test("message text is plain, trimmed, bounded and rate limited", async () => {
    const w = world({ config: { messagesPerMinute: 3 } });
    const stripped = await w.service.sendText(tutor, "lesson-1", "  hi\u0000 <b>there</b>\u0007  ");
    assert.equal(stripped.ok && stripped.message.text, "hi <b>there</b>", "control characters gone; markup left as text (it is never interpreted)");
    for (const bad of ["", "   ", 5, null, undefined, {}, "x".repeat(2001)]) assert.equal((await w.service.sendText(tutor, "lesson-1", bad)).ok, false, JSON.stringify(bad)?.slice(0, 20));
    await w.service.sendText(tutor, "lesson-1", "two");
    const third = await w.service.sendText(tutor, "lesson-1", "three");
    assert.equal(third.ok, true);
    assert.equal((await w.service.sendText(tutor, "lesson-1", "four") as { status: number }).status, 429);
  });
});

describe("who may read: participants, parents afterwards, administrators and the lead (audited)", () => {
  async function chatted() {
    const w = world();
    await w.service.sendText(tutor, "lesson-1", "Question 3?");
    w.setNow(at(20));
    await w.service.sendText(student, "lesson-1", "Here is my answer.");
    return w;
  }

  test("the tutor and the student read their lesson, and nothing is audited for them", async () => {
    const w = await chatted();
    for (const who of [tutor, student, junior]) {
      const result = await w.service.list(who, "lesson-1");
      assert.ok(result.ok);
      assert.equal(result.ok && result.messages.length, 2);
    }
    assert.deepEqual(await w.repo.listAccess(), []);
  });

  test("a parent reads their own child's lesson only AFTER it ends, read-only, and it is logged", async () => {
    const w = await chatted();
    w.setNow(at(30));
    const during = await w.service.list(parent, "lesson-1");
    assert.equal(during.ok, false, "not while the lesson is on");
    assert.equal((during as { code: string }).code, "NOT_YET");
    w.setNow(at(60));
    const after = await w.service.list(parent, "lesson-1");
    assert.ok(after.ok);
    assert.equal(after.ok && after.messages.length, 2);
    assert.equal(after.ok && after.canSend, false, "read-only");
    assert.deepEqual((await w.repo.listAccess()).map((a) => [a.actorKind, a.action, a.actorAccountId]), [["parent", "read_messages", "acct-parent"]]);
  });

  test("a parent of another child cannot read, and neither can another tutor or student", async () => {
    const w = await chatted();
    w.setNow(at(120));
    for (const [name, who] of [["other parent", otherParent], ["other tutor", otherTutor], ["other student", otherStudent], ["nobody", actor({})]] as const) {
      const result = await w.service.list(who, "lesson-1");
      assert.equal(result.ok, false, name);
      assert.equal((result as { code: string }).code, "NOT_ALLOWED", name);
    }
    assert.deepEqual(await w.repo.listAccess(), [], "a refused read is not an access");
    assert.equal((await w.service.list(parent, "no-such-lesson") as { status: number }).status, 404);
  });

  test("administrators and the safeguarding lead can read at any time, and every read is audit-logged with who and when", async () => {
    const w = await chatted();
    w.setNow(at(15));
    const a = await w.service.list(admin, "lesson-1");
    const l = await w.service.list(lead, "lesson-1");
    assert.ok(a.ok && l.ok);
    const log = await w.repo.listAccess("lesson-1");
    assert.deepEqual(log.map((e) => [e.actorKind, e.actorAccountId, e.action, e.at]), [
      ["admin", "acct-admin", "read_messages", at(15).toISOString()],
      ["safeguarding_lead", "acct-lead", "read_messages", at(15).toISOString()],
    ]);
  });
});

describe("no edit, no delete: administrators remove, and it is audited", () => {
  test("the repository offers no way to edit or delete a message, and only an administrator removes one", async () => {
    const methods = Object.getOwnPropertyNames(InMemoryLessonChatRepository.prototype).filter((m) => m !== "constructor");
    assert.deepEqual(methods.sort(), ["addFile", "addMessage", "getFile", "getMessage", "listAccess", "listMessages", "logAccess", "removeMessage"]);
    assert.ok(!methods.some((m) => /update|edit|delete|destroy|purge/i.test(m)));
    assert.equal(canRemove(admin), true);
    for (const who of [tutor, student, parent, junior, lead, otherTutor]) assert.equal(canRemove(who), false);
    const w = world();
    const sent = await w.service.sendText(tutor, "lesson-1", "oops, wrong lesson");
    assert.ok(sent.ok);
    const id = sent.ok ? sent.message.id : "";
    for (const who of [tutor, student, parent, lead]) {
      const refused = await w.service.remove(who, "lesson-1", id, "wanted it gone");
      assert.equal((refused as { code: string }).code, "NOT_ADMIN");
    }
    assert.equal((await w.repo.getMessage(id))!.removed, null);
  });

  test("a removal marks the message, hides it from participants and parents, keeps it for administrators and the lead, and is logged", async () => {
    const w = world();
    const sent = await w.service.sendText(student, "lesson-1", "something that must go");
    const id = sent.ok ? sent.message.id : "";
    w.setNow(at(70));
    assert.equal((await w.service.remove(admin, "lesson-1", id, "Not appropriate")).ok, true);
    assert.equal((await w.service.remove(admin, "lesson-1", id, "again") as { status: number }).status, 409, "once");
    assert.equal((await w.service.remove(admin, "lesson-2", id, "wrong lesson") as { status: number }).status, 404, "the message must belong to the lesson named");
    assert.equal((await w.service.remove(admin, "lesson-1", id, "") as { status: number }).status, 400, "a reason is required");
    const stored = (await w.repo.getMessage(id))!;
    assert.equal(stored.text, "something that must go", "never deleted");
    assert.deepEqual([stored.removed?.by, stored.removed?.reason], ["acct-admin", "Not appropriate"]);

    for (const who of [tutor, student, parent]) {
      const list = await w.service.list(who, "lesson-1");
      assert.ok(list.ok);
      const m = list.ok ? list.messages[0]! : null;
      assert.equal(m?.text, "", `${who.accountId} sees no text`);
      assert.equal(m?.senderName, "");
      assert.ok(m?.removed);
      assert.equal(m?.removed?.reason, undefined, "nor the reason");
    }
    const adminView = await w.service.list(admin, "lesson-1");
    assert.equal(adminView.ok && adminView.messages[0]!.text, "something that must go");
    assert.equal(adminView.ok && adminView.messages[0]!.removed?.reason, "Not appropriate");
    const leadView = await w.service.list(lead, "lesson-1");
    assert.equal(leadView.ok && leadView.messages[0]!.text, "something that must go");
    const actions = (await w.repo.listAccess("lesson-1")).filter((e) => e.action === "remove_message");
    assert.deepEqual(actions.map((e) => [e.actorKind, e.actorAccountId, e.targetId, e.at]), [["admin", "acct-admin", id, at(70).toISOString()]]);
  });
});

describe("files: allowlist, size, names, metadata, private storage and signed links", () => {
  const send = (w: ReturnType<typeof world>, over: Partial<{ name: unknown; declaredType: unknown; bytes: Uint8Array; caption: unknown }> = {}) =>
    w.service.sendFile(student, "lesson-1", { name: "diagram.png", declaredType: "image/png", bytes: png(), ...over });

  test("png, jpg and pdf are accepted", async () => {
    const w = world();
    assert.ok((await send(w)).ok);
    assert.ok((await send(w, { name: "photo.jpg", declaredType: "image/jpeg", bytes: jpeg(1) })).ok);
    assert.ok((await send(w, { name: "photo.JPEG", declaredType: "image/jpeg", bytes: jpeg(1) })).ok);
    assert.ok((await send(w, { name: "paper.pdf", declaredType: "application/pdf", bytes: pdf() })).ok);
    assert.equal(w.files.size, 4);
  });

  test("any other type is rejected: by the bytes, by the name, by the claimed type, and where they disagree", async () => {
    const w = world();
    const exe = u8("MZ\x90\x00", new Uint8Array(100));
    const cases: Array<[string, Partial<{ name: unknown; declaredType: unknown; bytes: Uint8Array }>]> = [
      ["a program called .png", { name: "x.png", declaredType: "image/png", bytes: exe }],
      ["a program with an image type", { name: "x.exe", declaredType: "image/png", bytes: png() }],
      ["a png sent as a pdf", { name: "x.pdf", declaredType: "application/pdf", bytes: png() }],
      ["a png with a jpg name", { name: "x.jpg", declaredType: "image/png", bytes: png() }],
      ["a double extension", { name: "x.png.exe", declaredType: "image/png", bytes: png() }],
      ["no extension", { name: "diagram", declaredType: "image/png", bytes: png() }],
      ["a gif", { name: "x.gif", declaredType: "image/gif", bytes: u8("GIF89a", new Uint8Array(20)) }],
      ["an svg", { name: "x.svg", declaredType: "image/svg+xml", bytes: u8("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>") }],
      ["html", { name: "x.html", declaredType: "text/html", bytes: u8("<html><script>alert(1)</script>") }],
      ["a zip", { name: "x.zip", declaredType: "application/zip", bytes: u8("PK\x03\x04", new Uint8Array(30)) }],
      ["a missing type", { name: "x.png", declaredType: undefined, bytes: png() }],
    ];
    for (const [label, over] of cases) {
      const result = await send(w, over);
      assert.equal(result.ok, false, label);
      assert.equal((result as { status: number }).status, 415, label);
    }
    assert.equal(w.files.size, 0, "nothing stored");
    assert.equal((await w.repo.listMessages("lesson-1")).length, 0, "nothing posted");
  });

  test("an oversized file is rejected before anything is stored, and the cap comes from config; an empty file is rejected too", async () => {
    const w = world({ config: { maxFileBytes: 1000 } });
    const big = u8(png(), new Uint8Array(2000));
    const result = await send(w, { bytes: big });
    assert.equal(result.ok, false);
    assert.equal((result as { status: number; code: string }).status, 413);
    assert.equal((result as { code: string }).code, "FILE_TOO_LARGE");
    assert.equal((await send(w, { bytes: new Uint8Array(0) }) as { code: string }).code, "FILE_EMPTY");
    assert.equal(w.files.size, 0);
    const roomy = world({ config: { maxFileBytes: 5000 } });
    assert.ok((await send(roomy, { bytes: u8(png(), new Uint8Array(0)) })).ok);
    assert.equal(checkUpload({ name: "a.png", declaredType: "image/png", bytes: new Uint8Array(1001) }, 1000).ok, false);
  });

  test("path-traversal and other unsafe file names are rejected, never cleaned into something that works", async () => {
    const w = world();
    const evil = ["../../etc/passwd.png", "..\\..\\windows\\a.png", "/etc/passwd.png", "C:\\boot.png", "c:file.png", "a/b.png", "a\\b.png", "..png", "a..b.png", ".htaccess.png", "%2e%2e%2fa.png", "%2E%2E%5Ca.png", "a\u0000.png", "a\n.png", "a:stream.png", "x".repeat(200) + ".png", "", "   .png", 42, null, undefined, {}];
    for (const name of evil) {
      const result = await send(w, { name });
      assert.equal(result.ok, false, JSON.stringify(name)?.slice(0, 30));
      assert.equal((result as { code: string }).code, "FILE_NAME_NOT_ALLOWED", JSON.stringify(name)?.slice(0, 30));
    }
    assert.equal(w.files.size, 0);
    assert.equal(cleanDisplayName("my diagram (2).png"), "my diagram (2).png");
    assert.equal(cleanDisplayName("Q3 <answer>.png"), "Q3 _answer_.png", "odd characters are replaced, for display only");
  });

  test("the stored file has a generated name and key: nothing the user sent is in either", async () => {
    const w = world();
    const result = await send(w, { name: "Alex Smith year 10 homework.png" });
    assert.ok(result.ok);
    const [key] = w.files.keys();
    assert.match(key!, /^lessons\/lesson-1\/[0-9a-f-]{36}\.png$/);
    assert.ok(!/alex|smith|homework/i.test(key!));
    const file = await w.repo.getFile((result.ok && result.message.file!.id) as string);
    assert.equal(file?.storageKey, key);
    assert.equal(file?.displayName, "Alex Smith year 10 homework.png", "the user's name is for display only");
  });

  test("EXIF and other embedded metadata are stripped from images; a photo's orientation survives, and the image data is untouched", () => {
    const original = jpeg(6);
    assert.ok(contains(original, "SECRET-GPS-LAT-51.5") && contains(original, "SECRET!"));
    const stripped = stripJpeg(original)!;
    assert.ok(stripped, "still a jpeg");
    assert.equal(sniffType(stripped), "image/jpeg");
    assert.ok(!contains(stripped, "SECRET-GPS-LAT-51.5"), "location gone");
    assert.ok(!contains(stripped, "SECRET!"), "comment gone");
    assert.ok(contains(stripped, "JFIF"), "the JFIF header is kept");
    assert.ok(contains(stripped, "Exif"), "a minimal orientation block");
    assert.ok(stripped.length < original.length);
    // The orientation tag is the one thing kept: value 6 at the end of a 26-byte TIFF.
    const text = Buffer.from(stripped);
    const exifAt = text.indexOf("Exif\0\0", 0, "latin1");
    assert.equal(text[exifAt + 6 + 18], 6, "orientation 6");
    assert.ok(Buffer.from(stripped).includes(Buffer.from([0xff, 0xda])) && Buffer.from(stripped).includes(Buffer.from([9, 9, 9])), "the scan data is copied byte for byte");
    // An upright photo needs no orientation block at all.
    assert.ok(!contains(stripJpeg(jpeg(1))!, "Exif"));
    assert.equal(stripJpeg(u8([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])), null, "a truncated jpeg is refused, not guessed at");
    assert.equal(stripJpeg(u8("not a jpeg")), null);
    const png1 = stripPng(png())!;
    assert.ok(png1);
    for (const secret of ["SECRET-AUTHOR-NAME", "SECRET-EXIF-GPS"]) assert.ok(!contains(png1, secret));
    for (const chunk of ["tEXt", "eXIf", "tIME"]) assert.ok(!contains(png1, chunk), chunk);
    for (const chunk of ["IHDR", "IDAT", "IEND"]) assert.ok(contains(png1, chunk), chunk);
    assert.equal(stripPng(u8(PNG_SIG, pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]))), null, "no IEND: refused");
  });

  test("what is stored is the stripped file, and a corrupt image is refused", async () => {
    const w = world();
    const result = await send(w, { name: "p.jpg", declaredType: "image/jpeg", bytes: jpeg(3) });
    assert.ok(result.ok);
    const stored = await w.files.get(w.files.keys()[0]!);
    assert.ok(!contains(stored!.bytes, "SECRET-GPS-LAT-51.5"), "the original EXIF is not in private storage");
    const corrupt = await send(w, { name: "p.jpg", declaredType: "image/jpeg", bytes: u8([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2]) });
    assert.equal((corrupt as { code: string }).code, "FILE_CORRUPT");
  });

  test("a pdf with active content is refused", async () => {
    const w = world();
    for (const active of ["/JavaScript (app.alert(1))", "/Launch /Win", "/EmbeddedFile", "/JS (x)"]) {
      assert.equal((await send(w, { name: "p.pdf", declaredType: "application/pdf", bytes: pdf(active) }) as { code: string }).code, "FILE_UNSAFE", active);
    }
  });

  test("the malware-scan hook: every upload is scanned, and anything but clean (a failing scanner too) is refused and not stored", async () => {
    const seen: string[] = [];
    const scanner: FileScanner = { scan: async (bytes, meta) => { seen.push(`${meta.contentType}:${meta.lessonId}:${bytes.length > 0}`); return { status: "clean" }; } };
    const ok = world({ scanner });
    assert.ok((await send(ok)).ok);
    assert.deepEqual(seen, ["image/png:lesson-1:true"]);
    for (const bad of [{ scan: async () => ({ status: "infected" as const, detail: "Eicar" }) }, { scan: async () => ({ status: "error" as const, detail: "down" }) }, { scan: async (): Promise<never> => { throw new Error("socket closed"); } }]) {
      const w = world({ scanner: bad });
      const result = await send(w);
      assert.equal(result.ok, false);
      assert.equal((result as { code: string }).code, "FILE_SCAN_FAILED");
      assert.equal(w.files.size, 0);
      assert.equal((await w.repo.listMessages("lesson-1")).length, 0);
    }
    const refusedBefore: string[] = [];
    const spy: FileScanner = { scan: async () => { refusedBefore.push("scanned"); return { status: "clean" }; } };
    const w = world({ scanner: spy });
    await w.service.sendFile(parent, "lesson-1", { name: "a.png", declaredType: "image/png", bytes: png() });
    await send(w, { bytes: u8("MZ") });
    assert.deepEqual(refusedBefore, [], "a person who may not send, and a file that is not allowed, are never scanned");
  });

  test("a file is reached only by a short-lived signed link: valid for this person, this lesson and this file", async () => {
    const w = world({ lessons: [lesson(), lesson({ id: "lesson-2", tutorId: "tutor-2", studentIds: ["student-2"], clientIds: ["client-2"] })] });
    const sent = await send(w);
    assert.ok(sent.ok);
    const listed = await w.service.list(tutor, "lesson-1");
    assert.ok(listed.ok);
    const url = new URL("http://x" + (listed.ok ? listed.messages[0]!.file!.url : ""));
    const fileId = url.pathname.split("/").pop()!;
    const link = { u: url.searchParams.get("u")!, exp: url.searchParams.get("exp")!, sig: url.searchParams.get("sig")! };
    assert.match(url.pathname, /^\/api\/lessons\/lesson-1\/files\/[0-9a-f-]{36}$/);
    assert.equal(Number(link.exp) - w.now().getTime(), 60_000, "a minute");

    const opened = await w.service.openFile(tutor, "lesson-1", fileId, link);
    assert.ok(opened.ok);
    assert.equal(opened.ok && opened.contentType, "image/png");

    // Fetching the same file through ANOTHER lesson fails, whoever asks and whatever the link says.
    assert.equal((await w.service.openFile(otherTutor, "lesson-2", fileId, link) as { code: string }).code, "BAD_LINK", "the link is for lesson-1");
    assert.equal((await w.service.openFile(tutor, "lesson-2", fileId, link) as { code: string }).code, "BAD_LINK");
    // Someone else's link, an altered link, an expired link and a missing signature all fail.
    assert.equal((await w.service.openFile(student, "lesson-1", fileId, link) as { code: string }).code, "BAD_LINK", "a link made for the tutor, used by the student");
    assert.equal((await w.service.openFile(tutor, "lesson-1", fileId, { ...link, exp: String(Number(link.exp) + 1000) }) as { code: string }).code, "BAD_LINK", "expiry cannot be extended");
    assert.equal((await w.service.openFile(tutor, "lesson-1", fileId, { ...link, sig: link.sig.slice(0, -2) + "xx" }) as { code: string }).code, "BAD_LINK");
    assert.equal((await w.service.openFile(tutor, "lesson-1", fileId, { ...link, sig: "" }) as { code: string }).code, "BAD_LINK");
    assert.equal((await w.service.openFile(tutor, "lesson-1", "not-a-file", link) as { code: string }).code, "BAD_LINK");
    w.setNow(new Date(Number(link.exp) + 1));
    assert.equal((await w.service.openFile(tutor, "lesson-1", fileId, link) as { code: string }).code, "LINK_EXPIRED");
  });

  test("opening a file re-checks the right to read: a parent only afterwards and audited; another child's parent never; a removed message's file only for administrators", async () => {
    const w = world();
    const sent = await send(w);
    assert.ok(sent.ok);
    const fileId = sent.ok ? sent.message.file!.id : "";
    const linkFor = async (who: ChatActor) => {
      const listed = await w.service.list(who, "lesson-1");
      if (!listed.ok) return null;
      const url = new URL("http://x" + listed.messages[0]!.file!.url);
      return { u: url.searchParams.get("u")!, exp: url.searchParams.get("exp")!, sig: url.searchParams.get("sig")! };
    };
    w.setNow(at(61));
    const parentLink = (await linkFor(parent))!;
    assert.ok((await w.service.openFile(parent, "lesson-1", fileId, parentLink)).ok);
    assert.equal(await linkFor(otherParent), null, "another family's parent gets no link");
    const asOther = { u: "acct-parent-2", exp: parentLink.exp, sig: parentLink.sig };
    assert.equal((await w.service.openFile(otherParent, "lesson-1", fileId, asOther) as { code: string }).code, "BAD_LINK", "a link made for someone else cannot be relabelled");
    // Audit: the parent's read and the administrator's.
    const adminLink = (await linkFor(admin))!;
    assert.ok((await w.service.openFile(admin, "lesson-1", fileId, adminLink)).ok);
    const reads = (await w.repo.listAccess("lesson-1")).filter((e) => e.action === "read_file").map((e) => [e.actorKind, e.targetId]);
    assert.deepEqual(reads, [["parent", fileId], ["admin", fileId]]);
    // Removal hides the file from everyone but administrators and the lead.
    const messageId = sent.ok ? sent.message.id : "";
    assert.ok((await w.service.remove(admin, "lesson-1", messageId, "inappropriate image")).ok);
    assert.equal((await w.service.openFile(parent, "lesson-1", fileId, parentLink) as { code: string }).code, "NOT_FOUND");
    assert.ok((await w.service.openFile(admin, "lesson-1", fileId, adminLink)).ok, "the administrator can still see what was removed");
  });
});

describe("the policy functions on their own", () => {
  test("read decisions name how the access is recorded", () => {
    const cfg = config();
    const l = lesson();
    assert.deepEqual(canRead(l, tutor, at(10), cfg), { ok: true, kind: "participant", audited: false, seesRemoved: false });
    assert.deepEqual(canRead(l, admin, at(10), cfg), { ok: true, kind: "admin", audited: true, seesRemoved: true });
    assert.deepEqual(canRead(l, lead, at(10), cfg), { ok: true, kind: "safeguarding_lead", audited: true, seesRemoved: true });
    assert.equal(canRead(l, parent, at(60), cfg).ok, true);
    assert.equal(canRead(l, parent, at(59), cfg).ok, false);
    assert.equal(canRead(null, admin, at(10), cfg).ok, false);
  });

  test("a person with several roles is checked against this lesson with each role's own record", () => {
    const cfg = config();
    // A tutor who is also a parent of ANOTHER family: tutor here, not a parent of this lesson's family.
    const tutorAndParent = actor({ roles: ["TUTOR", "CLIENT"], tutorId: "tutor-2", clientId: "client-2" });
    assert.equal(canSend(lesson(), tutorAndParent, at(10), cfg).ok, false);
    assert.equal(canRead(lesson(), tutorAndParent, at(120), cfg).ok, false);
    // A student who is also a tutor's junior: reads as the student here.
    const studentAndJunior = actor({ roles: ["STUDENT", "JUNIOR_TUTOR"], studentId: "student-1", tutorId: "tutor-2" });
    assert.equal(canSend(lesson(), studentAndJunior, at(10), cfg).ok, true, "a student on this lesson");
  });
});
