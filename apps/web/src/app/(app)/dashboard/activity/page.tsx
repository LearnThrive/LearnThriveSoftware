import type { Metadata } from "next";
import Link from "next/link";
import { Activity } from "lucide-react";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatLessonDateTime, formatRelative } from "@/lib/format";

export const metadata: Metadata = createMetadata({
  title: "Activity",
  description: "Recent business activity across the platform.",
  path: "/dashboard/activity",
});

// Plan6 section 53: business activity, not debug logging. Every entry here is something a person
// did to a lesson — created, rescheduled, cancelled, attendance marked, completed, report
// submitted or approved. Nothing from the classroom's websocket traffic reaches this feed.
export default async function ActivityPage() {
  await requireRole(["ADMIN"]);
  const data = getDataProvider();
  const events = await data.activity.recent(80);
  const lessons = new Map((await data.lessons.list()).map((lesson) => [lesson.id, lesson]));

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Activity"
        description="What's been happening across lessons, attendance and reports."
      />

      <Card>
        {events.length === 0 ? (
          <EmptyState
            icon={<Activity size={22} />}
            title="No activity yet"
            description="Scheduling a lesson, marking attendance or approving a report will all show up here."
          />
        ) : (
          <ol className="timeline">
            {events.map((event) => {
              const lesson = lessons.get(event.lessonId);
              return (
                <li key={event.id} className="timeline__item">
                  <span className="timeline__marker" aria-hidden="true" />
                  <div className="timeline__body">
                    <p className="timeline__message">
                      {lesson
                        ? <Link href={`/dashboard/lessons/${event.lessonId}`}>{event.message}</Link>
                        : event.message}
                    </p>
                    <p className="timeline__meta">
                      {lesson ? `${lesson.title} · ` : ""}
                      <time dateTime={event.createdAt} title={formatLessonDateTime(event.createdAt)}>
                        {formatRelative(event.createdAt)}
                      </time>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </>
  );
}
