"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PurgeKind, PurgePreview } from "@learnthrive/data/repositories";
import { PURGE_DELAY_DAYS } from "@learnthrive/data/repositories";
import { accountRuntime } from "@/lib/account/runtime";
import { setLoginDisabled } from "@/lib/account/provision";
import { requireRole } from "@/lib/auth/guard";
import { getDataProvider } from "@/lib/data/provider";
import { deleteStoredObjects } from "@/lib/purge/storage";

/**
 * The purge tool (launch checklist 3.7, docs/LAWFUL_BASES.md). An administrator confirms with a typed phrase, never with a click alone,
 * and only after the screen has shown exactly what goes and what stays. Every action re-checks ADMIN itself: a Server Action is a public
 * POST endpoint, so the page guard alone is not authoritative (docs/ROLE_PERMISSIONS.md).
 *
 * Order, and why: stored files first (a file whose row is gone can never be found again), then the login is DISABLED (if anything later
 * fails, the person still cannot sign in), then the database rows and the log row in one transaction, then the Auth user is deleted. If
 * that last step fails the purge is still complete and the login stays banned; the administrator is told so.
 */
const CONFIRMATION: Record<PurgeKind, string> = {
  STUDENT: "PURGE STUDENT",
  TUTOR: "PURGE TUTOR",
  FAMILY: "PURGE FAMILY",
};

const ID = /^[0-9a-zA-Z-]{8,64}$/;
/** A date typed into the "bring it forward" field, as a date input sends it. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const KINDS: PurgeKind[] = ["STUDENT", "TUTOR", "FAMILY"];
const parseKind = (value: string): PurgeKind | null => (KINDS.includes(value as PurgeKind) ? (value as PurgeKind) : null);

/** Where each kind's page lives, for the toast to land back on. */
const HOME: Record<PurgeKind, string> = {
  STUDENT: "/dashboard/admin/people/students",
  TUTOR: "/dashboard/admin/people/tutors",
  FAMILY: "/dashboard/admin/people/clients",
};

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Only ever back to a page of this dashboard: the form names where it came from. */
function returnPath(formData: FormData, fallback: string): string {
  const path = field(formData, "returnTo");
  return /^\/dashboard\/admin\/(tutors|clients|students)\/[0-9a-zA-Z-]{1,64}$/.test(path) ? path : fallback;
}

function back(path: string, toast: string): never {
  revalidatePath(path);
  redirect(`${path}?toast=${encodeURIComponent(toast)}`);
}

async function purge(kind: PurgeKind, id: string, preview: PurgePreview, actorId: string): Promise<string> {
  const stored = await deleteStoredObjects(preview.files);
  if (stored.failed > 0) throw new Error(`${stored.failed} stored file(s) could not be removed, so nothing was purged. Try again.`);

  const rt = await accountRuntime();
  if (rt) for (const profileId of preview.profileIds) await setLoginDisabled(rt, profileId, true, actorId);

  const data = getDataProvider();
  const record =
    kind === "STUDENT" ? await data.purges.purgeStudent(id, actorId)
    : kind === "TUTOR" ? await data.purges.purgeTutor(id, actorId)
    : await data.purges.purgeFamily(id, actorId);
  if (!record) throw new Error("There was nothing left to purge.");

  let stranded = 0;
  if (rt?.admin) {
    for (const profileId of preview.profileIds) if (!(await rt.admin.deleteUser(profileId))) stranded += 1;
  }
  const total = Object.values(record.counts).reduce((sum, n) => sum + n, 0);
  return `${total} record${total === 1 ? "" : "s"} purged${stranded ? `; ${stranded} login(s) could not be deleted from Auth and stay disabled` : ""}`;
}

