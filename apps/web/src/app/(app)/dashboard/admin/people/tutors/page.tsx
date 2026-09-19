import type { Metadata } from "next";
import { Plus, UserRound } from "lucide-react";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { createTutorAction } from "@/lib/actions/people";
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
  title: "Tutors",
  description: "The tutors teaching with LearnThrive.",
  path: "/dashboard/admin/people/tutors",
});

export default async function TutorsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole(["ADMIN"]);
  const { q = "" } = await searchParams;
  const data = getDataProvider();

  const [tutors, assignments, lessons, counts] = await Promise.all([
    data.tutors.list(), data.assignments.list(), data.lessons.list(), peopleCounts(data),
  ]);

  const nowIso = new Date().toISOString();
  const visible = tutors.filter((tutor) => matchesQuery(q, tutor.name, tutor.email, ...tutor.subjects));

  return (
    <>
      <PageHeader
        eyebrow="People"
        title="Tutors"
        description="Who's teaching, what they cover, and how busy they are."
        actions={
          <Dialog
            trigger={<><Plus size={16} aria-hidden="true" />Add tutor</>}
            title="Add a tutor"
            description="They can be assigned to students once added."
          >
            <form action={createTutorAction} className="form">
              <Field label="Full name" htmlFor="tutor-name" required>
                <input id="tutor-name" name="name" required autoComplete="off" />
              </Field>
              <Field label="Email" htmlFor="tutor-email" required>
                <input id="tutor-email" name="email" type="email" required autoComplete="off" />
              </Field>
              <Field label="Subjects" htmlFor="tutor-subjects" hint="Separate several with commas — Mathematics, Physics.">
                <input id="tutor-subjects" name="subjects" placeholder="Mathematics, Physics" autoComplete="off" />
              </Field>
              <FormActions>
                <button type="submit" className="btn btn--primary">Add tutor</button>
              </FormActions>
            </form>
          </Dialog>
        }
      />

      <PeopleTabs current="tutors" counts={counts} />

      <div className="list-toolbar">
        <SearchInput placeholder="Search tutors or subjects…" label="Search tutors" />
        <p className="list-toolbar__count">{visible.length} of {tutors.length}</p>
      </div>

      <Card>
        {visible.length === 0 ? (
          <EmptyState
            icon={<UserRound size={22} />}
            title={q ? `No tutors match “${q}”` : "No tutors yet"}
            description={q
              ? "Try a different name, email or subject."
              : "Add your first tutor to begin assigning students and scheduling lessons."}
          />
        ) : (
          <PersonList identityLabel="Tutor" columnLabels={["Subjects", "Students", "Next lesson"]}>
            {visible.map((tutor) => {
              const theirAssignments = assignments.filter((assignment) => assignment.tutorId === tutor.id);
              const studentCount = new Set(theirAssignments.flatMap((assignment) => assignment.studentIds)).size;
              const next = lessons
                .filter((lesson) => lesson.status !== "CANCELLED" && lesson.tutorId === tutor.id && lesson.startAt >= nowIso)
                .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
              return (
                <PersonRow
                  key={tutor.id}
                  name={tutor.name}
                  subtitle={tutor.email}
                  href={`/dashboard/admin/tutors/${tutor.id}`}
                  active={tutor.active}
                  columns={[
                    { label: "Subjects", value: tutor.subjects.join(", ") || "None listed" },
                    { label: "Students", value: studentCount === 0 ? "None" : `${studentCount}` },
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
