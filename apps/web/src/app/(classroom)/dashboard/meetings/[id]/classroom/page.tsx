import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guard";
import { enterMeeting } from "@/lib/meetings/entry";
import { ClassroomClient } from "@/features/classroom/ClassroomClient";

export const metadata: Metadata = {
  title: "Staff meeting | LearnThrive",
  description: "A meeting between LearnThrive staff.",
};

/**
 * A staff meeting's room (docs/STAFF_MEETINGS.md). The same video room as a lesson, entered with a short-lived signed link. Every check is made
 * again here (staff, host or invited, not cancelled, open): the address bar proves nothing on its own, so a token from it is never used. A fresh
 * one is signed for the signed-in person after the checks pass.
 */
export default async function MeetingClassroomPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  const { id } = await params;
  const entry = await enterMeeting(user, id);
  if (!entry.ok) redirect(`/dashboard/meetings?toast=${encodeURIComponent(entry.message)}`);
  return (
    <div className="classroom-page-container">
      <ClassroomClient initialToken={entry.token} meetingId={id} returnHref="/dashboard/meetings" />
    </div>
  );
}
