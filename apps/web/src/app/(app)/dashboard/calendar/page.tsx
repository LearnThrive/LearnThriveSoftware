import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { visibleLessonsFor } from "@/lib/scheduling/visibleLessons";
import { isWithinJoinWindow, JOIN_WINDOW_MINUTES } from "@/lib/scheduling/joinWindow";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { CalendarView, type CalendarLesson } from "@/components/CalendarView";

export const metadata: Metadata = createMetadata({
  title: "Calendar",
  description: "Your LearnThrive lesson calendar.",
  path: "/dashboard/calendar",
});

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ tutor?: string }> }) {
  const user = await requireSession();
  const { tutor: tutorFilter = "all" } = await searchParams;
  const data = getDataProvider();
  const [allLessons, tutors, students] = await Promise.all([
    visibleLessonsFor(data, user),
    data.tutors.list(),
    data.students.list(),
  ]);
  const tutorNames = new Map(tutors.map((t) => [t.id, t.name]));
  const studentNames = new Map(students.map((s) => [s.id, s.name]));

  // Section 55's "role filtering": with every lesson on the platform visible at once, Admin
  // needs a way to narrow the calendar down to one tutor's diary. Tutor/Client/Student calendars
  // are already scoped to their own lessons by visibleLessonsFor, so the filter is Admin-only.
  const isAdmin = user.role === "ADMIN";
  const lessons = isAdmin && tutorFilter !== "all"
    ? allLessons.filter((lesson) => lesson.tutorId === tutorFilter)
    : allLessons;

  const canJoinAtAll = user.role === "TUTOR" || user.role === "STUDENT";
  const joinRole = user.role as "TUTOR" | "STUDENT";
  const minutesBefore = user.role === "TUTOR" ? JOIN_WINDOW_MINUTES.TUTOR_BEFORE : JOIN_WINDOW_MINUTES.STUDENT_BEFORE;

  const calendarLessons: CalendarLesson[] = lessons.map((lesson) => {
    const canJoin = canJoinAtAll && lesson.locationType === "ONLINE" && lesson.status !== "CANCELLED"
      && (user.role === "TUTOR" ? lesson.tutorId === user.profileId : lesson.studentIds.includes(user.profileId ?? ""));
    return {
      id: lesson.id,
      title: lesson.title,
      subject: lesson.subject,
      startAt: lesson.startAt,
      durationMinutes: lesson.durationMinutes,
      status: lesson.status,
      recurring: Boolean(lesson.recurrenceId),
      locationType: lesson.locationType,
      location: lesson.location,
      tutorName: tutorNames.get(lesson.tutorId) ?? "Unassigned",
      studentNames: lesson.studentIds.map((id) => studentNames.get(id)).filter((n): n is string => Boolean(n)),
      canJoin,
      joinWindowOpen: canJoin && isWithinJoinWindow(lesson, joinRole),
      joinOpensAt: new Date(new Date(lesson.startAt).getTime() - minutesBefore * 60_000).toISOString(),
    };
  });

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Calendar"
        description={user.role === "ADMIN" ? "Every lesson across the platform. Drag a lesson to reschedule it." : "Your lessons, at a glance."}
        actions={user.role === "ADMIN" ? (
          <Link href="/dashboard/admin/lessons/new" className="btn btn--primary">
            <CalendarPlus size={16} aria-hidden="true" />Schedule lesson
          </Link>
        ) : undefined}
      />

      {isAdmin && tutors.length > 1 && (
        <FilterTabs
          basePath="/dashboard/calendar"
          param="tutor"
          current={tutorFilter}
          options={[
            { value: "all", label: "All tutors" },
            ...tutors.map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
      )}

      <Card>
        <CardBody className={lessons.length === 0 ? undefined : "card__body--flush"}>
          {lessons.length === 0 ? (
            <EmptyState
              icon={<CalendarPlus size={22} aria-hidden="true" />}
              title={tutorFilter === "all" ? "No lessons on your calendar yet" : "No lessons for this tutor"}
              description={user.role === "ADMIN" ? "Scheduled lessons will appear here as soon as you create one." : "Lessons you're scheduled for will appear here."}
              action={user.role === "ADMIN" ? (
                <Link href="/dashboard/admin/lessons/new" className="btn btn--primary">Schedule a lesson</Link>
              ) : undefined}
            />
          ) : (
            <CalendarView lessons={calendarLessons} canManage={isAdmin} />
          )}
        </CardBody>
      </Card>
    </>
  );
}
