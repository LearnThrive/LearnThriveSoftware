"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PurgeKind, PurgePreview } from "@learnthrive/data/repositories";
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

  let toast: string;
  try {
    toast = await purge(kind, id, preview, admin.id);
  } catch (error) {
    back(path, error instanceof Error ? error.message : "That could not be done. Nothing was changed.");
  }
  back(kind === "STUDENT" ? "/dashboard/admin/people/students" : kind === "TUTOR" ? "/dashboard/admin/people/tutors" : "/dashboard/admin/people/clients", toast);
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
