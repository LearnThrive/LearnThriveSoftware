import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";

export const metadata: Metadata = createMetadata({
  title: "Dashboard",
  description: "Your LearnThrive dashboard.",
  path: "/dashboard",
});

const ROLE_COPY: Record<string, { heading: string; body: string }> = {
  ADMIN: {
    heading: "Welcome back",
    body: "The full Admin dashboard (lessons today, active students/tutors, reports awaiting review, quick actions) arrives with the scheduling and people-management phases of this platform.",
  },
  TUTOR: {
    heading: "Welcome back",
    body: "Your teaching dashboard (today's lessons, your students, reports due) arrives once lessons and tuition assignments exist in this platform.",
  },
  CLIENT: {
    heading: "Welcome back",
    body: "Your family dashboard (your children's upcoming lessons and reports) arrives once tuition assignments and lessons exist in this platform.",
  },
  STUDENT: {
    heading: "Welcome back",
    body: "Your dashboard (your next lesson, calendar and feedback) arrives once lessons exist in this platform.",
  },
};

export default async function DashboardPage() {
  const user = await requireSession();
  const copy = ROLE_COPY[user.role];

  return (
    <div className="dashboard-page">
      <h1>{copy.heading}, {user.name.split(" ")[0]}.</h1>
      <p>{copy.body}</p>
      <p className="dashboard-page__note">
        You are signed in as <strong>{user.email}</strong>.
      </p>
    </div>
  );
}
