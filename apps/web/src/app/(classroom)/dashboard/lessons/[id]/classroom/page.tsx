import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guard";
import { joinRoleFor } from "@/lib/auth/teaching";
import { getDataProvider } from "@/lib/data/provider";
import { signClassroomJoinToken } from "@learnthrive/shared/classroomToken";
import { isWithinJoinWindow } from "@/lib/scheduling/joinWindow";
import { ClassroomClient } from "@/features/classroom/ClassroomClient";

export const metadata: Metadata = {
  title: "Online Classroom | LearnThrive",
  description: "Real-time interactive classroom session.",
};

export default async function LessonClassroomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const user = await requireSession();
  const { id } = await params;
  const { token: paramToken } = await searchParams;

  const data = getDataProvider();
  const lesson = await data.lessons.get(id);
  if (!lesson) notFound();

  // IDOR & assignment check. An administrator who is not this lesson's tutor has no join role: they never enter as its tutor.
  const joinRole = joinRoleFor(user, lesson);

  if (user.role !== "ADMIN" && !joinRole) {
    redirect("/403");
  }

  if (lesson.locationType !== "ONLINE" || !lesson.classroomRoomId) {
    redirect(`/dashboard/lessons/${id}?joinError=${encodeURIComponent("This lesson is not scheduled for an online classroom.")}`);
  }

  if (lesson.status === "CANCELLED") {
    redirect(`/dashboard/lessons/${id}?joinError=${encodeURIComponent("This lesson has been cancelled.")}`);
  }

  // Join window check
  if (joinRole) {
    if (!isWithinJoinWindow(lesson, joinRole)) {
      redirect(`/dashboard/lessons/${id}?joinError=${encodeURIComponent("The classroom is not open yet. Please check back closer to the start time.")}`);
    }
  }

  const token = paramToken || signClassroomJoinToken({
    roomId: lesson.classroomRoomId,
    lessonId: lesson.id,
    name: user.name,
    role: joinRole === "TUTOR" ? "tutor" : "student",
    // A Server Component renders once per request on the server, with no client
    // reconciliation/memoization to destabilize; a short-lived token expiry genuinely needs the
    // real current time, same as lib/actions/classroom.ts's identical exp calculation (not
    // flagged there, since a Server Action isn't treated as a "component" by this rule).
    // eslint-disable-next-line react-hooks/purity
    exp: Date.now() + 5 * 60_000,
  });

  // No background override: the classroom paints its own surfaces (a cream page around dark stage
  // tiles). A navy one underneath was invisible during a call — .call-app covers it — but showed
  // through on the post-class "ended" screen, which has no background of its own, leaving that
  // screen's heading dark-on-navy and unreadable.
  return (
    <div className="classroom-page-container">
      <ClassroomClient lessonId={id} initialToken={token} />
    </div>
  );
}
