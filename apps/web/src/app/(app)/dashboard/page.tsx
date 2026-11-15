import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guard";
import { asRole, rolesOf } from "@/lib/auth/scope";
import { asTutor } from "@/lib/auth/teaching";
import { createMetadata } from "@/lib/metadata";
import { AdminDashboard } from "@/components/dashboards/AdminDashboard";
import { TeachingSection, TutorDashboard } from "@/components/dashboards/TutorDashboard";
import { ClientDashboard } from "@/components/dashboards/ClientDashboard";
import { StudentDashboard } from "@/components/dashboards/StudentDashboard";
import { GettingStarted } from "@/components/dashboards/GettingStarted";

export const metadata: Metadata = createMetadata({
  title: "Dashboard",
  description: "Your LearnThrive dashboard.",
  path: "/dashboard",
});

// One landing route, four genuinely different jobs (plan6 sections 50-54): an Admin is asking
// "what needs my attention today", a Tutor "what am I teaching next and what do I still owe", a
// Client "when is my child's next lesson", a Student "where do I go now". Each gets its own
// component rather than one page full of role conditionals.
export default async function DashboardPage() {
  const user = await requireSession();
  // A person with several roles gets the part of the dashboard for EACH role, every one scoped to that role's own record (lib/auth/scope.ts):
  // an administrator who teaches sees the admin view and their own teaching; a student who is a junior tutor sees their own learning and the
  // students they are assigned to, never anyone else's.
  const admin = asRole(user, "ADMIN");
  const teaching = asTutor(user);
  const parent = asRole(user, "CLIENT");
  const learner = asRole(user, "STUDENT");

  const parts = [
    admin ? <AdminDashboard key="admin" user={admin} /> : null,
    teaching ? (admin ? <TeachingSection key="teaching" user={teaching} /> : <TutorDashboard key="teaching" user={teaching} />) : null,
    parent ? <ClientDashboard key="parent" user={parent} /> : null,
    learner ? <StudentDashboard key="learner" user={learner} /> : null,
  ].filter(Boolean);
  const dashboard = parts.length > 0 ? <>{parts}</> : <StudentDashboard user={user} />;

  // First-run tips sit below the dashboard, dismissible (components/dashboards/GettingStarted.tsx).
  return (
    <>
      {dashboard}
      <GettingStarted roles={rolesOf(user)} />
    </>
  );
}
