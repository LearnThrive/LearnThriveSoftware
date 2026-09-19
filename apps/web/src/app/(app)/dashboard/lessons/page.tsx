import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { lessonBucketsFor } from "@/lib/dashboard/queries";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LessonList, LessonRow } from "@/components/lessons/LessonRow";
import { FilterTabs } from "@/components/ui/FilterTabs";
import type { Lesson } from "@learnthrive/data/domain";

export const metadata: Metadata = createMetadata({
  title: "Lessons",
  description: "Every lesson you can see, filtered by what needs doing.",
  path: "/dashboard/lessons",
});

const FILTERS = ["upcoming", "needs-attention", "completed", "cancelled", "all"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABELS: Record<Filter, string> = {
  upcoming: "Upcoming",
  "needs-attention": "Needs attention",
  completed: "Completed",
  cancelled: "Cancelled",
  all: "All",
};

// Distinct from the Calendar: the calendar answers "when", this answers "what still needs doing"
// (plan6 section 57). Filtering is a real server-side query on a URL the person can bookmark and
// share, not client-side state that vanishes on reload.
export default async function LessonsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireSession();
  const { filter: rawFilter } = await searchParams;
  const filter: Filter = FILTERS.includes(rawFilter as Filter) ? (rawFilter as Filter) : "upcoming";

  const data = getDataProvider();
  const buckets = await lessonBucketsFor(data, user);

  const byFilter: Record<Filter, Lesson[]> = {
    upcoming: buckets.upcoming,
    "needs-attention": buckets.needsAttention,
    completed: buckets.all.filter((lesson) => lesson.status === "COMPLETED").sort((a, b) => b.startAt.localeCompare(a.startAt)),
    cancelled: buckets.all.filter((lesson) => lesson.status === "CANCELLED").sort((a, b) => b.startAt.localeCompare(a.startAt)),
    all: [...buckets.all].sort((a, b) => b.startAt.localeCompare(a.startAt)),
  };
  const lessons = byFilter[filter];

  // Names for the "who it's with" line, resolved once rather than per row.
  const studentNames = new Map((await data.students.list()).map((student) => [student.id, student.name]));
  const tutorNames = new Map((await data.tutors.list()).map((tutor) => [tutor.id, tutor.name]));

  function subtitleFor(lesson: Lesson): string {
    const students = lesson.studentIds.map((id) => studentNames.get(id)).filter(Boolean).join(", ");
    if (user.role === "TUTOR" || user.role === "CLIENT" || user.role === "STUDENT") {
      return user.role === "TUTOR" ? students : `with ${tutorNames.get(lesson.tutorId) ?? "your tutor"}`;
    }
    return [students, tutorNames.get(lesson.tutorId)].filter(Boolean).join(" · ");
  }

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Lessons"
        description={user.role === "ADMIN"
          ? "Every lesson across the platform, in one list."
          : "Your lessons, most urgent first."}
        actions={user.role === "ADMIN" ? (
          <Link href="/dashboard/admin/lessons/new" className="btn btn--primary">
            <Plus size={16} aria-hidden="true" />Schedule lesson
          </Link>
        ) : undefined}
      />

      <FilterTabs
        basePath="/dashboard/lessons"
        param="filter"
        current={filter}
        options={FILTERS.map((value) => ({
          value,
          label: FILTER_LABELS[value],
          count: byFilter[value].length,
          tone: value === "needs-attention" && byFilter[value].length > 0 ? "warning" : undefined,
        }))}
      />

      <Card className={lessons.length === 0 ? "card--empty" : ""}>
        {lessons.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={22} />}
            title={filter === "needs-attention" ? "Nothing needs attention" : `No ${FILTER_LABELS[filter].toLowerCase()} lessons`}
            description={filter === "needs-attention"
              ? "Every past lesson has been closed out with attendance and any required report."
              : filter === "upcoming"
                ? "Lessons you're scheduled for will appear here."
                : "Nothing to show under this filter yet."}
            action={user.role === "ADMIN" && filter === "upcoming" ? (
              <Link href="/dashboard/admin/lessons/new" className="btn btn--primary">
                <Plus size={16} aria-hidden="true" />Schedule a lesson
              </Link>
            ) : undefined}
          />
        ) : (
          <LessonList>
            {lessons.map((lesson) => (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                subtitle={subtitleFor(lesson)}
                showRelative={filter === "upcoming"}
              />
            ))}
          </LessonList>
        )}
      </Card>
    </>
  );
}
