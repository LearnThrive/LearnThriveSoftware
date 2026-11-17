import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownUp, BookOpen, ClipboardList, GraduationCap, Plus } from "lucide-react";
import type { TuitionAssignment } from "@learnthrive/data/domain";
import { SearchSelect } from "@/components/ui/SearchSelect";
import { TEACHING_SUBJECTS, canonicalSubject } from "@/lib/subjects";
import { yearGroups } from "@/lib/site";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@/lib/data/provider";
import { createAssignmentAction } from "@/lib/actions/people";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormActions } from "@/components/ui/Field";
import { SearchInput } from "@/components/ui/SearchInput";
import { AssignmentSubjectTutorFields } from "@/components/people/AssignmentFields";
import { matchesQuery } from "@/lib/people/peopleHelpers";
import { RecordList, RecordRow } from "@/components/records/RecordRow";

export const metadata: Metadata = createMetadata({
  title: "Tuition assignments",
  description: "The ongoing tutor, student and subject relationships.",
  path: "/dashboard/admin/assignments",
});

const SORTS = [
  { id: "newest", name: "Newest first" },
  { id: "title", name: "Title A to Z" },
  { id: "subject", name: "Subject" },
  { id: "year", name: "Year group, youngest first" },
  { id: "tutor", name: "Tutor A to Z" },
] as const;
const NO_YEAR = "none";
const OTHER_SUBJECT = "other";

/**
 * Every tuition assignment, findable: search by text, and narrow by subject and by year group (the students' own year groups), in any
 * order. Every choice is a query parameter, so a filtered list is a link that survives a reload. Subjects match by meaning (lib/subjects.ts),
 * so an older "Mathematics" assignment is under Maths.
 */
