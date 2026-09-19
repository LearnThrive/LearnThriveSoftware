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
import { PersonList, PersonRow } from "@/components/people/PersonRow";
import { formatDateOnly } from "@/lib/format";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const tutor = await getDataProvider().tutors.get(id);
  return createMetadata({ title: tutor?.name ?? "Tutor", description: "Tutor profile.", path: `/dashboard/admin/tutors/${id}` });
}

/** Plan6 sections 43-44: a real professional profile — snapshot, assignments, upcoming lessons,
 * availability and recent reports, all from live repository data. */
export default async function TutorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["ADMIN"]);
  const { id } = await params;
  const data = getDataProvider();
  const tutor = await data.tutors.get(id);
  if (!tutor) notFound();

  const [assignments, allLessons, availability, allStudents] = await Promise.all([
    data.assignments.forTutor(tutor.id),
    data.lessons.forTutor(tutor.id),
    data.availability.forTutor(tutor.id),
    data.students.list(),
  ]);

  const nowIso = new Date().toISOString();
  const upcoming = allLessons.filter((lesson) => lesson.status !== "CANCELLED" && lesson.startAt >= nowIso)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const completed = allLessons.filter((lesson) => lesson.status === "COMPLETED");
  const studentIds = [...new Set(assignments.flatMap((assignment) => assignment.studentIds))];
  const studentNames = new Map(allStudents.map((student) => [student.id, student.name]));

  // Reports this tutor still owes, counted the same way their own dashboard counts them.
  let outstandingReports = 0;
  const recentReports: Array<{ id: string; status: string; lessonId: string; title: string; startAt: string }> = [];
  for (const lesson of allLessons) {
    const report = await data.reports.forLesson(lesson.id);
    if (lesson.reportRequired && lesson.startAt < nowIso && (!report || report.status === "DRAFT")) outstandingReports += 1;
    if (report) recentReports.push({ id: report.id, status: report.status, lessonId: lesson.id, title: lesson.title, startAt: lesson.startAt });
  }
  recentReports.sort((a, b) => b.startAt.localeCompare(a.startAt));

  return (
    <>
      <PageHeader
        backTo={{ href: "/dashboard/admin/people/tutors", label: "Back to tutors" }}
        breadcrumbs={[
          { label: "People", href: "/dashboard/admin/people/students" },
          { label: "Tutors", href: "/dashboard/admin/people/tutors" },
          { label: tutor.name },
        ]}
        title=""
      />

      <div className="profile-header">
        <div className="profile-header__identity">
          <Avatar name={tutor.name} size="lg" />
          <div className="profile-header__names">
            <h1 className="profile-header__name">{tutor.name}</h1>
            <p className="profile-header__meta">
              <span>Tutor</span>
              {tutor.subjects.length > 0 && <><span>·</span><span>{tutor.subjects.join(", ")}</span></>}
              <Badge tone={tutor.active ? "positive" : "muted"}>{tutor.active ? "Active" : "Inactive"}</Badge>
            </p>
            <p className="profile-header__meta"><a href={`mailto:${tutor.email}`}>{tutor.email}</a></p>
          </div>
        </div>
        <div className="profile-header__actions">
          <Link href="/dashboard/admin/lessons/new" className="btn btn--primary">
            <CalendarPlus size={16} aria-hidden="true" />Schedule lesson
          </Link>
        </div>
      </div>

      <div className="stat-grid">
        <StatTile label="Active students" value={studentIds.length} />
        <StatTile label="Upcoming lessons" value={upcoming.length} />
        <StatTile label="Completed lessons" value={completed.length} />
        <StatTile label="Reports outstanding" value={outstandingReports} hint={outstandingReports > 0 ? "Needs chasing" : undefined} />
      </div>

      <div className="profile-grid">
        <div className="stack">
          <Card>
            <CardHeader title="Upcoming lessons" />
            <CardBody className="card__body--flush">
              {upcoming.length === 0 ? (
                <EmptyState title="No upcoming lessons" description={`${tutor.name.split(" ")[0]} has nothing scheduled.`} />
              ) : (
                <LessonList>
                  {upcoming.slice(0, 6).map((lesson) => (
                    <LessonRow
                      key={lesson.id}
                      lesson={lesson}
                      subtitle={lesson.studentIds.map((sid) => studentNames.get(sid)).filter(Boolean).join(", ")}
                      showRelative
                    />
                  ))}
                </LessonList>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Tuition assignments" description="The ongoing relationships this tutor is part of." />
            <CardBody className="card__body--flush">
              {assignments.length === 0 ? (
                <EmptyState title="No assignments yet" description="Assign this tutor to a student to start scheduling lessons." />
              ) : (
                <ul className="record-list">
                  {assignments.map((assignment) => (
                    <li className="record-list__item" key={assignment.id}>
                      <Link href={`/dashboard/admin/assignments/${assignment.id}`} className="record-list__link">
                        <span className="record-list__body">
                          <span className="record-list__title">{assignment.title}</span>
                          <span className="record-list__meta">
                            {assignment.studentIds.map((sid) => studentNames.get(sid)).filter(Boolean).join(", ")} · {assignment.subject}
                          </span>
                        </span>
                        <span className="record-list__aside"><StatusBadge status={assignment.status} /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recent reports" />
            <CardBody className="card__body--flush">
              {recentReports.length === 0 ? (
                <EmptyState title="No reports yet" />
              ) : (
                <ul className="record-list">
                  {recentReports.slice(0, 5).map((report) => (
                    <li className="record-list__item" key={report.id}>
                      <Link href={`/dashboard/lessons/${report.lessonId}`} className="record-list__link">
                        <span className="record-list__body">
                          <span className="record-list__title">{report.title}</span>
                          <span className="record-list__meta">{formatDateOnly(report.startAt)}</span>
                        </span>
                        <span className="record-list__aside"><StatusBadge status={report.status} /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="Students" />
            <CardBody className="card__body--flush">
              {studentIds.length === 0 ? (
                <EmptyState title="No students assigned" />
              ) : (
                <PersonList>
                  {studentIds.map((studentId) => (
                    <PersonRow
                      key={studentId}
                      name={studentNames.get(studentId) ?? "Unknown student"}
                      href={`/dashboard/admin/students/${studentId}`}
                    />
                  ))}
                </PersonList>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Availability" description="Recurring weekly windows this tutor has set." />
            <CardBody>
              {availability.length === 0 ? (
                <EmptyState title="No availability set" description="The tutor sets this from their own dashboard." />
              ) : (
                <ul className="plain-list">
                  {[...availability].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)).map((block) => (
                    <li key={block.id}>
                      <span>{WEEKDAYS[block.weekday]}, {block.startTime}–{block.endTime}</span>
                      <Badge tone={block.type === "AVAILABLE" ? "positive" : "muted"}>
                        {block.type === "AVAILABLE" ? "Available" : "Unavailable"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
