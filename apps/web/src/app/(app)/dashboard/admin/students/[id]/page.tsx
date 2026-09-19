import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader, StatTile } from "@/components/ui/Card";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { LessonList, LessonRow } from "@/components/lessons/LessonRow";
import { formatDateOnly } from "@/lib/format";
import { RecordList, RecordRow } from "@/components/records/RecordRow";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const student = await getDataProvider().students.get(id);
  return createMetadata({ title: student?.name ?? "Student", description: "Student profile.", path: `/dashboard/admin/students/${id}` });
}

/** Plan6 sections 45-46: parent, tutors, assignments, next lesson, attendance summary and
 * recent approved reports — the whole picture on one page, all real data. */
export default async function StudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["ADMIN"]);
  const { id } = await params;
  const data = getDataProvider();
  const student = await data.students.get(id);
  if (!student) notFound();

  const [clients, assignments, lessons, tutors] = await Promise.all([
    data.students.clientsFor(student.id),
    data.assignments.forStudent(student.id),
    data.lessons.forStudent(student.id),
    data.tutors.list(),
  ]);

  const nowIso = new Date().toISOString();
  const tutorNames = new Map(tutors.map((tutor) => [tutor.id, tutor.name]));
  const upcoming = lessons.filter((lesson) => lesson.status !== "CANCELLED" && lesson.startAt >= nowIso)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const past = lessons.filter((lesson) => lesson.startAt < nowIso).sort((a, b) => b.startAt.localeCompare(a.startAt));

  // Attendance summary across every lesson this student has had.
  const tally = { ATTENDED: 0, LATE: 0, ABSENT: 0, EXCUSED: 0 } as Record<string, number>;
  for (const lesson of lessons) {
    const records = await data.attendance.forLesson(lesson.id);
    const mine = records.find((record) => record.studentId === student.id);
    if (mine) tally[mine.status] = (tally[mine.status] ?? 0) + 1;
  }
  const marked = Object.values(tally).reduce((sum, count) => sum + count, 0);
  const attendanceRate = marked === 0 ? null : Math.round(((tally.ATTENDED + tally.LATE) / marked) * 100);

  const reports: Array<{ id: string; status: string; lessonId: string; title: string; startAt: string; summary: string }> = [];
  for (const lesson of past) {
    const report = await data.reports.forLesson(lesson.id);
    if (report) reports.push({ id: report.id, status: report.status, lessonId: lesson.id, title: lesson.title, startAt: lesson.startAt, summary: report.publicSummary });
  }

  const subjects = [...new Set(assignments.map((assignment) => assignment.subject))];

  return (
    <>
      <PageHeader
        backTo={{ href: "/dashboard/admin/people/students", label: "Back to students" }}
        breadcrumbs={[
          { label: "People", href: "/dashboard/admin/people/students" },
          { label: "Students", href: "/dashboard/admin/people/students" },
          { label: student.name },
        ]}
        title=""
      />

      <div className="profile-header">
        <div className="profile-header__identity">
          <Avatar name={student.name} size="lg" />
          <div className="profile-header__names">
            <h1 className="profile-header__name">{student.name}</h1>
            <p className="profile-header__meta">
              {student.yearGroup && <><span>{student.yearGroup}</span><span>·</span></>}
              <span>{subjects.join(", ") || "No subjects yet"}</span>
              <Badge tone={student.active ? "positive" : "muted"}>{student.active ? "Active" : "Inactive"}</Badge>
            </p>
          </div>
        </div>
        <div className="profile-header__actions">
          <Link href="/dashboard/admin/lessons/new" className="btn btn--primary">
            <CalendarPlus size={16} aria-hidden="true" />Schedule lesson
          </Link>
        </div>
      </div>

      <div className="stat-grid">
        <StatTile label="Upcoming lessons" value={upcoming.length} />
        <StatTile label="Lessons completed" value={lessons.filter((lesson) => lesson.status === "COMPLETED").length} />
        <StatTile label="Attendance" value={attendanceRate === null ? "—" : `${attendanceRate}%`} hint={marked > 0 ? `${marked} marked` : undefined} />
        <StatTile label="Reports" value={reports.filter((report) => report.status === "APPROVED").length} />
      </div>

      <div className="profile-grid">
        <div className="stack">
          <Card>
            <CardHeader title="Upcoming lessons" />
            <CardBody className="card__body--flush">
              {upcoming.length === 0 ? (
                <EmptyState title="No upcoming lessons" description="Schedule one to get this student back in the diary." />
              ) : (
                <LessonList>
                  {upcoming.slice(0, 6).map((lesson) => (
                    <LessonRow key={lesson.id} lesson={lesson} subtitle={tutorNames.get(lesson.tutorId)} showRelative />
                  ))}
                </LessonList>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Progress" description="Reports written after this student's lessons." />
            <CardBody className="card__body--flush">
              {reports.length === 0 ? (
                <EmptyState title="No reports yet" description="Reports appear once a tutor writes one after a lesson." />
              ) : (
                <RecordList>
                  {reports.slice(0, 6).map((report) => (
                    <RecordRow
                      key={report.id}
                      href={`/dashboard/lessons/${report.lessonId}`}
                      title={report.title}
                      meta={formatDateOnly(report.startAt)}
                      excerpt={report.summary}
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
            <CardHeader title="Details" />
            <CardBody>
              <dl className="detail-list" style={{ marginTop: 0 }}>
                <div>
                  <dt>Parent</dt>
                  <dd>
                    {clients.length === 0 ? "Not linked" : clients.map((client) => (
                      <Link key={client.id} href={`/dashboard/admin/clients/${client.id}`}>{client.name}</Link>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt>{assignments.length === 1 ? "Tutor" : "Tutors"}</dt>
                  <dd>{[...new Set(assignments.map((assignment) => tutorNames.get(assignment.tutorId)))].filter(Boolean).join(", ") || "None"}</dd>
                </div>
                <div><dt>Year group</dt><dd>{student.yearGroup ?? "Not set"}</dd></div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Attendance" />
            <CardBody>
              {marked === 0 ? (
                <EmptyState title="Nothing marked yet" description="Attendance is recorded by the tutor after each lesson." />
              ) : (
                <ul className="plain-list">
                  {(["ATTENDED", "LATE", "ABSENT", "EXCUSED"] as const).map((status) => (
                    <li key={status}>
                      <StatusBadge status={status} />
                      <span>{tally[status] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Tuition assignments" />
            <CardBody className="card__body--flush">
              {assignments.length === 0 ? (
                <EmptyState title="No assignments" />
              ) : (
                <RecordList>
                  {assignments.map((assignment) => (
                    <RecordRow
                      key={assignment.id}
                      href={`/dashboard/admin/assignments/${assignment.id}`}
                      title={assignment.title}
                      meta={tutorNames.get(assignment.tutorId)}
                      aside={<StatusBadge status={assignment.status} />}
                    />
                  ))}
                </RecordList>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
