"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  raiseConcern, updateConcern, SafeguardingError, type ConcernCategory, type ConcernStatus, type VettingKind,
} from "@learnthrive/data/safeguarding";
import { requirePermission, requireRole } from "@/lib/auth/guard";
import { holds } from "@/lib/auth/scope";
import { getDataProvider } from "@/lib/data/provider";
import { logOutcome } from "@/lib/log";
import { concernsOpen, getSafeguarding, notifyLeads, safeguardingLeads, todayInLondon } from "@/lib/safeguarding/runtime";

/**
 * Safeguarding actions (docs/SAFEGUARDING_RECORDS.md). Each re-checks who is calling HERE: a Server Action is a POST endpoint anyone can
 * call directly, so the page guard is not authoritative (docs/ROLE_PERMISSIONS.md).
 *
 *   vetting   ADMIN only. A tutor never sees or changes their own vetting record.
 *   raise     a TUTOR or an ADMIN. Stored first, then the leads are told by an email that carries no details.
 *   update    a named safeguarding lead only: being an administrator is not enough (the data layer refuses and records the attempt).
 */

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** A rule said no (a SafeguardingError): back to the page with the message. Anything else is a real failure. */
async function attempt(back: string, done: string, change: () => Promise<void>): Promise<never> {
  try {
    await change();
  } catch (error) {
    if (error instanceof SafeguardingError) redirect(`${back}${back.includes("?") ? "&" : "?"}toast=${encodeURIComponent(error.message)}`);
    throw error;
  }
  revalidatePath(back.split("?")[0]!);
  redirect(`${back}${back.includes("?") ? "&" : "?"}toast=${encodeURIComponent(done)}`);
}

export async function recordVettingCheckAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const tutorId = text(formData, "tutorId");
  await attempt(`/dashboard/admin/tutors/${encodeURIComponent(tutorId)}`, "Check recorded", async () => {
    if (!(await getDataProvider().tutors.get(tutorId))) throw new SafeguardingError("NOT_FOUND", "That tutor does not exist.");
    await getSafeguarding().vetting.record({
      tutorId, kind: text(formData, "kind") as VettingKind, checkedOn: text(formData, "checkedOn"), expiresOn: text(formData, "expiresOn") || null,
      how: text(formData, "how"), note: text(formData, "note"), recordedBy: admin.id,
    }, todayInLondon());
    revalidatePath("/dashboard/admin/vetting");
  });
}

export async function voidVettingCheckAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const tutorId = text(formData, "tutorId");
  await attempt(`/dashboard/admin/tutors/${encodeURIComponent(tutorId)}`, "Check removed", async () => {
    await getSafeguarding().vetting.void(text(formData, "checkId"), text(formData, "reason"), admin.id);
    revalidatePath("/dashboard/admin/vetting");
  });
}

export async function raiseConcernAction(formData: FormData): Promise<void> {
  const user = await requirePermission("concern.raise");
  // With no lead named there is nobody to read it: refuse rather than store it (the page shows the published contact route instead).
  if (!concernsOpen()) redirect(`/dashboard/concerns?toast=${encodeURIComponent("Concerns cannot be raised here yet. Use the contact details on this page.")}`);
  await attempt("/dashboard/concerns", "", async () => {
    const immediateDanger = text(formData, "immediateDanger") === "true";
    const receipt = await raiseConcern(getSafeguarding(), {
      raisedBy: user.id, raisedByRole: holds(user, "ADMIN") ? "ADMIN" : "TUTOR", category: text(formData, "category") as ConcernCategory, about: text(formData, "about"),
      studentRef: null, lessonRef: null, details: text(formData, "details"), immediateDanger,
    });
    const told = await notifyLeads(receipt, immediateDanger);
    // Counts only: never who raised it, who it is about or what it says.
    logOutcome("safeguarding-concern", told.sent > 0 ? "raised" : "raised_email_not_sent", { leadsEmailed: told.sent, leads: told.of });
    redirect(`/dashboard/concerns?raised=${encodeURIComponent(receipt.reference)}${told.sent > 0 ? "" : "&told=0"}`);
  });
}

const STATUSES: readonly string[] = ["OPEN", "IN_REVIEW", "CLOSED"];

export async function updateConcernAction(formData: FormData): Promise<void> {
  const user = await requireRole(["ADMIN"]);
  const id = text(formData, "concernId");
  const status = text(formData, "status");
  await attempt(`/dashboard/admin/concerns/${encodeURIComponent(id)}`, "Saved", async () => {
    const outcome = await updateConcern(getSafeguarding(), id, { id: user.id, email: user.email }, safeguardingLeads(), {
      ...(STATUSES.includes(status) ? { status: status as ConcernStatus } : {}), note: text(formData, "note"),
    });
    if (!outcome.ok) redirect("/403");
  });
}
