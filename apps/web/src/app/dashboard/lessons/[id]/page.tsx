import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { cancelLessonAction } from "@/lib/actions/lessons";
import { formatInTimeZone } from "@/lib/scheduling/timezone";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const lesson = await getDataProvider().lessons.get(id);
  return createMetadata({ title: lesson?.title ?? "Lesson", description: "Lesson detail.", path: `/dashboard/lessons/${id}` });
}

// IDOR boundary (plan section 85: "Tutor edits someone else's Lesson", "Student joins unrelated
// classroom") — every non-Admin role must be explicitly connected to *this specific* lesson, not
// just authenticated. See tests-e2e/lessons.spec.ts for the adversarial proof of this.
function canView(user: { role: string; profileId?: string }, lesson: { tutorId: string; studentIds: string[]; clientIds: string[] }): boolean {
  if (user.role === "ADMIN") return true;
  if (!user.profileId) return false;
  if (user.role === "TUTOR") return lesson.tutorId === user.profileId;
  if (user.role === "CLIENT") return lesson.clientIds.includes(user.profileId);
  if (user.role === "STUDENT") return lesson.studentIds.includes(user.profileId);
  return false;
}

export default async function LessonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  const { id } = await params;
  const data = getDataProvider();
  const lesson = await data.lessons.get(id);
  if (!lesson) notFound();
  if (!canView(user, lesson)) redirect("/403");

  const [tutor, students] = await Promise.all([
    data.tutors.get(lesson.tutorId),
    Promise.all(lesson.studentIds.map((sid) => data.students.get(sid))),
  ]);

  const startFormatted = formatInTimeZone(lesson.startAt, "Europe/London", { dateStyle: "full", timeStyle: "short" });
  const isAdmin = user.role === "ADMIN";
  const canCancel = isAdmin && lesson.status === "PLANNED";
  // Plan section 34's join-window check lands with Phase E's real classroom integration — this
  // is a placeholder that shows the *idea* of the control without claiming it's wired up yet.
  const showJoinPlaceholder = lesson.locationType === "ONLINE" && lesson.status !== "CANCELLED" && (user.role === "TUTOR" || user.role === "STUDENT");

  return (
    <div className="dashboard-page">
      <p className="eyebrow">Lesson</p>
      <h1>{lesson.title}</h1>
      <p>{startFormatted} · {lesson.durationMinutes} minutes · {lesson.locationType === "ONLINE" ? "Online" : `In-person${lesson.location ? ` — ${lesson.location}` : ""}`}</p>
      <p>Status: <strong>{lesson.status}</strong>{lesson.recurrenceId ? " · part of a recurring series" : ""}</p>

      {isAdmin && (
        <>
          <h2>Operational details</h2>
          <p>Tutor: {tutor?.name ?? "Unknown"}</p>
          <p>Student(s): {students.filter(Boolean).map((s) => s!.name).join(", ") || "None"}</p>
          <p>Subject: {lesson.subject}</p>
          {lesson.notes && <p>Notes: {lesson.notes}</p>}
          {lesson.status === "CANCELLED" && (
            <p className="dashboard-page__note">
              Cancelled {lesson.cancelledAt ? formatInTimeZone(lesson.cancelledAt, "Europe/London", { dateStyle: "medium", timeStyle: "short" }) : ""}
              {lesson.cancellationReason ? ` — ${lesson.cancellationReason}` : ""}
            </p>
          )}
        </>
      )}

      {showJoinPlaceholder && (
        <button type="button" className="button button--primary" disabled title="Classroom integration arrives in a later phase of this platform">
          <span>Join Classroom (coming soon)</span>
        </button>
      )}

      {canCancel && (
        <form action={cancelLessonAction} className="login-form" style={{ marginTop: "1.5rem" }}>
          <input type="hidden" name="lessonId" value={lesson.id} />
          <div className="form-field"><label htmlFor="cancel-reason">Cancellation reason (optional)</label><input id="cancel-reason" name="reason" /></div>
          <div className="form-actions"><button type="submit" className="button-secondary">Cancel this lesson</button></div>
        </form>
      )}

      <p className="dashboard-page__note">
        Attendance, lesson reports, and full activity history arrive in later phases of this platform.
      </p>
    </div>
  );
}
