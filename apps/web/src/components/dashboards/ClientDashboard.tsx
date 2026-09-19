import Link from "next/link";
import { FileText } from "lucide-react";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { lessonBucketsFor, visibleReportsFor, visibleStudentsFor } from "@/lib/dashboard/queries";
import { visibleReportFor } from "@/lib/reports/reportService";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Avatar } from "@/components/ui/Avatar";
import { LessonSection, greeting } from "@/components/dashboards/shared";
import { formatDateOnly, formatLongDate, formatRelative } from "@/lib/format";

/** Plan6 section 53: a parent's home — when is the next lesson, who are the children, what's
 * been said about their progress. No administrative complexity. */
export async function ClientDashboard({ user }: { user: AuthenticatedUser }) {
  const data = getDataProvider();
  const now = new Date();
  const [buckets, students, reportPairs] = await Promise.all([
    lessonBucketsFor(data, user, now),
    visibleStudentsFor(data, user),
    visibleReportsFor(data, user),
  ]);

  const tutorNames = new Map((await data.tutors.list()).map((tutor) => [tutor.id, tutor.name]));
  const studentNames = new Map(students.map((student) => [student.id, student.name]));

  // Only approved reports reach a parent, and only their public fields — enforced by the same
  // single gate used everywhere else, never re-implemented here.
  const readableReports = reportPairs
    .filter(({ report }) => visibleReportFor(user, report) !== null)
    .slice(0, 4);

  const describe = (lesson: { studentIds: string[]; tutorId: string }) => {
    const child = lesson.studentIds.map((id) => studentNames.get(id)).filter(Boolean).join(", ");
    const tutor = tutorNames.get(lesson.tutorId);
    return [child, tutor && `with ${tutor}`].filter(Boolean).join(" · ");
  };

  return (
    <>
      <PageHeader
        eyebrow={formatLongDate(now)}
        title={`${greeting(now)}, ${user.name.split(" ")[0]}.`}
        description={buckets.next
          ? `The next lesson is ${formatRelative(buckets.next.startAt)}.`
          : "No lessons scheduled at the moment."}
      />

      <div className="grid-2">
        <LessonSection
          title="Upcoming lessons"
          lessons={buckets.upcoming.slice(0, 5)}
          subtitleFor={describe}
          showRelative
          emptyTitle="No lessons scheduled"
          emptyDescription="LearnThrive will let you know as soon as the next lesson is booked."
          action={<Link href="/dashboard/calendar" className="btn btn--ghost btn--sm">Calendar</Link>}
        />

        <Card>
          <CardHeader
            title={students.length === 1 ? "Your child" : "Your children"}
            action={<Link href="/dashboard/children" className="btn btn--ghost btn--sm">View all</Link>}
          />
          <CardBody className="card__body--flush">
            {students.length === 0 ? (
              <EmptyState title="No children linked yet" description="Once LearnThrive links your child to your account, they'll appear here." />
            ) : (
              <ul className="person-list">
                {students.map((student) => {
                  const next = buckets.upcoming.find((lesson) => lesson.studentIds.includes(student.id));
                  return (
                    <li className="person-row" key={student.id}>
                      <div className="person-row__link">
                        <span className="person-row__identity">
                          <Avatar name={student.name} size="md" />
                          <span className="person-row__names">
                            <span className="person-row__name">{student.name}</span>
                            {student.yearGroup && <span className="person-row__subtitle">{student.yearGroup}</span>}
                          </span>
                        </span>
                        <span className="person-row__cell">
                          <span className="person-row__cell-label">Next lesson</span>
                          <span className="person-row__cell-value">
                            {next ? formatRelative(next.startAt) : "None scheduled"}
                          </span>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="dashboard-reports">
        <CardHeader
          title="Latest reports"
          description="What your child's tutor has shared after recent lessons."
          action={<Link href="/dashboard/reports" className="btn btn--ghost btn--sm">View all</Link>}
        />
        <CardBody className="card__body--flush">
          {readableReports.length === 0 ? (
            <EmptyState
              icon={<FileText size={22} />}
              title="No reports yet"
              description="After a lesson, your tutor writes a report. Once approved, it appears here."
            />
          ) : (
            <ul className="record-list">
              {readableReports.map(({ report, lesson }) => (
                <li key={report.id} className="record-list__item">
                  <Link href={`/dashboard/lessons/${lesson.id}`} className="record-list__link">
                    <span className="record-list__body">
                      <span className="record-list__title">{lesson.title}</span>
                      <span className="record-list__meta">
                        {formatDateOnly(lesson.startAt)} · {tutorNames.get(lesson.tutorId) ?? "Tutor"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
