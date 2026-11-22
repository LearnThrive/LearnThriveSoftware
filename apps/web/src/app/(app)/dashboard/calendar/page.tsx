import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { holds } from "@/lib/auth/scope";
import { joinRoleFor } from "@/lib/auth/teaching";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@/lib/data/provider";
import { visibleLessonsFor } from "@/lib/scheduling/visibleLessons";
import { isWithinJoinWindow, JOIN_WINDOW_MINUTES } from "@/lib/scheduling/joinWindow";
import { getMeetings } from "@/lib/meetings/runtime";
import { meetingOpenFor } from "@/lib/meetings/rules";
import { meetingRoleFor } from "@learnthrive/data/meetings";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchSelect } from "@/components/ui/SearchSelect";
import { CalendarView, type CalendarLesson } from "@/components/CalendarView";
import type { PeekMeeting } from "@/components/lessons/MeetingPeekPanel";

export const metadata: Metadata = createMetadata({
  title: "Calendar",
  description: "Your LearnThrive lessons and meetings.",
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
  // Staff meetings this person hosts or is invited to (only staff ever have any). A calendar that cannot read them still shows the lessons.
  const now = new Date();
  const meetings: PeekMeeting[] = await getMeetings().forPerson(user.id, new Date(now.getTime() - 90 * 24 * 3600_000).toISOString())
    .then((all) => all.map((m) => {
      const role = meetingRoleFor(m, user.id);
      return {
        id: m.id, title: m.title, startsAt: m.startsAt, durationMinutes: m.durationMinutes, hostName: m.hostName,
        people: [m.hostName, ...m.invitees.map((p) => p.name)].filter((n) => n !== undefined),
        youHost: role === "HOST", joinOpen: role !== null && meetingOpenFor(m, role, now),
        joinOpensAt: new Date(new Date(m.startsAt).getTime() - (role === "HOST" ? 30 : 10) * 60_000).toISOString(),
      };
    }))
    .catch(() => []);
  const tutorNames = new Map(tutors.map((t) => [t.id, t.name]));
  const studentNames = new Map(students.map((s) => [s.id, s.name]));

  // Section 55's "role filtering": with every lesson on the platform visible at once, Admin
  // needs a way to narrow the calendar down to one tutor's diary. Tutor/Client/Student calendars
  // are already scoped to their own lessons by visibleLessonsFor, so the filter is Admin-only.
  const isAdmin = holds(user, "ADMIN");
  const lessons = isAdmin && tutorFilter !== "all"
    ? allLessons.filter((lesson) => lesson.tutorId === tutorFilter)
    : allLessons;

  const calendarLessons: CalendarLesson[] = lessons.map((lesson) => {
    const joinRole = joinRoleFor(user, lesson);
    const canJoin = joinRole !== null && lesson.locationType === "ONLINE" && lesson.status !== "CANCELLED";
    const minutesBefore = joinRole === "TUTOR" ? JOIN_WINDOW_MINUTES.TUTOR_BEFORE : JOIN_WINDOW_MINUTES.STUDENT_BEFORE;
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
        description={isAdmin ? "Every lesson across the platform, and your meetings. Drag a lesson to reschedule it." : "Your lessons and meetings, at a glance."}
        actions={isAdmin ? (
          <Link href="/dashboard/admin/lessons/new" className="btn btn--primary">
            <CalendarPlus size={16} aria-hidden="true" />Schedule lesson
          </Link>
        ) : undefined}
      />

      {isAdmin && tutors.length > 1 && (
        // A searchable dropdown, not a tab per tutor: a row of tabs stops being usable as the tutor list grows.
        <SearchSelect
          basePath="/dashboard/calendar"
          param="tutor"
          value={tutorFilter}
          caption="Viewing"
          placeholder="All tutors"
          searchLabel="Find a tutor…"
          all={{ label: "All tutors", count: allLessons.length }}
          options={tutors
            .map((t) => ({ t, count: allLessons.filter((lesson) => lesson.tutorId === t.id).length }))
            // A former tutor (archived, inactive) is listed only while they still have lessons on the calendar.
            .filter(({ t, count }) => t.active || count > 0)
            .sort((a, b) => a.t.name.localeCompare(b.t.name))
            // What they teach is the second line: it also tells two people with the same name apart.
            .map(({ t, count }) => ({ id: t.id, name: t.name, sub: t.subjects.length > 0 ? t.subjects.join(", ") : "No subjects listed", count }))}
        />
      )}

      <Card>
        <CardBody className={lessons.length === 0 && meetings.length === 0 ? undefined : "card__body--flush"}>
          {lessons.length === 0 && meetings.length === 0 ? (
            <EmptyState
              icon={<CalendarPlus size={22} aria-hidden="true" />}
              title={tutorFilter === "all" ? "No lessons on your calendar yet" : "No lessons for this tutor"}
              description={isAdmin ? "Scheduled lessons will appear here as soon as you create one." : "Lessons you're scheduled for will appear here."}
              action={isAdmin ? (
                <Link href="/dashboard/admin/lessons/new" className="btn btn--primary">Schedule a lesson</Link>
              ) : undefined}
            />
          ) : (
            <CalendarView lessons={calendarLessons} canManage={isAdmin} meetings={meetings} />
          )}
        </CardBody>
      </Card>
    </>
  );
}
