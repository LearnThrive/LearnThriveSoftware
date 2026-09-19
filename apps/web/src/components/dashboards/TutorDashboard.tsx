import Link from "next/link";
import { FileText } from "lucide-react";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { lessonBucketsFor, visibleStudentsFor } from "@/lib/dashboard/queries";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LessonSection, NextLessonCard, TodaySchedule, greeting } from "@/components/dashboards/shared";
import { PersonList, PersonRow } from "@/components/people/PersonRow";
import { formatLongDate, formatRelative } from "@/lib/format";

/** Plan6 section 52: a Tutor's home is about teaching — next lesson first, then what they owe. */
export async function TutorDashboard({ user }: { user: AuthenticatedUser }) {
  const data = getDataProvider();
  const now = new Date();
  const [buckets, students] = await Promise.all([
    lessonBucketsFor(data, user, now),
    visibleStudentsFor(data, user),
  ]);

  const studentNames = new Map(students.map((student) => [student.id, student.name]));
  const describe = (lesson: { studentIds: string[] }) =>
    lesson.studentIds.map((id) => studentNames.get(id)).filter(Boolean).join(", ") || "No students";

  // Reports this tutor still owes: a past lesson that requires one and hasn't had it submitted.
  const outstanding: Array<{ lessonId: string; title: string; startAt: string }> = [];
  for (const lesson of buckets.past.slice(0, 40)) {
    if (!lesson.reportRequired) continue;
    const report = await data.reports.forLesson(lesson.id);
    if (!report || report.status === "DRAFT") outstanding.push({ lessonId: lesson.id, title: lesson.title, startAt: lesson.startAt });
  }

  return (
    <>
      <PageHeader
        eyebrow={formatLongDate(now)}
        title={`${greeting(now)}, ${user.name.split(" ")[0]}.`}
        description={buckets.todays.length > 0
          ? `You have ${buckets.todays.length} lesson${buckets.todays.length === 1 ? "" : "s"} today.`
          : "Nothing scheduled today."}
      />

      <NextLessonCard
        lesson={buckets.next}
        subtitle={buckets.next ? describe(buckets.next) : undefined}
        role="TUTOR"
        canJoin
      />

      <div className="grid-2" style={{ marginTop: "var(--space-4)" }}>
        <Card>
          <CardHeader title="Today" action={<Link href="/dashboard/calendar" className="btn btn--ghost btn--sm">Calendar</Link>} />
          <CardBody><TodaySchedule lessons={buckets.todays} labelFor={describe} /></CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Reports to complete"
            description="Lessons that need a report before they can be closed out."
            action={outstanding.length > 0 ? <Link href="/dashboard/reports?filter=drafts" className="btn btn--ghost btn--sm">View all</Link> : undefined}
          />
          <CardBody className="card__body--flush">
            {outstanding.length === 0 ? (
              <EmptyState icon={<FileText size={22} />} title="Nothing outstanding" description="Every lesson that needed a report has one." />
            ) : (
              <ul className="day-schedule day-schedule--padded">
                {outstanding.slice(0, 5).map((item) => (
                  <li key={item.lessonId} className="day-schedule__item">
                    <span className="day-schedule__time">{formatRelative(item.startAt)}</span>
                    <span className="day-schedule__body">
                      <Link href={`/dashboard/lessons/${item.lessonId}`} className="day-schedule__title">{item.title}</Link>
                      <span className="day-schedule__meta">Report outstanding</span>
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
          title="Upcoming schedule"
          lessons={buckets.upcoming.slice(1, 6)}
          subtitleFor={describe}
          showRelative
          emptyTitle="Nothing else scheduled"
          emptyDescription="Lessons after your next one will appear here."
        />

        <Card>
          <CardHeader
            title="Your students"
            description={students.length > 0 ? `${students.length} assigned to you.` : undefined}
            action={<Link href="/dashboard/students" className="btn btn--ghost btn--sm">View all</Link>}
          />
          <CardBody className="card__body--flush">
            {students.length === 0 ? (
              <EmptyState title="No students assigned yet" description="An admin assigns students to you through a tuition assignment." />
            ) : (
              <PersonList>
                {students.slice(0, 5).map((student) => (
                  <PersonRow key={student.id} name={student.name} subtitle={student.yearGroup} active={student.active} />
                ))}
              </PersonList>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
