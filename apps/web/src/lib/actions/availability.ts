"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { requireRole } from "@/lib/auth/guard";

// Both actions operate on the *calling Tutor's own* profileId only — never a tutorId taken from
// form input — so one Tutor can never edit another's availability (an IDOR this specific design
// choice rules out by construction, not just by convention).

export async function addAvailabilityAction(formData: FormData): Promise<void> {
  const user = await requireRole(["TUTOR"]);
  if (!user.profileId) throw new Error("Your account isn't linked to a Tutor profile yet.");

  const weekday = Number(formData.get("weekday"));
  const startTime = String(formData.get("startTime") ?? "");
  const endTime = String(formData.get("endTime") ?? "");
  const type = formData.get("type") === "UNAVAILABLE" ? "UNAVAILABLE" as const : "AVAILABLE" as const;
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !startTime || !endTime) {
    throw new Error("Weekday, start time, and end time are required.");
  }

  const data = getDataProvider();
  await data.availability.create({ tutorId: user.profileId, type, weekday, startTime, endTime });
  revalidatePath("/dashboard/tutor/availability");
  // A redirect (even back to the same path) is what actually closes the Dialog this form lives
  // in — a bare revalidatePath() re-renders the Server Component tree with fresh data but leaves
  // the Dialog's own client-side `open` state untouched, so it would otherwise stay open over
  // the very list it just updated. Also gives this flow the same toast confirmation every other
  // creation form already has (plan6 section 37).
  redirect(`/dashboard/tutor/availability?toast=${encodeURIComponent("Availability added")}`);
}

export async function removeAvailabilityAction(formData: FormData): Promise<void> {
  const user = await requireRole(["TUTOR"]);
  if (!user.profileId) throw new Error("Your account isn't linked to a Tutor profile yet.");

  const blockId = String(formData.get("blockId") ?? "");
  const data = getDataProvider();
  const own = await data.availability.forTutor(user.profileId);
  // Only remove a block that's genuinely this Tutor's own — same IDOR guard as above, applied
  // to the delete path specifically (a blockId alone doesn't prove ownership).
  if (!own.some((b) => b.id === blockId)) throw new Error("Availability block not found.");
  await data.availability.remove(blockId);
  revalidatePath("/dashboard/tutor/availability");
  redirect(`/dashboard/tutor/availability?toast=${encodeURIComponent("Availability removed")}`);
}
