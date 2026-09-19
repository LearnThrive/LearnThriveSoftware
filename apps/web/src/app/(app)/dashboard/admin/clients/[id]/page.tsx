import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import { formatDateOnly, formatLessonDayTime } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const client = await getDataProvider().clients.get(id);
  return createMetadata({ title: client?.name ?? "Client", description: "Client profile.", path: `/dashboard/admin/clients/${id}` });
}

/** Plan6 section 47: the same structured design as the other profiles, with the children this
 * client is responsible for shown prominently. */
export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["ADMIN"]);
  const { id } = await params;
  const data = getDataProvider();
  const client = await data.clients.get(id);
  if (!client) notFound();

  const [children, lessons, tutors] = await Promise.all([
    data.students.studentsFor(client.id),
    data.lessons.forClient(client.id),
    data.tutors.list(),
  ]);

  const nowIso = new Date().toISOString();
  const tutorNames = new Map(tutors.map((tutor) => [tutor.id, tutor.name]));
  const studentNames = new Map(children.map((child) => [child.id, child.name]));
  const upcoming = lessons.filter((lesson) => lesson.status !== "CANCELLED" && lesson.startAt >= nowIso)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));

  const reports: Array<{ id: string; status: string; lessonId: string; title: string; startAt: string }> = [];
  for (const lesson of lessons.filter((candidate) => candidate.startAt < nowIso).sort((a, b) => b.startAt.localeCompare(a.startAt))) {
    const report = await data.reports.forLesson(lesson.id);
    // Only approved reports are what this family can actually read, so that's what's counted here.
    if (report?.status === "APPROVED") reports.push({ id: report.id, status: report.status, lessonId: lesson.id, title: lesson.title, startAt: lesson.startAt });
  }

  return (
    <>
      <PageHeader
        backTo={{ href: "/dashboard/admin/people/clients", label: "Back to clients" }}
        breadcrumbs={[
          { label: "People", href: "/dashboard/admin/people/students" },
          { label: "Clients", href: "/dashboard/admin/people/clients" },
          { label: client.name },
        ]}
        title=""
      />

      <div className="profile-header">
        <div className="profile-header__identity">
          <Avatar name={client.name} size="lg" />
          <div className="profile-header__names">
            <h1 className="profile-header__name">{client.name}</h1>
            <p className="profile-header__meta">
              <span>Parent or guardian</span>
              <Badge tone={client.active ? "positive" : "muted"}>{client.active ? "Active" : "Inactive"}</Badge>
            </p>
            <p className="profile-header__meta">
              <a href={`mailto:${client.email}`}>{client.email}</a>
              {client.phone && <><span>·</span><a href={`tel:${client.phone}`}>{client.phone}</a></>}
            </p>
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <StatTile label={children.length === 1 ? "Child" : "Children"} value={children.length} />
        <StatTile label="Upcoming lessons" value={upcoming.length} />
        <StatTile label="Approved reports" value={reports.length} />
      </div>

      <div className="profile-grid">
        <div className="stack">
          <Card>
            <CardHeader title={children.length === 1 ? "Child" : "Children"} description="Who this client is responsible for." />
            <CardBody className="card__body--flush">
              {children.length === 0 ? (
                <EmptyState title="No children linked" description="Link a student to this client from the student's own record." />
              ) : (
                <PersonList identityLabel="Student" columnLabels={["Year group", "Next lesson"]}>
                  {children.map((child) => {
                    const next = upcoming.find((lesson) => lesson.studentIds.includes(child.id));
                    return (
                      <PersonRow
                        key={child.id}
                        name={child.name}
                        href={`/dashboard/admin/students/${child.id}`}
                        active={child.active}
                        columns={[
                          { label: "Year group", value: child.yearGroup ?? "Not set" },
                          { label: "Next lesson", value: next ? formatLessonDayTime(next.startAt) : "None scheduled" },
                        ]}
                      />
                    );
                  })}
                </PersonList>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Upcoming lessons" />
            <CardBody className="card__body--flush">
              {upcoming.length === 0 ? (
                <EmptyState title="No upcoming lessons" />
              ) : (
                <LessonList>
                  {upcoming.slice(0, 6).map((lesson) => (
                    <LessonRow
                      key={lesson.id}
                      lesson={lesson}
                      subtitle={[
                        lesson.studentIds.map((sid) => studentNames.get(sid)).filter(Boolean).join(", "),
                        tutorNames.get(lesson.tutorId),
                      ].filter(Boolean).join(" · ")}
                      showRelative
                    />
                  ))}
                </LessonList>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Reports shared" description="Approved reports this family can read." />
          <CardBody className="card__body--flush">
            {reports.length === 0 ? (
              <EmptyState title="Nothing shared yet" description="Reports appear here once an admin approves them." />
            ) : (
              <ul className="record-list">
                {reports.slice(0, 8).map((report) => (
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
    </>
  );
}
