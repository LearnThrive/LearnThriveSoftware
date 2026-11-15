import type { DataProvider } from "@learnthrive/data/repositories";
import type { LessonReport, ReportAssessmentLevel } from "@learnthrive/data/domain";
import { logActivity } from "@/lib/activity/activityService";
import { scopes } from "@/lib/auth/scope";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { notifyProfile, notifyProfiles, notifyRole } from "@/lib/notifications/notificationService";

export class ReportError extends Error {}

export interface ReportFieldInput {
  publicSummary: string;
  progress?: string;
  areasForImprovement?: string;
  nextSteps?: string;
  engagement?: ReportAssessmentLevel;
  confidence?: ReportAssessmentLevel;
  internalTutorNotes?: string;
}

/** Plan section 45: a global default (PlatformSettings.requireReportApproval), overridable per
 * Tuition Assignment. */
export async function effectiveRequireApproval(data: DataProvider, assignmentId: string): Promise<boolean> {
  const assignment = await data.assignments.get(assignmentId);
  if (assignment?.requireReportApproval != null) return assignment.requireReportApproval;
  return (await data.settings.get()).requireReportApproval;
}

/** Creates the Lesson's one report as a DRAFT if it doesn't exist yet, or returns the existing
 * one unchanged — the report-editing form always has something to load and save against. */
export async function getOrCreateDraft(data: DataProvider, lessonId: string, tutorId: string): Promise<LessonReport> {
  const existing = await data.reports.forLesson(lessonId);
  if (existing) return existing;
  return data.reports.create({ lessonId, tutorId, status: "DRAFT", publicSummary: "" });
}

/** A DRAFT's fields are freely editable (plan section 68's "allow draft report state" — this is
 * the save-as-you-go path, not the final submit). Once SUBMITTED or APPROVED, editing is blocked
 * — there's no revision workflow yet (see docs/LESSON_REPORTS.md), so treat it as locked rather
 * than silently allowing a change nobody re-reviews. */
export async function saveDraft(data: DataProvider, reportId: string, fields: ReportFieldInput): Promise<LessonReport> {
  const report = await data.reports.get(reportId);
  if (!report) throw new ReportError("Report not found.");
  if (report.status !== "DRAFT") throw new ReportError("Only a draft report can be edited.");
  return data.reports.update(reportId, fields);
}

/** Plan section 44: DRAFT -> SUBMITTED, or straight to APPROVED when the effective
 * requireReportApproval setting is false ("Submitted may become directly visible"). */
export async function submitReport(data: DataProvider, reportId: string, actorId: string): Promise<LessonReport> {
  const report = await data.reports.get(reportId);
  if (!report) throw new ReportError("Report not found.");
  if (report.status !== "DRAFT") throw new ReportError("Only a draft report can be submitted.");
  if (!report.publicSummary.trim()) throw new ReportError("A lesson summary is required before submitting.");

  const lesson = await data.lessons.get(report.lessonId);
  if (!lesson) throw new ReportError("The lesson for this report no longer exists.");
  const needsApproval = await effectiveRequireApproval(data, lesson.assignmentId);

  const submittedAt = new Date().toISOString();
  const updated = needsApproval
    ? await data.reports.update(reportId, { status: "SUBMITTED", submittedAt })
    : await data.reports.update(reportId, { status: "APPROVED", submittedAt, approvedAt: submittedAt });

  await logActivity(data, report.lessonId, "REPORT_SUBMITTED", "Lesson report submitted", actorId);
  if (needsApproval) {
    await notifyRole(data, "ADMIN", "REPORT_AWAITING_APPROVAL", `A report for "${lesson.title}" is awaiting approval.`, `/dashboard/lessons/${lesson.id}`);
  } else {
    await logActivity(data, report.lessonId, "REPORT_APPROVED", "Lesson report auto-approved (approval not required for this assignment)", actorId);
    await notifyProfiles(data, lesson.clientIds, "REPORT_AVAILABLE", `A new report is available for "${lesson.title}".`, `/dashboard/lessons/${lesson.id}`);
  }
  return updated;
}

