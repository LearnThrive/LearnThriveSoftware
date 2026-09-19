import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, Video } from "lucide-react";
import type { Lesson } from "@learnthrive/data/domain";
import { StatusBadge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { LessonList, LessonRow } from "@/components/lessons/LessonRow";
import { formatLongDate, formatRelative, formatTimeRange } from "@/lib/format";
import { isWithinJoinWindow } from "@/lib/scheduling/joinWindow";

/** A greeting that reflects the actual time of day — small, but it's the first thing every
 * person reads and it makes the product feel present rather than static. */
export function greeting(now: Date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/London" }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The single most important thing on a Tutor's or Student's dashboard (plan6 sections 52 and 54):
 * the next lesson, when it is in plain words, and — the moment it's allowed — a prominent way in.
 * Before the window opens it says how long the wait is rather than just hiding the button
 * (section 59).
 */
export function NextLessonCard({ lesson, subtitle, role, canJoin }: {
  lesson: Lesson | null;
  subtitle?: string;
  role: "TUTOR" | "STUDENT";
  canJoin: boolean;
}) {
  if (!lesson) {
    return (
      <Card className="next-lesson next-lesson--empty">
        <CardBody>
          <EmptyState
            icon={<CalendarDays size={22} />}
            title="No lessons scheduled"
            description={role === "TUTOR"
              ? "When an admin schedules your next lesson, it will appear here."
              : "Your next lesson will appear here as soon as it's booked."}
          />
        </CardBody>
      </Card>
    );
  }

  const windowOpen = canJoin && isWithinJoinWindow(lesson, role);
  const online = lesson.locationType === "ONLINE" && lesson.status !== "CANCELLED";

  return (
    <Card className="next-lesson">
      <CardBody>
        <p className="next-lesson__eyebrow">Next lesson · {formatRelative(lesson.startAt)}</p>
        <h2 className="next-lesson__title">
          <Link href={`/dashboard/lessons/${lesson.id}`}>{lesson.title}</Link>
        </h2>
        {subtitle && <p className="next-lesson__subtitle">{subtitle}</p>}
        <p className="next-lesson__when">
          {formatLongDate(lesson.startAt)} · {formatTimeRange(lesson.startAt, lesson.durationMinutes)}
        </p>
        <div className="next-lesson__actions">
          {online && windowOpen && (
            <Link href={`/dashboard/lessons/${lesson.id}/classroom`} className="btn btn--primary">
              <Video size={16} aria-hidden="true" />Join classroom
            </Link>
          )}
          {online && !windowOpen && (
            <p className="next-lesson__countdown">
              Classroom opens {formatRelative(joinOpensAt(lesson, role))}
            </p>
          )}
          <Link href={`/dashboard/lessons/${lesson.id}`} className="btn btn--secondary">Lesson details</Link>
        </div>
      </CardBody>
    </Card>
  );
}

/** When this person's join window starts — mirrors joinWindow.ts's own thresholds. */
function joinOpensAt(lesson: Lesson, role: "TUTOR" | "STUDENT"): Date {
  const minutesBefore = role === "TUTOR" ? 30 : 10;
  return new Date(new Date(lesson.startAt).getTime() - minutesBefore * 60_000);
}

/** A titled card wrapping a list of lessons, used on every dashboard. */
export function LessonSection({ title, description, lessons, subtitleFor, emptyTitle, emptyDescription, action, showRelative }: {
  title: string;
  description?: string;
  lessons: Lesson[];
  subtitleFor?: (lesson: Lesson) => string | undefined;
  emptyTitle: string;
  emptyDescription?: string;
  action?: ReactNode;
  showRelative?: boolean;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
      <CardBody className="card__body--flush">
        {lessons.length === 0 ? (
          <EmptyState icon={<CalendarDays size={22} />} title={emptyTitle} description={emptyDescription} />
        ) : (
          <LessonList>
            {lessons.map((lesson) => (
              <LessonRow key={lesson.id} lesson={lesson} subtitle={subtitleFor?.(lesson)} showRelative={showRelative} />
            ))}
          </LessonList>
        )}
      </CardBody>
    </Card>
  );
}

/** Today's schedule as a compact timeline — the Admin's and Tutor's "what's happening now" view. */
export function TodaySchedule({ lessons, labelFor }: { lessons: Lesson[]; labelFor: (lesson: Lesson) => string }) {
  if (lessons.length === 0) {
    return <EmptyState icon={<CalendarDays size={22} />} title="Nothing scheduled today" description="A quieter one. Upcoming lessons are further down." />;
  }
  return (
    <ul className="day-schedule">
      {lessons.map((lesson) => (
        <li key={lesson.id} className="day-schedule__item">
          <span className="day-schedule__time">{formatTimeRange(lesson.startAt, lesson.durationMinutes)}</span>
          <span className="day-schedule__body">
            <Link href={`/dashboard/lessons/${lesson.id}`} className="day-schedule__title">{lesson.title}</Link>
            <span className="day-schedule__meta">{labelFor(lesson)}</span>
          </span>
          <StatusBadge status={lesson.status} />
        </li>
      ))}
    </ul>
  );
}
