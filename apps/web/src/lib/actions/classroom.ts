"use server";

import { redirect } from "next/navigation";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { requireSession } from "@/lib/auth/guard";
import { signClassroomJoinToken } from "@learnthrive/shared/classroomToken";
import { isWithinJoinWindow } from "@/lib/scheduling/joinWindow";

// Plan section 34's full authorization checklist, all re-checked here even though the lesson
// detail page already decides whether to show the "Join Classroom" button — a Server Action is
// its own POST endpoint and must never trust that the page that pointed at it did the checking.
// On any failure, redirects back to the lesson page with a reason the page can show — never
// silently no-ops, and never leaks *why* by way of a generic "not found" (the lesson page has
// already proven this user can see this lesson before this button was ever rendered).
export async function joinClassroomAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  const lessonId = typeof formData.get("lessonId") === "string" ? (formData.get("lessonId") as string).trim() : "";
  if (!lessonId) redirect("/dashboard/calendar");
  const back = (reason: string) => redirect(`/dashboard/lessons/${lessonId}?joinError=${encodeURIComponent(reason)}`);

  if (user.role !== "TUTOR" && user.role !== "STUDENT") back("Only the assigned Tutor or Student can join this lesson's classroom.");

  const data = getDataProvider();
  const lesson = await data.lessons.get(lessonId);
  if (!lesson) redirect("/dashboard/calendar");

  const isAssigned = user.profileId != null && (
    (user.role === "TUTOR" && lesson.tutorId === user.profileId) ||
    (user.role === "STUDENT" && lesson.studentIds.includes(user.profileId))
  );
  if (!isAssigned) back("You are not assigned to this lesson.");
  if (lesson.locationType !== "ONLINE" || !lesson.classroomRoomId) back("This lesson does not have an online classroom.");
  if (lesson.status === "CANCELLED") back("This lesson has been cancelled.");
  if (!isWithinJoinWindow(lesson, user.role as "TUTOR" | "STUDENT")) back("The classroom for this lesson isn't open yet. Come back closer to the start time.");

  const token = signClassroomJoinToken({
    roomId: lesson.classroomRoomId as string, // guaranteed above — redirect() never returns, so this line is unreachable otherwise
    lessonId: lesson.id,
    name: user.name,
    role: user.role === "TUTOR" ? "tutor" : "student",
    // Short-lived: this token only needs to survive the redirect, not the
    // whole lesson — the join-window check above is what actually gates access over time.
    exp: Date.now() + 5 * 60_000,
  });

  const externalClassroomUrl = process.env.NEXT_PUBLIC_CLASSROOM_URL;
  if (externalClassroomUrl && !externalClassroomUrl.includes("localhost:5173") && !externalClassroomUrl.includes("127.0.0.1:5173")) {
    redirect(`${externalClassroomUrl}/?token=${encodeURIComponent(token)}`);
  }

  redirect(`/dashboard/lessons/${lesson.id}/classroom?token=${encodeURIComponent(token)}`);
}
