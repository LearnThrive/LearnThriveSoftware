import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { studentProgressFor, type ProgressEntry } from "@/lib/dashboard/progress";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader, StatTile } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatLongDate } from "@/lib/format";

export const metadata: Metadata = createMetadata({
  title: "Progress",
  description: "A student's lessons and lesson reports over time.",
  path: "/dashboard/progress",
});

// How many upcoming lessons the page lists; the full schedule is the Calendar.
const UPCOMING_SHOWN = 3;

const ENGAGEMENT_LABEL = { LOW: "Needed encouragement", MEDIUM: "Engaged", HIGH: "Highly engaged" } as const;

/**
 * Plan15 feature A2: "progress you can see" over time. Which student, lessons and report text this person
 * may see is decided by studentProgressFor (lib/dashboard/progress.ts), which only reads through the same
 * visibility functions the other pages use; a student they may not see is a 404, exactly like an id that
 * does not exist. Tutor-only notes are not part of the data this page receives.
 */
export default async function ProgressPage({ params }: { params: Promise<{ studentId: string }> }) {
  const user = await requireSession();
  const { studentId } = await params;
  const progress = await studentProgressFor(getDataProvider(), user, studentId);
  if (!progress) notFound();

  const { student, entries } = progress;
  const upcoming = entries.filter((entry) => entry.upcoming).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const history = entries.filter((entry) => !entry.upcoming);
  const back =
    user.role === "ADMIN" ? { href: `/dashboard/admin/students/${student.id}`, label: `Back to ${student.name}` }
    : user.role === "TUTOR" ? { href: "/dashboard/students", label: "Back to my students" }
    : user.role === "CLIENT" ? { href: "/dashboard/children", label: "Back to your children" }
    : { href: "/dashboard/reports", label: "Back to feedback" };

  return (
    <>
      <PageHeader
        eyebrow="Progress"
        title={student.name}
        description={
          user.role === "CLIENT" || user.role === "STUDENT"
            ? "Every lesson and the report written after it, newest first."
            : "Lessons and lesson reports over time, newest first."
        }
        backTo={back}
        meta={student.yearGroup ? <span>{student.yearGroup}</span> : undefined}
      />

      <div className="stat-grid">
        <StatTile label="Lessons completed" value={progress.completedCount} />
        <StatTile label="Lesson reports" value={progress.reportCount} />
        <StatTile label="Coming up" value={upcoming.length} />
      </div>

      <div className="stack">
      {upcoming.length > 0 ? (
        <Card>
          <CardHeader title="Coming up" description={upcoming.length > UPCOMING_SHOWN ? `The next ${UPCOMING_SHOWN} of ${upcoming.length} lessons.` : undefined} />
          <CardBody>
            <ul className="progress-upcoming">
              {upcoming.slice(0, UPCOMING_SHOWN).map((entry) => (
                <li key={entry.lessonId}>
                  <time dateTime={entry.startAt}>{formatLongDate(entry.startAt)}</time>
                  <Link href={`/dashboard/lessons/${entry.lessonId}`}>{entry.title}</Link>
                  <span>{entry.subject}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card className={history.length === 0 ? "card--empty" : ""}>
        {history.length === 0 ? (
          <EmptyState
            icon={<TrendingUp size={22} />}
            title="No lessons yet"
            description="Once a lesson has taken place, it appears here with the report written after it."
          />
        ) : (
          <>
            <CardHeader title="Lesson history" />
            <CardBody>
              <ol className="progress-timeline">
                {history.map((entry) => (
                  <TimelineEntry key={entry.lessonId} entry={entry} />
                ))}
              </ol>
            </CardBody>
          </>
        )}
      </Card>
      </div>
    </>
  );
}

function TimelineEntry({ entry }: { entry: ProgressEntry }) {
  const { report } = entry;
  return (
    <li className="progress-timeline__item">
      <span className="progress-timeline__dot" aria-hidden="true" />
      <div className="progress-timeline__head">
        <time dateTime={entry.startAt}>{formatLongDate(entry.startAt)}</time>
        <StatusBadge status={entry.status} />
        {report && report.status !== "APPROVED" ? <StatusBadge status={report.status} /> : null}
      </div>
      <h3 className="progress-timeline__title">
        <Link href={`/dashboard/lessons/${entry.lessonId}`}>{entry.title}</Link>
        <span className="progress-timeline__subject">{entry.subject}</span>
      </h3>
      {report ? (
        <div className="progress-timeline__report">
          <p>{report.publicSummary}</p>
          <dl>
            {report.progress ? (
              <div>
                <dt>Progress</dt>
                <dd>{report.progress}</dd>
              </div>
            ) : null}
            {report.areasForImprovement ? (
              <div>
                <dt>To work on</dt>
                <dd>{report.areasForImprovement}</dd>
              </div>
            ) : null}
            {report.nextSteps ? (
              <div>
                <dt>Next steps</dt>
                <dd>{report.nextSteps}</dd>
              </div>
            ) : null}
            {report.engagement ? (
              <div>
                <dt>Engagement</dt>
                <dd>{ENGAGEMENT_LABEL[report.engagement]}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : (
        <p className="progress-timeline__none">No report has been shared for this lesson yet.</p>
      )}
    </li>
  );
}
