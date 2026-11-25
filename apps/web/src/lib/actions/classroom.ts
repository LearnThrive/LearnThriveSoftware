"use server";

import { redirect } from "next/navigation";
import { getDataProvider } from "@/lib/data/provider";
import { requireSession } from "@/lib/auth/guard";
import { lessonEntryFor, recordSupervision } from "@/lib/classroom/lessonEntry";

// Plan section 34's full authorization checklist, all re-checked here (lib/classroom/lessonEntry.ts) even though the lesson page already decides
// whether to show the Join button: a Server Action is its own POST endpoint and must never trust the page that pointed at it. The lesson's tutor
// joins as its tutor, a student on it as a student, and any other administrator as a SUPERVISOR (straight in, no student seat, no say over the
// lesson, shown to everyone). On any failure it goes back to the lesson page with the reason.
export async function joinClassroomAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  const lessonId = typeof formData.get("lessonId") === "string" ? (formData.get("lessonId") as string).trim() : "";
  if (!lessonId) redirect("/dashboard/calendar");

  const lesson = await getDataProvider().lessons.get(lessonId);
  if (!lesson) redirect("/dashboard/calendar");
  const entry = lessonEntryFor(user, lesson);
  if (!entry.ok) redirect(`/dashboard/lessons/${lessonId}?joinError=${encodeURIComponent(entry.message)}`);
  // Supervision is written into the lesson's history, which its tutor sees.
  if (entry.role === "supervisor") await recordSupervision(user, lesson.id);

  const externalClassroomUrl = process.env.NEXT_PUBLIC_CLASSROOM_URL;
  if (externalClassroomUrl && !externalClassroomUrl.includes("localhost:5173") && !externalClassroomUrl.includes("127.0.0.1:5173")) {
    redirect(`${externalClassroomUrl}/?token=${encodeURIComponent(entry.token)}`);
  }
  redirect(`/dashboard/lessons/${lesson.id}/classroom?token=${encodeURIComponent(entry.token)}`);
}
