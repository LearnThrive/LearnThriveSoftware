import type { Metadata } from "next";
import { ClipboardList, Plus } from "lucide-react";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { createAssignmentAction } from "@/lib/actions/people";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormActions } from "@/components/ui/Field";
import { SearchInput } from "@/components/ui/SearchInput";
import { matchesQuery } from "@/lib/people/peopleHelpers";
import { RecordList, RecordRow } from "@/components/records/RecordRow";

export const metadata: Metadata = createMetadata({
  title: "Tuition assignments",
  description: "The ongoing tutor, student and subject relationships.",
  path: "/dashboard/admin/assignments",
});

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole(["ADMIN"]);
  const { q = "" } = await searchParams;
  const data = getDataProvider();
  const [assignments, tutors, students, lessons] = await Promise.all([
    data.assignments.list(), data.tutors.list(), data.students.list(), data.lessons.list(),
  ]);

  const tutorNames = new Map(tutors.map((tutor) => [tutor.id, tutor.name]));
  const studentNames = new Map(students.map((student) => [student.id, student.name]));

  const visible = assignments.filter((assignment) => matchesQuery(
    q, assignment.title, assignment.subject, tutorNames.get(assignment.tutorId),
    ...assignment.studentIds.map((id) => studentNames.get(id)),
  ));

  return (
    <>
      <PageHeader
        eyebrow="Tuition"
        title="Tuition assignments"
        description="The ongoing relationship between a tutor, their students and a subject. Lessons are scheduled against these."
        actions={
          <Dialog
            trigger={<><Plus size={16} aria-hidden="true" />Create assignment</>}
            title="Create a tuition assignment"
            description="Pair a tutor with one or more students for a subject."
          >
            <form action={createAssignmentAction} className="form">
              <Field label="Title" htmlFor="assignment-title" required hint="How it appears throughout the product, e.g. GCSE Mathematics — Ayaan.">
                <input id="assignment-title" name="title" required autoComplete="off" />
              </Field>
              <Field label="Subject" htmlFor="assignment-subject" required>
                <input id="assignment-subject" name="subject" required autoComplete="off" />
              </Field>
              <Field label="Level" htmlFor="assignment-level" hint="For example GCSE or A-Level.">
                <input id="assignment-level" name="level" autoComplete="off" />
              </Field>
              <Field label="Tutor" htmlFor="assignment-tutor" required>
                <select id="assignment-tutor" name="tutorId" required defaultValue="">
                  <option value="" disabled>Choose a tutor</option>
                  {tutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.name}</option>)}
                </select>
              </Field>
              <Field label="Student(s)" htmlFor="assignment-students" required hint="Hold Ctrl or Cmd to choose more than one.">
                <select id="assignment-students" name="studentIds" multiple required size={Math.min(6, Math.max(3, students.length))}>
                  {students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
                </select>
              </Field>
              <FormActions>
                <button type="submit" className="btn btn--primary">Create assignment</button>
              </FormActions>
            </form>
          </Dialog>
        }
      />

      <div className="list-toolbar">
        <SearchInput placeholder="Search assignments, tutors or students…" label="Search assignments" />
        <p className="list-toolbar__count">{visible.length} of {assignments.length}</p>
      </div>

      <Card className={visible.length === 0 ? "card--empty" : ""}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={22} />}
            title={q ? `No assignments match “${q}”` : "No tuition assignments yet"}
            description={q
              ? "Try a different title, subject, tutor or student."
              : "Create one to pair a tutor with a student, then schedule lessons against it."}
          />
        ) : (
          <RecordList>
            {visible.map((assignment) => {
              const lessonCount = lessons.filter((lesson) => lesson.assignmentId === assignment.id).length;
              return (
                <RecordRow
                  key={assignment.id}
                  href={`/dashboard/admin/assignments/${assignment.id}`}
                  title={assignment.title}
                  meta={[
                    assignment.studentIds.map((id) => studentNames.get(id)).filter(Boolean).join(", "),
                    tutorNames.get(assignment.tutorId) ?? "Unassigned",
                    `${lessonCount} lesson${lessonCount === 1 ? "" : "s"}`,
                  ].join(" · ")}
                  aside={<StatusBadge status={assignment.status} />}
                />
              );
            })}
          </RecordList>
        )}
      </Card>
    </>
  );
}
