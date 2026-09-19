import type { ReactNode } from "react";

/**
 * One badge vocabulary for every status in the product (plan6 section 34). Tones are semantic,
 * not decorative: "positive" always means a good terminal state, "warning" always means someone
 * needs to act, "muted" always means inert. Each tone meets contrast requirements against its
 * own background — the colour is a reinforcement of the label, never the only signal.
 */
export type BadgeTone = "neutral" | "positive" | "warning" | "critical" | "info" | "muted";

const STATUS_TONES: Record<string, BadgeTone> = {
  // Lesson statuses
  PLANNED: "info",
  IN_PROGRESS: "warning",
  COMPLETED: "positive",
  CANCELLED: "muted",
  NO_SHOW: "critical",
  // Report statuses
  DRAFT: "muted",
  SUBMITTED: "warning",
  APPROVED: "positive",
  // Attendance
  ATTENDED: "positive",
  LATE: "warning",
  ABSENT: "critical",
  EXCUSED: "info",
  // Assignment / person states
  ACTIVE: "positive",
  PAUSED: "warning",
  ENDED: "muted",
  INACTIVE: "muted",
  // Roles
  ADMIN: "neutral",
  TUTOR: "info",
  CLIENT: "neutral",
  STUDENT: "neutral",
};

/** Sentence case for machine-shaped values (`IN_PROGRESS` -> `In progress`). */
export function humaniseStatus(value: string): string {
  const spaced = value.replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/** Badge for a known domain status string, picking its tone and human label automatically. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{humaniseStatus(status)}</Badge>;
}
