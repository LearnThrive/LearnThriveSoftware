import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

// docs/improvement/PLAN.md items 6 and 7: an administrator can send a submitted report back to its tutor with a reason, and can set
// whether an assignment's reports need approval. Runs on the in-memory provider; the report repository itself is held to the same
// contract on Postgres in packages/data.

const { getDataProvider } = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");
const { createLessonOrSeries } = loadTsFrom(import.meta.url, "../src/lib/scheduling/schedulingService.ts");
const { getOrCreateDraft, saveDraft, submitReport, approveReport, returnReport, visibleReportFor, effectiveRequireApproval, ReportError } =
  loadTsFrom(import.meta.url, "../src/lib/reports/reportService.ts");

async function submitted(data, assignmentOverrides = {}) {
  const tutor = await data.tutors.create({ name: "Test Tutor", email: `tutor-${crypto.randomUUID()}@example.test`, subjects: ["Physics"], active: true });
  const student = await data.students.create({ name: "Test Student", active: true });
  const assignment = await data.assignments.create({ title: "Physics, test", subject: "Physics", tutorId: tutor.id, studentIds: [student.id], clientIds: [], status: "ACTIVE", ...assignmentOverrides });
  const [lesson] = await createLessonOrSeries(data, { assignment, title: assignment.title, subject: assignment.subject, startAt: "2025-09-02T16:00:00.000Z", durationMinutes: 60, locationType: "ONLINE", reportRequired: true });
  const draft = await getOrCreateDraft(data, lesson.id, tutor.id);
  await saveDraft(data, draft.id, { publicSummary: "Covered forces.", internalTutorNotes: "Seemed tired." });
  const report = await submitReport(data, draft.id, tutor.id);
  return { lesson, tutor, student, assignment, report };
}

test("returnReport: a submitted report goes back to a draft the tutor can edit and submit again", async () => {
  const data = getDataProvider();
  const { lesson, tutor, report } = await submitted(data);
  assert.equal(report.status, "SUBMITTED");
  const returned = await returnReport(data, report.id, "admin-1", "  Please add what was covered  in the second half. ");
  assert.equal(returned.status, "DRAFT");
  assert.equal(returned.publicSummary, "Covered forces.", "the tutor's words are kept");

  const activity = await data.activity.forLesson(lesson.id);
  const last = activity.at(-1);
  assert.equal(last.type, "REPORT_RETURNED");
  assert.equal(last.message, "Lesson report sent back for changes: Please add what was covered in the second half.");
  assert.equal(last.actorId, "admin-1");

  await saveDraft(data, report.id, { publicSummary: "Covered forces, then momentum." });
  assert.equal((await submitReport(data, report.id, tutor.id)).status, "SUBMITTED");
  assert.equal((await approveReport(data, report.id, "admin-1")).status, "APPROVED");
});

test("returnReport: only a report waiting for approval can be sent back, and it needs a reason", async () => {
  const data = getDataProvider();
  const { report, lesson, tutor } = await submitted(data);
  await assert.rejects(() => returnReport(data, report.id, "admin-1", ""), ReportError);
  await assert.rejects(() => returnReport(data, report.id, "admin-1", " x "), ReportError);
  await assert.rejects(() => returnReport(data, report.id, "admin-1", "y".repeat(501)), ReportError);
  await assert.rejects(() => returnReport(data, "no-such-report", "admin-1", "Fix the summary"), ReportError);
  assert.equal((await data.reports.get(report.id)).status, "SUBMITTED", "a refused return changes nothing");
  assert.equal((await data.activity.forLesson(lesson.id)).some((e) => e.type === "REPORT_RETURNED"), false);

  await approveReport(data, report.id, "admin-1");
  await assert.rejects(() => returnReport(data, report.id, "admin-1", "Fix the summary"), ReportError, "an approved report is already with the family");

  const other = await submitted(data);
  await returnReport(data, other.report.id, "admin-1", "Fix the summary");
  await assert.rejects(() => returnReport(data, other.report.id, "admin-1", "Again"), ReportError, "a draft cannot be sent back twice");
  void tutor;
});

test("returnReport: a family sees nothing of a returned report, before or after", async () => {
  const data = getDataProvider();
  const { report } = await submitted(data);
  const family = { id: "client-login", email: "c@example.test", role: "CLIENT", name: "Parent" };
  assert.equal(visibleReportFor(await data.reports.get(report.id), family), null);
  await returnReport(data, report.id, "admin-1", "Fix the summary");
  assert.equal(visibleReportFor(await data.reports.get(report.id), family), null);
});

test("the per-assignment override: required, not required, and back to the platform setting", async () => {
  const data = getDataProvider();
  const { assignment } = await submitted(data);
  const platform = (await data.settings.get()).requireReportApproval;
  assert.equal(await effectiveRequireApproval(data, assignment.id), platform);
  await data.assignments.update(assignment.id, { requireReportApproval: !platform });
  assert.equal(await effectiveRequireApproval(data, assignment.id), !platform);
  await data.assignments.update(assignment.id, { requireReportApproval: null });
  assert.equal(await effectiveRequireApproval(data, assignment.id), platform, "null clears the override");
});

test("both new actions check for an administrator before anything else", () => {
  const reports = readFileSync(new URL("../src/lib/actions/reports.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const enrolment = readFileSync(new URL("../src/lib/actions/enrolment.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const firstLine = (code, name) => code.slice(code.indexOf(`export async function ${name}(`)).split("\n")[1];
  assert.match(firstLine(reports, "returnReportAction"), /await requireRole\(\["ADMIN"\]\)/);
  assert.match(firstLine(enrolment, "setAssignmentReportApprovalAction"), /await requireRole\(\["ADMIN"\]\)/);
  assert.match(enrolment, /\["default", "required", "not_required"\]\.includes\(choice\)/, "anything but the three choices is refused, not coerced");
});
