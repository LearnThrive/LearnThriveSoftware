import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Lesson } from "@learnthrive/data/domain";
import { StatusBadge } from "@/components/ui/Badge";
import { formatLessonDayTime, formatRelative, formatTimeRange } from "@/lib/format";

/**
 * One lesson as a scannable row — used by the Lessons list, dashboards and profile pages so a
 * lesson looks and behaves identically wherever it appears (plan6 section 87's consolidation
 * rule). Collapses to a stacked card on narrow screens via CSS (section 83), no separate mobile
 * component to keep in sync.
 */
export function LessonRow({ lesson, subtitle, showRelative = false, leading }: {
  lesson: Lesson;
  /** A tick box ahead of the row (the administrator's bulk cancel). The row stays one link; the box is a sibling, not inside it. */
  leading?: React.ReactNode;
  /** Who it's with — resolved by the caller, which already knows the names it needs. */
  subtitle?: string;
  showRelative?: boolean;
}) {
  return (
    <li className={leading ? "lesson-row lesson-row--selectable" : "lesson-row"}>
      {leading}
      <Link href={`/dashboard/lessons/${lesson.id}`} className="lesson-row__link">
        <span className="lesson-row__when">
          <span className="lesson-row__day">{formatLessonDayTime(lesson.startAt)}</span>
          <span className="lesson-row__time">{formatTimeRange(lesson.startAt, lesson.durationMinutes)}</span>
        </span>
        <span className="lesson-row__what">
          <span className="lesson-row__title">{lesson.title}</span>
          {subtitle && <span className="lesson-row__subtitle">{subtitle}</span>}
        </span>
        <span className="lesson-row__meta">
          {showRelative && lesson.status === "PLANNED" && (
            <span className="lesson-row__relative">{formatRelative(lesson.startAt)}</span>
          )}
          <StatusBadge status={lesson.status} />
          <ChevronRight size={16} aria-hidden="true" className="lesson-row__chevron" />
        </span>
      </Link>
    </li>
  );
}

export function LessonList({ children }: { children: React.ReactNode }) {
  return <ul className="lesson-list">{children}</ul>;
}
