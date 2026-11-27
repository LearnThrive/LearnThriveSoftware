import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guard";
import { getDataProvider } from "@/lib/data/provider";
import { lessonEntryFor, lessonJoinRole, recordSupervision } from "@/lib/classroom/lessonEntry";
import { ClassroomClient } from "@/features/classroom/ClassroomClient";

export const metadata: Metadata = {
  title: "Online Classroom | LearnThrive",
  description: "Real-time interactive classroom session.",
};

export default async function LessonClassroomPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  const { id } = await params;

  const lesson = await getDataProvider().lessons.get(id);
  if (!lesson) notFound();

  // The same rule as the Join button and the reconnect route (lib/classroom/lessonEntry.ts): its tutor, a student on it, or an administrator, who
  // enters as a supervisor. Anyone else is turned away. The join link is made here, fresh, every time the page is opened: one carried in the address
  // is ignored, because it lasts five minutes and refreshing the page after that would lock the person out of their own lesson.
  if (!lessonJoinRole(user, lesson)) redirect("/403");
  const entry = lessonEntryFor(user, lesson);
  if (!entry.ok) redirect(`/dashboard/lessons/${id}?joinError=${encodeURIComponent(entry.message)}`);
  if (entry.role === "supervisor") await recordSupervision(user, lesson.id);

  // No background override: the classroom paints its own surfaces (a cream page around dark stage
  // tiles). A navy one underneath was invisible during a call — .call-app covers it — but showed
  // through on the post-class "ended" screen, which has no background of its own, leaving that
  // screen's heading dark-on-navy and unreadable.
  return (
    <div className="classroom-page-container">
      <ClassroomClient lessonId={id} initialToken={entry.token} />
    </div>
  );
}
