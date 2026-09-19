import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { LessonForm } from "@/components/LessonForm";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = createMetadata({
  title: "Schedule Lesson",
  description: "Schedule a new lesson.",
  path: "/dashboard/admin/lessons/new",
});

export default async function NewLessonPage() {
  await requireRole(["ADMIN"]);
  const data = getDataProvider();
  const assignments = (await data.assignments.list()).filter((a) => a.status === "ACTIVE");

  return (
    <div className="page--narrow">
      <PageHeader
        title="Schedule a lesson"
        description="One-off or repeating. Everyone on the assignment is notified once it's booked."
        backTo={{ href: "/dashboard/calendar", label: "Back to Calendar" }}
        breadcrumbs={[
          { label: "Calendar", href: "/dashboard/calendar" },
          { label: "Schedule a lesson" },
        ]}
      />

      <Card className="card--form">
        <CardBody>
          {assignments.length === 0 ? (
            <EmptyState
              icon={<CalendarPlus size={22} aria-hidden="true" />}
              title="No active Tuition Assignments yet"
              description="A lesson always belongs to an assignment — that's what pairs a tutor with a student and sets the default subject and duration."
              action={
                <Link href="/dashboard/admin/assignments" className="btn btn--primary">
                  Create an assignment
                </Link>
              }
            />
          ) : (
            <LessonForm assignments={assignments.map((a) => ({
              id: a.id, title: a.title, subject: a.subject,
              defaultDurationMinutes: a.defaultDurationMinutes, defaultLocationType: a.defaultLocationType,
            }))} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
