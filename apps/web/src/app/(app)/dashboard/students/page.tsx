import type { Metadata } from "next";
import { GraduationCap } from "lucide-react";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { lessonBucketsFor, nextLessonForStudent, visibleStudentsFor } from "@/lib/dashboard/queries";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PersonList, PersonRow } from "@/components/people/PersonRow";
import { formatLessonDayTime } from "@/lib/format";

export const metadata: Metadata = createMetadata({
  title: "My students",
  description: "The students you teach.",
  path: "/dashboard/students",
});

// A Tutor's own students — everyone on one of their tuition assignments, and nobody else
// (plan6 section 18: no admin management navigation for a tutor).
export default async function TutorStudentsPage() {
  const user = await requireRole(["TUTOR"]);
  const data = getDataProvider();
  const [students, buckets] = await Promise.all([
    visibleStudentsFor(data, user),
    lessonBucketsFor(data, user),
  ]);

  const assignments = user.profileId ? await data.assignments.forTutor(user.profileId) : [];
  const subjectsByStudent = new Map<string, string[]>();
  for (const assignment of assignments) {
    for (const studentId of assignment.studentIds) {
      const existing = subjectsByStudent.get(studentId) ?? [];
      if (!existing.includes(assignment.subject)) existing.push(assignment.subject);
      subjectsByStudent.set(studentId, existing);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Teaching"
        title="My students"
        description="Everyone currently assigned to you, and when you next see them."
      />

      <Card className={students.length === 0 ? "card--empty" : ""}>
        {students.length === 0 ? (
          <EmptyState
            icon={<GraduationCap size={22} />}
            title="No students assigned yet"
            description="Once an admin assigns you to a student, they'll appear here with their upcoming lessons."
          />
        ) : (
          <PersonList identityLabel="Student" columnLabels={["Subjects", "Next lesson"]}>
            {students.map((student) => {
              const next = nextLessonForStudent(buckets.all, student.id);
              return (
                <PersonRow
                  key={student.id}
                  name={student.name}
                  subtitle={student.yearGroup}
                  active={student.active}
                  columns={[
                    { label: "Subjects", value: subjectsByStudent.get(student.id)?.join(", ") || "—" },
                    { label: "Next lesson", value: next ? formatLessonDayTime(next.startAt) : "Nothing scheduled" },
                  ]}
                />
              );
            })}
          </PersonList>
        )}
      </Card>
    </>
  );
}
