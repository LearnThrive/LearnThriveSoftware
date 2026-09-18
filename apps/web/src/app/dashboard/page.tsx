import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { visibleLessonsFor } from "@/lib/scheduling/visibleLessons";
import { formatInTimeZone } from "@/lib/scheduling/timezone";

export const metadata: Metadata = createMetadata({
  title: "Dashboard",
  description: "Your LearnThrive dashboard.",
  path: "/dashboard",
});

// Plan sections 71-73's mobile priority lists, honoured here first since this is the one page
// every role lands on: Tutor wants their next lesson and what still needs doing; Client/Student
// want their next lesson and nothing else competing for attention.
export default async function DashboardPage() {
  const user = await requireSession();
  const data = getDataProvider();
  const lessons = await visibleLessonsFor(data, user);
  const now = new Date().toISOString();
  const upcoming = lessons.filter((l) => l.status !== "CANCELLED" && l.startAt >= now).sort((a, b) => a.startAt.localeCompare(b.startAt));
  const nextLesson = upcoming[0] ?? null;

  const needsAttention = user.role === "TUTOR"
    ? lessons.filter((l) => (l.status === "PLANNED" || l.status === "IN_PROGRESS") && l.startAt < now).sort((a, b) => a.startAt.localeCompare(b.startAt)).slice(0, 5)
    : [];

  return (
    <div className="dashboard-page">
      <h1>Welcome back, {user.name.split(" ")[0]}.</h1>

      {nextLesson ? (
        <>
          <h2>Next lesson</h2>
          <p>
            <Link href={`/dashboard/lessons/${nextLesson.id}`}>{nextLesson.title}</Link>
            {" — "}{formatInTimeZone(nextLesson.startAt, "Europe/London", { dateStyle: "full", timeStyle: "short" })}
          </p>
        </>
      ) : (
        <p className="dashboard-page__note">No upcoming lessons scheduled.</p>
      )}

      {user.role === "TUTOR" && needsAttention.length > 0 && (
        <>
          <h2>Needs attention</h2>
          <ul className="people-list">
            {needsAttention.map((l) => (
              <li key={l.id}>
                <Link href={`/dashboard/lessons/${l.id}`}>{l.title}</Link>
                <span className="people-list__meta">{formatInTimeZone(l.startAt, "Europe/London", { dateStyle: "medium", timeStyle: "short" })} — mark attendance / write report</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="dashboard-quick-actions">
        <Link href="/dashboard/calendar" className="button button--secondary"><span>Calendar</span></Link>
        <Link href="/dashboard/notifications" className="button button--secondary"><span>Notifications</span></Link>
        {user.role === "TUTOR" && <Link href="/dashboard/tutor/availability" className="button button--secondary"><span>My Availability</span></Link>}
        {user.role === "ADMIN" && <Link href="/dashboard/admin" className="button button--secondary"><span>Administration</span></Link>}
      </div>

      <p className="dashboard-page__note">
        You are signed in as <strong>{user.email}</strong>.
      </p>
    </div>
  );
}
