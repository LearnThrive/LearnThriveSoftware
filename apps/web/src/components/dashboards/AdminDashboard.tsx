import Link from "next/link";
import { Activity, CalendarPlus, FileText } from "lucide-react";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { lessonBucketsFor } from "@/lib/dashboard/queries";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader, StatTile } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { QuickCreateMenu } from "@/components/dashboards/QuickCreateMenu";
import { LessonSection, TodaySchedule, greeting } from "@/components/dashboards/shared";
import { formatLongDate, formatRelative } from "@/lib/format";

/**
 * Plan6 section 50: the Admin's home answers "what needs my attention today?" before anything
 * else. Every number here is counted from the repository — nothing is invented (section 17/81).
 */
export async function AdminDashboard({ user }: { user: AuthenticatedUser }) {
  const data = getDataProvider();
  const now = new Date();
  const [buckets, students, tutors, assignments, activity] = await Promise.all([
    lessonBucketsFor(data, user, now),
    data.students.list(),
    data.tutors.list(),
    data.assignments.list(),
    data.activity.recent(6),
  ]);

  // Reports waiting on an admin decision — the one queue only an admin can clear.
  const reports = await Promise.all(buckets.all.map((lesson) => data.reports.forLesson(lesson.id)));
  const awaitingApproval = reports.filter((report) => report?.status === "SUBMITTED").length;

  const weekEnd = new Date(now); weekEnd.setDate(weekEnd.getDate() + 7);
  const thisWeek = buckets.upcoming.filter((lesson) => lesson.startAt <= weekEnd.toISOString());

  const studentNames = new Map(students.map((student) => [student.id, student.name]));
  const tutorNames = new Map(tutors.map((tutor) => [tutor.id, tutor.name]));
  const describe = (lesson: { studentIds: string[]; tutorId: string }) =>
    [lesson.studentIds.map((id) => studentNames.get(id)).filter(Boolean).join(", "), tutorNames.get(lesson.tutorId)]
      .filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        eyebrow={formatLongDate(now)}
        title={`${greeting(now)}, ${user.name.split(" ")[0]}.`}
        description={buckets.todays.length > 0
          ? `${buckets.todays.length} lesson${buckets.todays.length === 1 ? "" : "s"} scheduled today.`
          : "No lessons scheduled today."}
        actions={<QuickCreateMenu />}
      />

      <div className="stat-grid">
        <StatTile label="Lessons today" value={buckets.todays.length} href="/dashboard/calendar" />
        <StatTile label="Upcoming this week" value={thisWeek.length} href="/dashboard/lessons?filter=upcoming" />
        <StatTile label="Active students" value={students.filter((student) => student.active).length} href="/dashboard/admin/people/students" />
        <StatTile
          label="Reports awaiting approval"
          value={awaitingApproval}
          hint={awaitingApproval > 0 ? "Needs review" : undefined}
          href="/dashboard/reports?filter=awaiting"
        />
      </div>

      <div className="grid-2">
        <Card>
          <CardHeader
            title="Today's schedule"
            description={buckets.todays.length > 0 ? "Everything happening across the platform today." : undefined}
            action={<Link href="/dashboard/calendar" className="btn btn--ghost btn--sm">Calendar</Link>}
          />
          <CardBody><TodaySchedule lessons={buckets.todays} labelFor={describe} /></CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Needs attention"
            description="Past lessons still waiting on attendance or a report."
            action={buckets.needsAttention.length > 0
              ? <Link href="/dashboard/lessons?filter=needs-attention" className="btn btn--ghost btn--sm">View all</Link>
              : undefined}
          />
          <CardBody className="card__body--flush">
            {buckets.needsAttention.length === 0 ? (
              <EmptyState
                icon={<FileText size={22} />}
                title="Everything's closed out"
                description="Every past lesson has its attendance marked and any required report submitted."
              />
            ) : (
              <ul className="day-schedule day-schedule--padded">
                {buckets.needsAttention.slice(0, 5).map((lesson) => (
                  <li key={lesson.id} className="day-schedule__item">
                    <span className="day-schedule__time">{formatRelative(lesson.startAt)}</span>
                    <span className="day-schedule__body">
                      <Link href={`/dashboard/lessons/${lesson.id}`} className="day-schedule__title">{lesson.title}</Link>
                      <span className="day-schedule__meta">{describe(lesson)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid-2" style={{ marginTop: "var(--space-4)" }}>
        <LessonSection
          title="Upcoming lessons"
          description="The next few across every tutor."
          lessons={buckets.upcoming.slice(0, 5)}
          subtitleFor={describe}
          showRelative
          emptyTitle="Nothing scheduled yet"
          emptyDescription="Scheduled lessons will appear here."
          action={<Link href="/dashboard/admin/lessons/new" className="btn btn--ghost btn--sm"><CalendarPlus size={15} aria-hidden="true" />Schedule</Link>}
        />

        <Card>
          <CardHeader
            title="Recent activity"
            description={`${assignments.filter((assignment) => assignment.status === "ACTIVE").length} active tuition assignments.`}
            action={<Link href="/dashboard/activity" className="btn btn--ghost btn--sm">View all</Link>}
          />
          <CardBody className="card__body--flush">
            {activity.length === 0 ? (
              <EmptyState icon={<Activity size={22} />} title="No activity yet" description="Scheduling a lesson or approving a report will show up here." />
            ) : (
              <ol className="timeline">
                {activity.map((event) => (
                  <li key={event.id} className="timeline__item">
                    <span className="timeline__marker" aria-hidden="true" />
                    <div className="timeline__body">
                      <p className="timeline__message">
                        <Link href={`/dashboard/lessons/${event.lessonId}`}>{event.message}</Link>
                      </p>
                      <p className="timeline__meta">{formatRelative(event.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
