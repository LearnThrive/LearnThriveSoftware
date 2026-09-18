import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { visibleLessonsFor } from "@/lib/scheduling/visibleLessons";
import { CalendarView, type CalendarLesson } from "@/components/CalendarView";

export const metadata: Metadata = createMetadata({
  title: "Calendar",
  description: "Your LearnThrive lesson calendar.",
  path: "/dashboard/calendar",
});

export default async function CalendarPage() {
  const user = await requireSession();
  const data = getDataProvider();
  const lessons = await visibleLessonsFor(data, user);

  const calendarLessons: CalendarLesson[] = lessons.map((lesson) => ({
    id: lesson.id, title: lesson.title, startAt: lesson.startAt, durationMinutes: lesson.durationMinutes,
    status: lesson.status, recurring: Boolean(lesson.recurrenceId),
  }));

  return (
    <div className="dashboard-page">
      <div className="dashboard-page__header-row">
        <h1>Calendar</h1>
        {user.role === "ADMIN" && (
          <Link href="/dashboard/admin/lessons/new" className="button button--primary"><span>Schedule lesson</span></Link>
        )}
      </div>
      {lessons.length === 0 && <p>No lessons on your calendar yet.</p>}
      <CalendarView lessons={calendarLessons} canDragReschedule={user.role === "ADMIN"} />
    </div>
  );
}
