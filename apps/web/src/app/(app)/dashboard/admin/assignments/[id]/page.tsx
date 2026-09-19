import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader, StatTile } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { LessonList, LessonRow } from "@/components/lessons/LessonRow";
import { PersonList, PersonRow } from "@/components/people/PersonRow";
import { formatDateOnly, formatRelative } from "@/lib/format";
import { RecordList, RecordRow } from "@/components/records/RecordRow";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const assignment = await getDataProvider().assignments.get(id);
  return createMetadata({
    title: assignment?.title ?? "Tuition assignment",
    description: "Tuition assignment detail.",
    path: `/dashboard/admin/assignments/${id}`,
  });
}

/** Plan6 section 49: assignments finally get a real detail page — who's involved, what's been
 * scheduled against it, the reports it has produced, and its activity. */
export default async function AssignmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["ADMIN"]);
  const { id } = await params;
  const data = getDataProvider();
  const assignment = await data.assignments.get(id);
  if (!assignment) notFound();

  const [tutor, students, clients, allLessons] = await Promise.all([
    data.tutors.get(assignment.tutorId),
    Promise.all(assignment.studentIds.map((studentId) => data.students.get(studentId))),
    Promise.all(assignment.clientIds.map((clientId) => data.clients.get(clientId))),
    data.lessons.list(),
  ]);

  const namedStudents = students.filter((student): student is NonNullable<typeof student> => student !== null);
  const namedClients = clients.filter((client): client is NonNullable<typeof client> => client !== null);
  const lessons = allLessons.filter((lesson) => lesson.assignmentId === assignment.id);
  const nowIso = new Date().toISOString();
  const upcoming = lessons.filter((lesson) => lesson.status !== "CANCELLED" && lesson.startAt >= nowIso)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const completed = lessons.filter((lesson) => lesson.status === "COMPLETED");

  const reports: Array<{ id: string; status: string; lessonId: string; title: string; startAt: string }> = [];
  for (const lesson of lessons.sort((a, b) => b.startAt.localeCompare(a.startAt))) {
    const report = await data.reports.forLesson(lesson.id);
    if (report) reports.push({ id: report.id, status: report.status, lessonId: lesson.id, title: lesson.title, startAt: lesson.startAt });
  }

  const activity = (await Promise.all(lessons.map((lesson) => data.activity.forLesson(lesson.id))))
    .flat()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);

  return (
    <>
      <PageHeader
        backTo={{ href: "/dashboard/admin/assignments", label: "Back to assignments" }}
        breadcrumbs={[
          { label: "Tuition", href: "/dashboard/admin/assignments" },
          { label: "Assignments", href: "/dashboard/admin/assignments" },
          { label: assignment.title },
        ]}
        eyebrow={assignment.level ? `${assignment.subject} · ${assignment.level}` : assignment.subject}
        title={assignment.title}
        description={[
          namedStudents.map((student) => student.name).join(", "),
          tutor?.name,
        ].filter(Boolean).join(" • ")}
        meta={<StatusBadge status={assignment.status} />}
        actions={
          <Link href="/dashboard/admin/lessons/new" className="btn btn--primary">
            <CalendarPlus size={16} aria-hidden="true" />Schedule lesson
          </Link>
        }
      />

      <div className="stat-grid">
        <StatTile label="Upcoming lessons" value={upcoming.length} />
        <StatTile label="Completed lessons" value={completed.length} />
        <StatTile label="Reports" value={reports.length} />
      </div>

      <div className="profile-grid">
        <div className="stack">
          <Card>
            <CardHeader title="Upcoming lessons" />
            <CardBody className="card__body--flush">
              {upcoming.length === 0 ? (
                <EmptyState title="Nothing scheduled" description="Schedule a lesson against this assignment to get started." />
              ) : (
                <LessonList>
                  {upcoming.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} showRelative />)}
                </LessonList>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Reports" />
            <CardBody className="card__body--flush">
              {reports.length === 0 ? (
                <EmptyState title="No reports yet" />
              ) : (
                <RecordList>
                  {reports.slice(0, 8).map((report) => (
                    <RecordRow
                      key={report.id}
                      href={`/dashboard/lessons/${report.lessonId}`}
                      title={report.title}
                      meta={formatDateOnly(report.startAt)}
                      aside={<StatusBadge status={report.status} />}
                    />
                  ))}
                </RecordList>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="People" />
            <CardBody className="card__body--flush">
              <PersonList>
                {tutor && <PersonRow key={tutor.id} name={tutor.name} subtitle="Tutor" href={`/dashboard/admin/tutors/${tutor.id}`} />}
                {namedStudents.map((student) => (
                  <PersonRow key={student.id} name={student.name} subtitle={student.yearGroup ?? "Student"} href={`/dashboard/admin/students/${student.id}`} />
                ))}
                {namedClients.map((client) => (
                  <PersonRow key={client.id} name={client.name} subtitle="Parent or guardian" href={`/dashboard/admin/clients/${client.id}`} />
                ))}
              </PersonList>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Schedule defaults" />
            <CardBody>
              <dl className="detail-list" style={{ marginTop: 0 }}>
                <div><dt>Duration</dt><dd>{assignment.defaultDurationMinutes ?? 60} minutes</dd></div>
                <div><dt>Location</dt><dd>{assignment.defaultLocationType === "IN_PERSON" ? "In person" : "Online"}</dd></div>
                <div><dt>Report approval</dt><dd>{assignment.requireReportApproval === false ? "Not required" : "Required"}</dd></div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Activity" />
            <CardBody className="card__body--flush">
              {activity.length === 0 ? (
                <EmptyState title="Nothing recorded yet" />
              ) : (
                <ol className="timeline">
                  {activity.map((event) => (
                    <li className="timeline__item" key={event.id}>
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
      </div>
    </>
  );
}
