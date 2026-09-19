import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { visibleReportsFor } from "@/lib/dashboard/queries";
import { visibleReportFor } from "@/lib/reports/reportService";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { StatusBadge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { formatDateOnly } from "@/lib/format";
import type { Lesson, LessonReport } from "@learnthrive/data/domain";

export const metadata: Metadata = createMetadata({
  title: "Lesson reports",
  description: "Lesson reports, grouped by what still needs doing.",
  path: "/dashboard/reports",
});

type Filter = "awaiting" | "approved" | "drafts" | "all";

// Role decides both the tabs and the wording: an Admin is approving other people's work, a Tutor
// is completing their own, a Client/Student is reading what was shared with them (plan6 s63).
const FILTERS_BY_ROLE: Record<string, Filter[]> = {
  ADMIN: ["awaiting", "approved", "drafts", "all"],
  TUTOR: ["drafts", "awaiting", "approved", "all"],
  CLIENT: ["approved"],
  STUDENT: ["approved"],
};

const LABELS: Record<Filter, string> = {
  awaiting: "Awaiting approval",
  approved: "Approved",
  drafts: "Needs completion",
  all: "All",
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const user = await requireSession();
  const available = FILTERS_BY_ROLE[user.role] ?? ["approved"];
  const { filter: rawFilter } = await searchParams;
  const filter: Filter = available.includes(rawFilter as Filter) ? (rawFilter as Filter) : available[0];

  const data = getDataProvider();
  const pairs = await visibleReportsFor(data, user);

  // A Client/Student may only ever see approved reports, and only their public fields — the same
  // single gate the lesson page uses, never a second implementation of the visibility rule.
  const readable = pairs.filter(({ report }) => visibleReportFor(user, report) !== null);

  const buckets: Record<Filter, Array<{ report: LessonReport; lesson: Lesson }>> = {
    awaiting: readable.filter(({ report }) => report.status === "SUBMITTED"),
    approved: readable.filter(({ report }) => report.status === "APPROVED"),
    drafts: readable.filter(({ report }) => report.status === "DRAFT"),
    all: readable,
  };
  const rows = buckets[filter];

  const studentNames = new Map((await data.students.list()).map((student) => [student.id, student.name]));
  const tutorNames = new Map((await data.tutors.list()).map((tutor) => [tutor.id, tutor.name]));

  return (
    <>
      <PageHeader
        eyebrow="Tuition"
        title={user.role === "STUDENT" ? "Your feedback" : "Lesson reports"}
        description={user.role === "ADMIN"
          ? "Review and approve what tutors have written before families see it."
          : user.role === "TUTOR"
            ? "Reports you still owe, and those already submitted or approved."
            : "Reports your tutor has written and an admin has approved."}
      />

      {available.length > 1 && (
        <FilterTabs
          basePath="/dashboard/reports"
          param="filter"
          current={filter}
          options={available.map((value) => ({
            value,
            label: LABELS[value],
            count: buckets[value].length,
            tone: (value === "awaiting" && user.role === "ADMIN" && buckets.awaiting.length > 0)
              || (value === "drafts" && user.role === "TUTOR" && buckets.drafts.length > 0)
              ? "warning" : undefined,
          }))}
        />
      )}

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<FileText size={22} />}
            title={filter === "awaiting" ? "Nothing awaiting approval" : filter === "drafts" ? "No reports to finish" : "No reports yet"}
            description={user.role === "CLIENT" || user.role === "STUDENT"
              ? "Once a tutor writes a report and it's approved, it will appear here."
              : "Reports are written from a lesson, once its attendance has been marked."}
          />
        ) : (
          <ul className="record-list">
            {rows.map(({ report, lesson }) => {
              const students = lesson.studentIds.map((id) => studentNames.get(id)).filter(Boolean).join(", ");
              return (
                <li key={report.id} className="record-list__item">
                  <Link href={`/dashboard/lessons/${lesson.id}`} className="record-list__link">
                    <Avatar name={students || lesson.title} size="md" />
                    <span className="record-list__body">
                      <span className="record-list__title">{lesson.title}</span>
                      <span className="record-list__meta">
                        {students || "No students"}
                        {user.role !== "TUTOR" && ` · ${tutorNames.get(lesson.tutorId) ?? "Unknown tutor"}`}
                        {` · ${formatDateOnly(lesson.startAt)}`}
                      </span>
                    </span>
                    <span className="record-list__aside"><StatusBadge status={report.status} /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
