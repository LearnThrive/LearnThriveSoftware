import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { LessonForm } from "@/components/LessonForm";

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
    <div className="dashboard-page">
      <h1>Schedule a lesson</h1>
      {assignments.length === 0 ? (
        <p>No active Tuition Assignments yet — <a href="/dashboard/admin/assignments">create one first</a>.</p>
      ) : (
        <LessonForm assignments={assignments.map((a) => ({
          id: a.id, title: a.title, subject: a.subject,
          defaultDurationMinutes: a.defaultDurationMinutes, defaultLocationType: a.defaultLocationType,
        }))} />
      )}
    </div>
  );
}