async function run(kind: PurgeKind, formData: FormData, fallback: string): Promise<never> {
  const admin = await requireRole(["ADMIN"]);
  const path = returnPath(formData, fallback);
  const id = field(formData, "id");
  if (!ID.test(id)) back(path, "There is no such record");
  if (field(formData, "confirm").toUpperCase() !== CONFIRMATION[kind]) back(path, `Type ${CONFIRMATION[kind]} exactly to confirm`);

  const data = getDataProvider();
  const preview =
    kind === "STUDENT" ? await data.purges.previewStudent(id)
    : kind === "TUTOR" ? await data.purges.previewTutor(id)
    : await data.purges.previewFamily(id);
  if (!preview) back(path, "There is nothing to purge for that record");
  // The database refuses this as well (migration 0019). Checking here is so the administrator is told why, rather than being told
  // there was nothing to purge.
  if (preview.readiness === "not_left") back(path, "Mark them as left first: a purge waits so it is never a surprise");
  if (preview.readiness === "not_due") {
    back(path, `This cannot be purged until ${new Date(preview.purgeAfter!).toLocaleDateString("en-GB")}. Bring the date forward first if it must go sooner.`);
  }

  let toast: string;
  try {
    toast = await purge(kind, id, preview, admin.id);
  } catch (error) {
    back(path, error instanceof Error ? error.message : "That could not be done. Nothing was changed.");
  }
  back(kind === "STUDENT" ? "/dashboard/admin/people/students" : kind === "TUTOR" ? "/dashboard/admin/people/tutors" : "/dashboard/admin/people/clients", toast);
}

/**
 * The pause before a purge (launch checklist 3.7.3). Marking as left changes nothing else and deletes nothing: it records the decision
 * and starts the clock. It can be undone, and the date can be brought forward but never pushed back.
 */
export async function markLeftAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const kind = parseKind(field(formData, "kind"));
  const id = field(formData, "id");
  const path = returnPath(formData, kind ? HOME[kind] : "/dashboard");
  if (!kind || !ID.test(id)) back(path, "There is no such record");
  const state = await getDataProvider().purges.markLeft(kind, id, admin.id);
  if (!state?.purgeAfter) back(path, "That could not be changed");
  back(path, `Marked as left. It can be purged from ${new Date(state.purgeAfter).toLocaleDateString("en-GB")} (${PURGE_DELAY_DAYS} days).`);
}

export async function cancelLeftAction(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const kind = parseKind(field(formData, "kind"));
  const id = field(formData, "id");
  const path = returnPath(formData, kind ? HOME[kind] : "/dashboard");
  if (!kind || !ID.test(id)) back(path, "There is no such record");
  const undone = await getDataProvider().purges.cancelLeft(kind, id);
  back(path, undone ? "No longer marked as left. Nothing was deleted." : "That was not marked as left");
}

export async function bringForwardAction(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const kind = parseKind(field(formData, "kind"));
  const id = field(formData, "id");
  const path = returnPath(formData, kind ? HOME[kind] : "/dashboard");
  if (!kind || !ID.test(id)) back(path, "There is no such record");
  const typed = field(formData, "purgeAfter");
  if (!DATE_ONLY.test(typed)) back(path, "Give the date as a day on the calendar");
  // The START of that day, so "can be purged from <date>" is literally true and choosing today means it can go today. The end of the
  // day would have made "bring it forward to today" mean tomorrow.
  const when = new Date(`${typed}T00:00:00.000Z`);
  if (Number.isNaN(when.getTime())) back(path, "Give the date as a day on the calendar");
  const state = await getDataProvider().purges.bringForward(kind, id, when);
  if (!state?.purgeAfter) back(path, "Mark them as left first");
  const landed = new Date(state.purgeAfter);
  back(
    path,
    landed.getTime() <= when.getTime()
      ? `It can now be purged from ${landed.toLocaleDateString("en-GB")}.`
      : `The date can only be brought forward; it stays ${landed.toLocaleDateString("en-GB")}.`,
  );
}

export async function purgeStudentAction(formData: FormData): Promise<void> {
  return run("STUDENT", formData, "/dashboard/admin/people/students");
}

export async function purgeTutorAction(formData: FormData): Promise<void> {
  return run("TUTOR", formData, "/dashboard/admin/people/tutors");
}

export async function purgeFamilyAction(formData: FormData): Promise<void> {
  return run("FAMILY", formData, "/dashboard/admin/people/clients");
}
