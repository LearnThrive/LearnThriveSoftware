import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { lessonBucketsFor, nextLessonForStudent, visibleStudentsFor } from "@/lib/dashboard/queries";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Avatar } from "@/components/ui/Avatar";
import { LessonList, LessonRow } from "@/components/lessons/LessonRow";

export const metadata: Metadata = createMetadata({
  title: "Children",
  description: "Your children and their upcoming lessons.",
  path: "/dashboard/children",
});

// Plan6 section 19: the parent's view is about their children, not about administration. Each
// child gets their own card with their tutors and what's coming up next.
export default async function ChildrenPage() {
  const user = await requireRole(["CLIENT"]);
  const data = getDataProvider();
  const [students, buckets] = await Promise.all([
    visibleStudentsFor(data, user),
    lessonBucketsFor(data, user),
  ]);
  const tutorNames = new Map((await data.tutors.list()).map((tutor) => [tutor.id, tutor.name]));

  return (
    <>
      <PageHeader
        eyebrow="Your family"
        title={students.length === 1 ? students[0].name : "Your children"}
        description="Upcoming lessons and who's teaching them."
      />

      {students.length === 0 ? (
        <Card className="card--empty">
          <EmptyState
            icon={<GraduationCap size={22} />}
            title="No children linked to your account yet"
            description="Once LearnThrive links your child to your account, their lessons and reports appear here."
          />
        </Card>
      ) : (
        <div className="stack">
          {students.map((student) => {
            const upcoming = buckets.upcoming.filter((lesson) => lesson.studentIds.includes(student.id)).slice(0, 4);
            const next = nextLessonForStudent(buckets.all, student.id);
            const tutors = [...new Set(
              buckets.all.filter((lesson) => lesson.studentIds.includes(student.id)).map((lesson) => tutorNames.get(lesson.tutorId)),
            )].filter(Boolean).join(", ");

            return (
              <Card key={student.id}>
                <CardHeader
                  title={
                    <span className="child-heading">
                      <Avatar name={student.name} size="md" />
                      <span>
                        {student.name}
                        {student.yearGroup && <span className="child-heading__year">{student.yearGroup}</span>}
                      </span>
                    </span>
                  }
                  description={tutors ? `Taught by ${tutors}` : "No tutor assigned yet"}
                  action={<Link href="/dashboard/calendar" className="btn btn--ghost">View calendar</Link>}
                />
                <CardBody className="card__body--flush">
                  {upcoming.length === 0 ? (
                    <EmptyState
                      title="No lessons scheduled"
                      description={next ? undefined : "LearnThrive will let you know as soon as the next lesson is booked."}
                    />
                  ) : (
                    <LessonList>
                      {upcoming.map((lesson) => (
                        <LessonRow
                          key={lesson.id}
                          lesson={lesson}
                          subtitle={`with ${tutorNames.get(lesson.tutorId) ?? "your tutor"}`}
                          showRelative
                        />
                      ))}
                    </LessonList>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
