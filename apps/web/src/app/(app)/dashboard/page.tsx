import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { AdminDashboard } from "@/components/dashboards/AdminDashboard";
import { TutorDashboard } from "@/components/dashboards/TutorDashboard";
import { ClientDashboard } from "@/components/dashboards/ClientDashboard";
import { StudentDashboard } from "@/components/dashboards/StudentDashboard";

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

  switch (user.role) {
    case "ADMIN": return <AdminDashboard user={user} />;
    case "TUTOR": return <TutorDashboard user={user} />;
    case "CLIENT": return <ClientDashboard user={user} />;
    default: return <StudentDashboard user={user} />;
  }
}