export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<{ q?: string; subject?: string; year?: string; sort?: string }> }) {
  await requireRole(["ADMIN"]);
  const { q = "", subject = "all", year = "all", sort: rawSort = "newest" } = await searchParams;
  const sort = SORTS.some((s) => s.id === rawSort) ? rawSort : "newest";
  const data = getDataProvider();
  const [assignments, tutors, students, lessons] = await Promise.all([
    data.assignments.list(), data.tutors.list(), data.students.list(), data.lessons.list(),
  ]);

  const tutorNames = new Map(tutors.map((tutor) => [tutor.id, tutor.name]));
  const studentById = new Map(students.map((student) => [student.id, student]));
  const subjectOf = (a: TuitionAssignment) => canonicalSubject(a.subject) ?? OTHER_SUBJECT;
  const yearsOf = (a: TuitionAssignment) => [...new Set(a.studentIds.map((id) => studentById.get(id)?.yearGroup || NO_YEAR))];
  const yearRank = (y: string) => { const i = (yearGroups as readonly string[]).indexOf(y); return i === -1 ? 999 : i; };

  // The options offered are the ones that exist, each with how many assignments it has.
  const subjectOptions = [...TEACHING_SUBJECTS, OTHER_SUBJECT]
    .map((s) => ({ id: s, name: s === OTHER_SUBJECT ? "Other subjects" : s, count: assignments.filter((a) => subjectOf(a) === s).length }))
    .filter((o) => o.count > 0);
  const yearOptions = [...new Set(assignments.flatMap(yearsOf))]
    .sort((a, b) => yearRank(a) - yearRank(b))
    .map((y) => ({ id: y, name: y === NO_YEAR ? "No year group set" : y, count: assignments.filter((a) => yearsOf(a).includes(y)).length }));

  const visible = assignments
    .filter((assignment) => subject === "all" || subjectOf(assignment) === subject)
    .filter((assignment) => year === "all" || yearsOf(assignment).includes(year))
    .filter((assignment) => matchesQuery(
      q, assignment.title, assignment.subject, assignment.level, tutorNames.get(assignment.tutorId),
      ...assignment.studentIds.flatMap((id) => [studentById.get(id)?.name, studentById.get(id)?.yearGroup]),
    ))
    .sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "subject") return subjectOf(a).localeCompare(subjectOf(b)) || a.title.localeCompare(b.title);
      if (sort === "tutor") return (tutorNames.get(a.tutorId) ?? "").localeCompare(tutorNames.get(b.tutorId) ?? "") || a.title.localeCompare(b.title);
      if (sort === "year") return Math.min(...yearsOf(a).map(yearRank)) - Math.min(...yearsOf(b).map(yearRank)) || a.title.localeCompare(b.title);
      return b.createdAt.localeCompare(a.createdAt);
    });
  const filtered = Boolean(q) || subject !== "all" || year !== "all";

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
              <Field label="Title" htmlFor="assignment-title" required hint="How it appears throughout the product, e.g. GCSE Mathematics — Brian.">
                <input id="assignment-title" name="title" required autoComplete="off" />
              </Field>
              {/* Inactive tutors are not offered: that includes the archived "Former tutor" row a purge uses for history (0018). */}
              <AssignmentSubjectTutorFields
                tutors={tutors.filter((tutor) => tutor.active).map((tutor) => ({ id: tutor.id, name: tutor.name, subjects: tutor.subjects }))}
              />
              <Field label="Level" htmlFor="assignment-level" hint="For example GCSE or A-Level.">
                <input id="assignment-level" name="level" autoComplete="off" />
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

      <div className="filter-bar">
        <SearchInput placeholder="Search title, student, tutor or year…" label="Search assignments" />
        <div className="filter-bar__selects">
          <SearchSelect
            plain
            icon={<BookOpen size={15} />}
            basePath="/dashboard/admin/assignments"
            param="subject"
            value={subject}
            caption="Subject"
            placeholder="All subjects"
            searchLabel="Subjects"
            all={{ label: "All subjects", count: assignments.length }}
            options={subjectOptions}
          />
          <SearchSelect
            plain
            icon={<GraduationCap size={15} />}
            basePath="/dashboard/admin/assignments"
            param="year"
            value={year}
            caption="Year group"
            placeholder="All year groups"
            searchLabel="Year groups"
            all={{ label: "All year groups", count: assignments.length }}
            options={yearOptions}
          />
          <SearchSelect
            plain
            icon={<ArrowDownUp size={15} />}
            basePath="/dashboard/admin/assignments"
            param="sort"
            value={sort}
            caption="Sort"
            placeholder="Newest first"
            searchLabel="Sort order"
            options={SORTS.map((s) => ({ id: s.id, name: s.name }))}
          />
        </div>
        <p className="list-toolbar__count">
          {visible.length} of {assignments.length}
          {filtered && <> · <Link href="/dashboard/admin/assignments">Clear filters</Link></>}
        </p>
      </div>

      <Card className={visible.length === 0 ? "card--empty" : ""}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={22} />}
            title={filtered ? "No assignments match these filters" : "No tuition assignments yet"}
            description={filtered
              ? "Try another subject, year group or search, or clear the filters."
              : "Create one to pair a tutor with a student, then schedule lessons against it."}
          />
        ) : (
          <RecordList>
            {visible.map((assignment) => {
              const lessonCount = lessons.filter((lesson) => lesson.assignmentId === assignment.id).length;
              const studentsLine = assignment.studentIds
                .map((id) => studentById.get(id))
                .filter((student) => student !== undefined)
                .map((student) => (student.yearGroup ? `${student.name} (${student.yearGroup})` : student.name))
                .join(", ");
              return (
                <RecordRow
                  key={assignment.id}
                  href={`/dashboard/admin/assignments/${assignment.id}`}
                  title={assignment.title}
                  meta={[
                    [canonicalSubject(assignment.subject) ?? assignment.subject, assignment.level].filter(Boolean).join(", "),
                    studentsLine,
                    tutorNames.get(assignment.tutorId) ?? "Unassigned",
                    `${lessonCount} lesson${lessonCount === 1 ? "" : "s"}`,
                  ].filter(Boolean).join(" · ")}
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
