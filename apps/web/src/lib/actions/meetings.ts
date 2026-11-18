"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MeetingError } from "@learnthrive/data/meetings";
import { requireRole, requireSession } from "@/lib/auth/guard";
import { holds } from "@/lib/auth/scope";
import { enterMeeting } from "@/lib/meetings/entry";
import { getMeetings, staffDirectory } from "@/lib/meetings/runtime";
import { zonedTimeToUtc } from "@/lib/scheduling/timezone";

/**
 * Staff meetings (docs/STAFF_MEETINGS.md). Each action re-checks who is calling HERE: a Server Action is a POST endpoint anyone can call directly.
 *   create   an administrator: schedules one, or starts one now and goes straight in.
 *   cancel   the host, or any administrator.
 *   join     the host or an invited person who is staff, inside the window.
 */
const ID = /^[0-9a-f-]{36}$/i;
const PAGE = "/dashboard/meetings";
const toast = (message: string): never => redirect(`${PAGE}?toast=${encodeURIComponent(message)}`);

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** The browser's classroom address for this meeting, or the separately hosted classroom when one is configured (the same rule as a lesson's). */
function classroomUrl(meetingId: string, token: string): string {
  const external = process.env.NEXT_PUBLIC_CLASSROOM_URL;
  if (external && !external.includes("localhost:5173") && !external.includes("127.0.0.1:5173")) return `${external}/?token=${encodeURIComponent(token)}`;
  return `/dashboard/meetings/${meetingId}/classroom?token=${encodeURIComponent(token)}`;
}

export async function createMeetingAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const now = text(formData, "intent") === "now";
  const duration = Number(text(formData, "durationMinutes") || "60");
  const date = text(formData, "date");
  const time = text(formData, "time");
  if (!now && (!date || !time)) toast("Choose a date and a time, or start the meeting now.");
  const startsAt = now ? new Date() : (() => {
    const [year, month, day] = date.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    return zonedTimeToUtc({ year: year!, month: month!, day: day!, hour: hour!, minute: minute! }, "Europe/London");
  })();
  // Only people who really are staff with a working login can be invited: an id from the browser is looked up, never trusted for a name or a role.
  const directory = new Map((await staffDirectory()).map((p) => [p.id, p]));
  const invitees = [...new Set(formData.getAll("invitee").map(String))].flatMap((id) => (directory.get(id) ? [directory.get(id)!] : []));
  let meetingId: string;
  try {
    const meeting = await getMeetings().create({
      title: text(formData, "title") || (now ? "Quick meeting" : ""), startsAt: startsAt.toISOString(), durationMinutes: duration, hostId: admin.id, hostName: admin.name, invitees,
    });
    meetingId = meeting.id;
  } catch (error) {
    if (error instanceof MeetingError) return toast(error.message);
    throw error;
  }
  revalidatePath(PAGE);
  if (now) {
    const entry = await enterMeeting(admin, meetingId);
    if (entry.ok) redirect(classroomUrl(meetingId, entry.token));
  }
  toast("Meeting scheduled. The people you invited will see it under Meetings.");
}

export async function cancelMeetingAction(formData: FormData): Promise<void> {
  const user = await requireRole(["ADMIN", "TUTOR", "JUNIOR_TUTOR"]);
  const id = text(formData, "meetingId");
  if (!ID.test(id)) toast("There is no such meeting.");
  const meeting = await getMeetings().get(id);
  if (!meeting) toast("There is no such meeting.");
  if (meeting!.hostId !== user.id && !holds(user, "ADMIN")) toast("Only the host or an administrator can cancel a meeting.");
  await getMeetings().cancel(id, user.id);
  revalidatePath(PAGE);
  toast("Meeting cancelled.");
}

export async function joinMeetingAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  const id = text(formData, "meetingId");
  if (!ID.test(id)) toast("There is no such meeting.");
  const entry = await enterMeeting(user, id);
  if (!entry.ok) toast(entry.message);
  else redirect(classroomUrl(id, entry.token));
}