/** Admin-only in practice (enforced by the calling Server Action, not here) — SUBMITTED -> APPROVED. */
export async function approveReport(data: DataProvider, reportId: string, actorId: string): Promise<LessonReport> {
  const report = await data.reports.get(reportId);
  if (!report) throw new ReportError("Report not found.");
  if (report.status !== "SUBMITTED") throw new ReportError("Only a submitted report can be approved.");

  const lesson = await data.lessons.get(report.lessonId);
  const approvedAt = new Date().toISOString();
  const updated = await data.reports.update(reportId, { status: "APPROVED", approvedAt, approvedBy: actorId });
  await logActivity(data, report.lessonId, "REPORT_APPROVED", "Lesson report approved", actorId);
  if (lesson) await notifyProfiles(data, lesson.clientIds, "REPORT_AVAILABLE", `A new report is available for "${lesson.title}".`, `/dashboard/lessons/${lesson.id}`);
  return updated;
}

/**
 * Admin-only in practice (enforced by the calling Server Action): SUBMITTED -> DRAFT, with a reason the tutor can act on. Only a report
 * that is waiting for approval can be sent back: an approved one is already with the family, and withdrawing that is a different
 * decision. Families never saw a SUBMITTED report, so nothing changes for them. The reason is on the lesson's activity (which only the
 * tutor and administrators see) and in the tutor's notification.
 */
export async function returnReport(data: DataProvider, reportId: string, actorId: string, reason: string): Promise<LessonReport> {
  const report = await data.reports.get(reportId);
  if (!report) throw new ReportError("Report not found.");
  if (report.status !== "SUBMITTED") throw new ReportError("Only a report that is waiting for approval can be sent back.");
  const why = reason.trim().replace(/\s+/g, " ");
  if (why.length < 3) throw new ReportError("Say what needs changing, so the tutor knows.");
  if (why.length > 500) throw new ReportError("Keep the reason to 500 characters.");

  const lesson = await data.lessons.get(report.lessonId);
  const updated = await data.reports.update(reportId, { status: "DRAFT" });
  await logActivity(data, report.lessonId, "REPORT_RETURNED", `Lesson report sent back for changes: ${why}`, actorId);
  if (lesson) await notifyProfile(data, lesson.tutorId, "REPORT_REQUIRED", `Your report for "${lesson.title}" was sent back for changes: ${why}`, `/dashboard/lessons/${lesson.id}`);
  return updated;
}

/** Who is looking: a signed-in person (any roles), or just `{ role, profileId }` (a test, an older caller). */
export type ReportViewer = Pick<AuthenticatedUser, "role"> & Partial<Omit<AuthenticatedUser, "role">>;

/**
 * What this person may see of a report. A person with several roles gets the MOST each role allows on its own, never more: the full report
 * (private notes included) only through a role that earns it (an administrator, or the tutor who wrote it), and otherwise the family's view of
 * an approved one. A student who is also a junior tutor sees the private notes of a lesson they TEACH and only the approved family view of one
 * they attend.
 */
export function visibleReportFor(viewer: ReportViewer, report: LessonReport): VisibleReport | null {
  let limited: VisibleReport | null = null;
  for (const scoped of scopes(viewer as AuthenticatedUser)) {
    const seen = visibleReportForRole(scoped, report);
    if (seen === report) return report;
    limited ??= seen;
  }
  return limited;
}

export type VisibleReport = Pick<LessonReport, "id" | "lessonId" | "tutorId" | "status" | "publicSummary" | "progress" | "areasForImprovement" | "nextSteps" | "engagement" | "submittedAt" | "approvedAt">;

/** The one place that decides what a Client/Student may see — everything else calls this rather
 * than reading `LessonReport` fields directly, so `internalTutorNotes`/`confidence` (Tutor-only)
 * can never leak by a caller simply forgetting to strip them (plan section 43's explicit
 * "never accidentally send internal notes to Parent/Student"). */
function visibleReportForRole(
  viewer: { role: string; profileId?: string },
  report: LessonReport,
): VisibleReport | null {
  if (viewer.role === "ADMIN" || ((viewer.role === "TUTOR" || viewer.role === "JUNIOR_TUTOR") && viewer.profileId === report.tutorId)) {
    return report; // full fields, including internalTutorNotes/confidence
  }
  // Client/Student: only ever an APPROVED report, and never the Tutor-only fields.
  if (report.status !== "APPROVED") return null;
  const { id, lessonId, tutorId, status, publicSummary, progress, areasForImprovement, nextSteps, engagement, submittedAt, approvedAt } = report;
  return { id, lessonId, tutorId, status, publicSummary, progress, areasForImprovement, nextSteps, engagement, submittedAt, approvedAt };
}
