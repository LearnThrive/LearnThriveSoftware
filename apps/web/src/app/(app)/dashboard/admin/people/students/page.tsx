import type { Metadata } from "next";
import { GraduationCap, Plus } from "lucide-react";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { createStudentAction } from "@/lib/actions/people";
import { PageHeader } from "@/components/shell/PageHeader";
import { PeopleTabs } from "@/components/people/PeopleTabs";
import { PersonList, PersonRow } from "@/components/people/PersonRow";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormActions } from "@/components/ui/Field";
import { SearchInput } from "@/components/ui/SearchInput";
import { formatLessonDayTime } from "@/lib/format";
import { matchesQuery, peopleCounts } from "@/lib/people/peopleHelpers";

export const metadata: Metadata = createMetadata({
  title: "Students",
  description: "Everyone learning with LearnThrive.",
  path: "/dashboard/admin/people/students",
});

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole(["ADMIN"]);
  const { q = "" } = await searchParams;
  const data = getDataProvider();

  const [students, clients, lessons, counts] = await Promise.all([
    data.students.list(), data.clients.list(), data.lessons.list(), peopleCounts(data),
  ]);

  const nowIso = new Date().toISOString();
  const clientsByStudent = new Map<string, string[]>();
  for (const student of students) {
    const linked = await data.students.clientsFor(student.id);
    clientsByStudent.set(student.id, linked.map((client) => client.name));
  }

  const visible = students.filter((student) => matchesQuery(q, student.name, student.yearGroup, ...(clientsByStudent.get(student.id) ?? [])));

  return (
    <>
      <PageHeader
        eyebrow="People"
        title="Students"
        description="Everyone learning with LearnThrive, and who looks after them."
        actions={
          <Dialog
            trigger={<><Plus size={16} aria-hidden="true" />Add student</>}
            title="Add a student"
            description="You can link them to a parent now, or do it later."
          >
            <form action={createStudentAction} className="form">
              <Field label="Full name" htmlFor="student-name" required>
                <input id="student-name" name="name" required autoComplete="off" />
              </Field>
              <Field label="Year group" htmlFor="student-year" hint="For example, Year 10.">
                <input id="student-year" name="yearGroup" placeholder="Year 10" autoComplete="off" />
              </Field>
              <Field label="Parent or guardian" htmlFor="student-client" hint="Links this student to the person responsible for them.">
                <select id="student-client" name="clientId" defaultValue="">
                  <option value="">Not linked yet</option>
                  {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
              </Field>
              <FormActions>
                <button type="submit" className="btn btn--primary">Add student</button>
              </FormActions>
            </form>
          </Dialog>
        }
      />

      <PeopleTabs current="students" counts={counts} />

      <div className="list-toolbar">
        <SearchInput placeholder="Search students, year groups or parents…" label="Search students" />
        <p className="list-toolbar__count">{visible.length} of {students.length}</p>
      </div>

      <Card className={visible.length === 0 ? "card--empty" : ""}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<GraduationCap size={22} />}
            title={q ? `No students match “${q}”` : "No students yet"}
            description={q
              ? "Try a different name, year group or parent."
              : "Add your first student to begin assigning tutors and scheduling lessons."}
          />
        ) : (
          <PersonList identityLabel="Student" columnLabels={["Parent", "Next lesson"]}>
            {visible.map((student) => {
              const next = lessons
                .filter((lesson) => lesson.status !== "CANCELLED" && lesson.studentIds.includes(student.id) && lesson.startAt >= nowIso)
                .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
              return (
                <PersonRow
                  key={student.id}
                  name={student.name}
                  subtitle={student.yearGroup}
                  href={`/dashboard/admin/students/${student.id}`}
                  active={student.active}
                  columns={[
                    { label: "Parent", value: clientsByStudent.get(student.id)?.join(", ") || "Not linked" },
                    { label: "Next lesson", value: next ? formatLessonDayTime(next.startAt) : "None scheduled" },
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
