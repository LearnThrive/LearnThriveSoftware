import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { lessonBucketsFor, visibleReportsFor } from "@/lib/dashboard/queries";
import { visibleReportFor } from "@/lib/reports/reportService";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LessonSection, NextLessonCard, greeting } from "@/components/dashboards/shared";
import { formatDateOnly, formatLongDate } from "@/lib/format";

/** Plan6 section 54: the simplest dashboard in the product. Where do I go, when, and what did my
 * tutor say last time. No administrative surface at all. */
export async function StudentDashboard({ user }: { user: AuthenticatedUser }) {
  const data = getDataProvider();
  const now = new Date();
  const [buckets, reportPairs] = await Promise.all([
    lessonBucketsFor(data, user, now),
    visibleReportsFor(data, user),
  ]);

  const tutorNames = new Map((await data.tutors.list()).map((tutor) => [tutor.id, tutor.name]));
  const tutorFor = (lesson: { tutorId: string }) => tutorNames.get(lesson.tutorId);

  const feedback = reportPairs
    .map(({ report, lesson }) => ({ visible: visibleReportFor(user, report), lesson }))
    .filter((entry): entry is { visible: NonNullable<ReturnType<typeof visibleReportFor>>; lesson: typeof entry.lesson } => entry.visible !== null)
    .slice(0, 3);

  return (
    <>
      <PageHeader
        eyebrow={formatLongDate(now)}
        title={`${greeting(now)}, ${user.name.split(" ")[0]}.`}
        description={buckets.next ? "Here's what's coming up." : "Nothing scheduled right now."}
      />

      <NextLessonCard
        lesson={buckets.next}
        subtitle={buckets.next ? `with ${tutorFor(buckets.next) ?? "your tutor"}` : undefined}
        role="STUDENT"
        canJoin
      />

      <div className="grid-2" style={{ marginTop: "var(--space-4)" }}>
        <LessonSection
          title="Your lessons"
          lessons={buckets.upcoming.slice(1, 6)}
          subtitleFor={(lesson) => `with ${tutorFor(lesson) ?? "your tutor"}`}
          showRelative
          emptyTitle="Nothing else scheduled"
          emptyDescription="Lessons after your next one will show up here."
          action={<Link href="/dashboard/calendar" className="btn btn--ghost btn--sm">Calendar</Link>}
        />

        <Card>
          <CardHeader
            title="Recent feedback"
            description="What your tutor said after your lessons."
            action={<Link href="/dashboard/reports" className="btn btn--ghost btn--sm">View all</Link>}
          />
          <CardBody className="card__body--flush">
            {feedback.length === 0 ? (
              <EmptyState
                icon={<MessageSquareText size={22} />}
                title="No feedback yet"
                description="After a lesson, your tutor writes a short report. It'll appear here once it's ready."
              />
            ) : (
              <ul className="record-list">
                {feedback.map(({ visible, lesson }) => (
                  <li key={visible.id} className="record-list__item">
                    <Link href={`/dashboard/lessons/${lesson.id}`} className="record-list__link">
                      <span className="record-list__body">
                        <span className="record-list__title">{lesson.title}</span>
                        <span className="record-list__meta">{formatDateOnly(lesson.startAt)} · {tutorFor(lesson) ?? "Your tutor"}</span>
                        {visible.publicSummary && <span className="record-list__excerpt">{visible.publicSummary}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
