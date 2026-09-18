import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

const { getDataProvider } = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");
const { createLessonOrSeries } = loadTsFrom(import.meta.url, "../src/lib/scheduling/schedulingService.ts");
const {
  getOrCreateDraft, saveDraft, submitReport, approveReport, visibleReportFor, effectiveRequireApproval, ReportError,
} = loadTsFrom(import.meta.url, "../src/lib/reports/reportService.ts");

async function freshLesson(data, overrides = {}) {
  const tutor = await data.tutors.create({ name: "Test Tutor", email: `tutor-${crypto.randomUUID()}@example.test`, subjects: ["Physics"], active: true });
  const student = await data.students.create({ name: "Test Student", active: true });
  const assignment = await data.assignments.create({
    title: "Physics — Test", subject: "Physics", tutorId: tutor.id, studentIds: [student.id], clientIds: [], status: "ACTIVE", ...overrides,
  });
  const [lesson] = await createLessonOrSeries(data, {
    assignment, title: assignment.title, subject: assignment.subject,
    startAt: "2025-09-02T16:00:00.000Z", durationMinutes: 60, locationType: "ONLINE", reportRequired: true,
  });
  return { lesson, tutor, student, assignment };
}

test("getOrCreateDraft: creates exactly one DRAFT report per lesson, idempotently", async () => {
  const data = getDataProvider();
  const { lesson, tutor } = await freshLesson(data);
  const first = await getOrCreateDraft(data, lesson.id, tutor.id);
  const second = await getOrCreateDraft(data, lesson.id, tutor.id);
  assert.equal(first.id, second.id);
  assert.equal(first.status, "DRAFT");
});

test("saveDraft: refuses to edit a report that is no longer a draft", async () => {
  const data = getDataProvider();
  const { lesson, tutor } = await freshLesson(data);
  const draft = await getOrCreateDraft(data, lesson.id, tutor.id);
  await saveDraft(data, draft.id, { publicSummary: "Covered fractions." });
  await submitReport(data, draft.id, tutor.id);
  await assert.rejects(() => saveDraft(data, draft.id, { publicSummary: "Edited after submit" }), ReportError);
});

test("submitReport: requires a non-empty summary", async () => {
  const data = getDataProvider();
  const { lesson, tutor } = await freshLesson(data);
  const draft = await getOrCreateDraft(data, lesson.id, tutor.id);
  await assert.rejects(() => submitReport(data, draft.id, tutor.id), ReportError);
});

test("submitReport: goes to SUBMITTED when the platform default requires approval", async () => {
  const data = getDataProvider();
  const { lesson, tutor } = await freshLesson(data);
  const draft = await getOrCreateDraft(data, lesson.id, tutor.id);
  await saveDraft(data, draft.id, { publicSummary: "Covered fractions." });
  const submitted = await submitReport(data, draft.id, tutor.id);
  assert.equal(submitted.status, "SUBMITTED");
  assert.ok(submitted.submittedAt);
  assert.equal(submitted.approvedAt, undefined);
});

test("submitReport: goes straight to APPROVED when the Assignment overrides approval off", async () => {
  const data = getDataProvider();
  const { lesson, tutor } = await freshLesson(data, { requireReportApproval: false });
  const draft = await getOrCreateDraft(data, lesson.id, tutor.id);
  await saveDraft(data, draft.id, { publicSummary: "Covered fractions." });
  const submitted = await submitReport(data, draft.id, tutor.id);
  assert.equal(submitted.status, "APPROVED");
  assert.ok(submitted.approvedAt);
});

test("approveReport: refuses to approve anything but a SUBMITTED report", async () => {
  const data = getDataProvider();
  const { lesson, tutor } = await freshLesson(data);
  const draft = await getOrCreateDraft(data, lesson.id, tutor.id);
  await assert.rejects(() => approveReport(data, draft.id, "admin-1"), ReportError);
});

test("approveReport: SUBMITTED -> APPROVED, recording who and when", async () => {
  const data = getDataProvider();
  const { lesson, tutor } = await freshLesson(data);
  const draft = await getOrCreateDraft(data, lesson.id, tutor.id);
  await saveDraft(data, draft.id, { publicSummary: "Covered fractions." });
  await submitReport(data, draft.id, tutor.id);
  const approved = await approveReport(data, draft.id, "admin-1");
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.approvedBy, "admin-1");
});

test("visibleReportFor: the owning Tutor and Admin see every field, including internalTutorNotes, at any status", async () => {
  const data = getDataProvider();
  const { lesson, tutor } = await freshLesson(data);
  const draft = await getOrCreateDraft(data, lesson.id, tutor.id);
  await saveDraft(data, draft.id, { publicSummary: "Covered fractions.", internalTutorNotes: "Secret note." });
  const report = await data.reports.get(draft.id);

  const forTutor = visibleReportFor({ role: "TUTOR", profileId: tutor.id }, report);
  assert.equal(forTutor.internalTutorNotes, "Secret note.");
  const forAdmin = visibleReportFor({ role: "ADMIN" }, report);
  assert.equal(forAdmin.internalTutorNotes, "Secret note.");
});

test("visibleReportFor: a Client/Student sees nothing until the report is APPROVED", async () => {
  const data = getDataProvider();
  const { lesson, tutor } = await freshLesson(data);
  const draft = await getOrCreateDraft(data, lesson.id, tutor.id);
  await saveDraft(data, draft.id, { publicSummary: "Covered fractions." });
  let report = await data.reports.get(draft.id);
  assert.equal(visibleReportFor({ role: "CLIENT", profileId: "client-1" }, report), null);

  await submitReport(data, draft.id, tutor.id);
  report = await data.reports.get(draft.id);
  assert.equal(visibleReportFor({ role: "STUDENT", profileId: "student-1" }, report), null); // still only SUBMITTED
});

test("visibleReportFor: once APPROVED, a Client/Student sees the public fields but never internalTutorNotes or confidence", async () => {
  const data = getDataProvider();
  const { lesson, tutor } = await freshLesson(data, { requireReportApproval: false });
  const draft = await getOrCreateDraft(data, lesson.id, tutor.id);
  await saveDraft(data, draft.id, { publicSummary: "Covered fractions.", internalTutorNotes: "Secret note.", confidence: "LOW" });
  await submitReport(data, draft.id, tutor.id); // auto-approves, since this Assignment overrides approval off
  const report = await data.reports.get(draft.id);

  const visible = visibleReportFor({ role: "CLIENT", profileId: "client-1" }, report);
  assert.equal(visible.publicSummary, "Covered fractions.");
  assert.equal("internalTutorNotes" in visible, false);
  assert.equal("confidence" in visible, false);
});

test("effectiveRequireApproval: falls back to the platform default when the Assignment has no override", async () => {
  const data = getDataProvider();
  const { assignment } = await freshLesson(data);
  assert.equal(await effectiveRequireApproval(data, assignment.id), true); // platform default

  await data.settings.update({ requireReportApproval: false });
  assert.equal(await effectiveRequireApproval(data, assignment.id), false);
});
