"use server";

import { revalidatePath } from "next/cache";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { requireRole } from "@/lib/auth/guard";
import { approveReport, getOrCreateDraft, ReportError, saveDraft, submitReport } from "@/lib/reports/reportService";
import type { ReportAssessmentLevel } from "@learnthrive/data/domain";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function level(formData: FormData, key: string): ReportAssessmentLevel | undefined {
  const value = text(formData, key);
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" ? value : undefined;
}

async function requireOwningTutorOrAdmin(lessonId: string) {
  const user = await requireRole(["TUTOR", "ADMIN"]);
  const data = getDataProvider();
  const lesson = await data.lessons.get(lessonId);
  if (!lesson) throw new Error("Lesson not found.");
  if (user.role === "TUTOR" && lesson.tutorId !== user.profileId) throw new Error("You are not the Tutor for this lesson.");
  return { user, data, lesson };
}

export async function saveReportDraftAction(formData: FormData): Promise<void> {
  const lessonId = text(formData, "lessonId");
  if (!lessonId) throw new Error("Lesson is required.");
  const { user, data, lesson } = await requireOwningTutorOrAdmin(lessonId);

  const draft = await getOrCreateDraft(data, lessonId, lesson.tutorId);
  try {
    await saveDraft(data, draft.id, {
      publicSummary: text(formData, "publicSummary"),
      progress: text(formData, "progress") || undefined,
      areasForImprovement: text(formData, "areasForImprovement") || undefined,
      nextSteps: text(formData, "nextSteps") || undefined,
      engagement: level(formData, "engagement"),
      confidence: level(formData, "confidence"),
      internalTutorNotes: text(formData, "internalTutorNotes") || undefined,
    });
  } catch (error) {
    if (error instanceof ReportError) throw new Error(error.message);
    throw error;
  }
  void user;
  revalidatePath(`/dashboard/lessons/${lessonId}`);
}

export async function submitReportAction(formData: FormData): Promise<void> {
  const lessonId = text(formData, "lessonId");
  if (!lessonId) throw new Error("Lesson is required.");
  const { user, data } = await requireOwningTutorOrAdmin(lessonId);

  const report = await data.reports.forLesson(lessonId);
  if (!report) throw new Error("No draft report exists to submit.");
  try {
    await submitReport(data, report.id, user.id);
  } catch (error) {
    if (error instanceof ReportError) throw new Error(error.message);
    throw error;
  }
  revalidatePath(`/dashboard/lessons/${lessonId}`);
}

export async function approveReportAction(formData: FormData): Promise<void> {
  const user = await requireRole(["ADMIN"]);
  const lessonId = text(formData, "lessonId");
  if (!lessonId) throw new Error("Lesson is required.");
  const data = getDataProvider();
  const report = await data.reports.forLesson(lessonId);
  if (!report) throw new Error("No report exists for this lesson.");
  try {
    await approveReport(data, report.id, user.id);
  } catch (error) {
    if (error instanceof ReportError) throw new Error(error.message);
    throw error;
  }
  revalidatePath(`/dashboard/lessons/${lessonId}`);
}
