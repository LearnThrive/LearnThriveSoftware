import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { formatInTimeZone } from "@/lib/scheduling/timezone";
import { ResetDevDataButton } from "@/components/ResetDevDataButton";

export const metadata: Metadata = createMetadata({
  title: "Admin",
  description: "LearnThrive administration.",
  path: "/dashboard/admin",
});

// The first role-restricted route in this platform — proves requireRole()/the 403 path for
// real. Summary cards below use actual repository data (plan section 17: "do not build fake
// business charts from invented data") — there's no scheduling data yet (Phase D), so this
// only shows what genuinely exists today: people and assignment counts.
export default async function AdminPage() {
  const user = await requireRole(["ADMIN"]);
  const data = getDataProvider();
  const [tutors, clients, students, assignments, recentActivity] = await Promise.all([
    data.tutors.list(), data.clients.list(), data.students.list(), data.assignments.list(),
    data.activity.recent(10),
  ]);
  const activeAssignments = assignments.filter((a) => a.status === "ACTIVE").length;

  return (
    <div className="dashboard-page">
      <h1>Administration</h1>
      <p>Signed in as <strong>{user.name}</strong>.</p>

      <div className="dashboard-summary-cards">
        <div className="dashboard-summary-card"><strong>{tutors.length}</strong><span>Tutors</span></div>
        <div className="dashboard-summary-card"><strong>{clients.length}</strong><span>Clients</span></div>
        <div className="dashboard-summary-card"><strong>{students.length}</strong><span>Students</span></div>
        <div className="dashboard-summary-card"><strong>{activeAssignments}</strong><span>Active Tuition Assignments</span></div>
      </div>

      <div className="dashboard-quick-actions">
        <Link href="/dashboard/admin/people" className="button button--secondary"><span>People</span></Link>
        <Link href="/dashboard/admin/assignments" className="button button--secondary"><span>Tuition Assignments</span></Link>
        {process.env.NODE_ENV !== "production" && <ResetDevDataButton />}
      </div>

      <h2>Recent activity</h2>
      <ul className="people-list">
        {recentActivity.length === 0 && <li className="people-list__empty">No activity recorded yet.</li>}
        {recentActivity.map((event) => (
          <li key={event.id}>
            <Link href={`/dashboard/lessons/${event.lessonId}`}>{event.message}</Link>
            <span className="people-list__meta">{formatInTimeZone(event.createdAt, "Europe/London", { dateStyle: "medium", timeStyle: "short" })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
