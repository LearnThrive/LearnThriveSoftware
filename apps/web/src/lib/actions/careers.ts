"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { CareersDeletionReason, DbsSeenHow } from "@learnthrive/data/careers";
import { isApplicationStatus, isUuid, NOTE_MAX } from "@learnthrive/data/careers";
import { requireRole } from "@/lib/auth/guard";
import { DELETE_APPLICATION_PHRASE, DELETE_DOCUMENTS_PHRASE } from "@/lib/careers/review";
import { careersFiles, careersStore } from "@/lib/careers/store";

/**
 * What an administrator does with a tutor application (launch checklist 3.12.3 and 3.12.5). Every action re-checks ADMIN itself: a Server
 * Action is a public POST endpoint, so the page guard alone is not authoritative (docs/ROLE_PERMISSIONS.md). Tutors, families and learners
 * are refused here whatever page they came from.
 *
 * Deleting follows the purge tool's order: the stored files first (a file whose row is gone can never be found again), then the rows. If a
 * file cannot be removed nothing else is, and the administrator is told to try again.
 */
const LIST = "/dashboard/admin/careers";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const REASONS: CareersDeletionReason[] = ["RETENTION", "REQUEST", "WITHDRAWN", "OTHER"];

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

const pageOf = (id: string) => `${LIST}/${id}`;

function back(path: string, toast: string): never {
  revalidatePath(path);
  redirect(`${path}?toast=${encodeURIComponent(toast)}`);
}

/** The administrator, the store and the application id from the form, or a redirect explaining which is missing. */
async function context(formData: FormData) {
  const admin = await requireRole(["ADMIN"]);
  const id = field(formData, "id");
  if (!isUuid(id)) back(LIST, "There is no such application");
  const store = careersStore();
  if (!store) back(LIST, "Applications are not available on this server");
  return { admin, id, store, page: pageOf(id) };
}

export async function setApplicationStatusAction(formData: FormData): Promise<void> {
  const { admin, id, store, page } = await context(formData);
  const status = field(formData, "status");
  if (!isApplicationStatus(status)) back(page, "Choose a status");
  const done = await store.setStatus(id, status, admin.id);
  if (!done) back(LIST, "There is no such application");
  back(page, "Status updated");
}

export async function addApplicationNoteAction(formData: FormData): Promise<void> {
  const { admin, id, store, page } = await context(formData);
  const body = field(formData, "body");
  if (!body) back(page, "Write something first");
  if (body.length > NOTE_MAX) back(page, `A note can be at most ${NOTE_MAX} characters`);
  if (!(await store.addNote(id, body, admin.id))) back(LIST, "There is no such application");
  back(page, "Note added");
}

export async function recordIdentitySeenAction(formData: FormData): Promise<void> {
  const { admin, id, store, page } = await context(formData);
  const on = field(formData, "on");
  if (!DATE_ONLY.test(on) || on > new Date().toISOString().slice(0, 10)) back(page, "Give the date you saw the documents (not a future date)");
  if (!(await store.recordIdentitySeen(id, on, admin.id))) back(page, "That could not be recorded");
  back(page, "Identity recorded as seen");
}

export async function recordDbsSeenAction(formData: FormData): Promise<void> {
  const { admin, id, store, page } = await context(formData);
  const on = field(formData, "on");
  const how = field(formData, "how") as DbsSeenHow;
  if (how !== "CERTIFICATE" && how !== "UPDATE_SERVICE") back(page, "Say whether you saw the certificate or an Update Service check");
  if (!DATE_ONLY.test(on) || on > new Date().toISOString().slice(0, 10)) back(page, "Give the date you saw it (not a future date)");
  if (!(await store.recordDbsSeen(id, { on, how }, admin.id))) back(page, "That could not be recorded");
  back(page, "DBS check recorded as seen");
}

/** Removes the stored objects; true only if every one is gone (already gone counts). */
async function removeStored(paths: string[]): Promise<boolean> {
  const files = careersFiles();
  if (!files) return paths.length === 0;
  for (const path of paths) {
    try {
      await files.remove(path);
    } catch {
      return false;
    }
  }
  return true;
}

export async function deleteIdentityDocumentsAction(formData: FormData): Promise<void> {
  const { admin, id, store, page } = await context(formData);
  if (field(formData, "confirm").toUpperCase() !== DELETE_DOCUMENTS_PHRASE) back(page, `Type ${DELETE_DOCUMENTS_PHRASE} exactly to confirm`);
  const application = await store.get(id);
  if (!application) back(LIST, "There is no such application");
  const paths = application.files.filter((f) => f.sensitive).map((f) => f.storagePath);
  if (paths.length === 0) back(page, "There are no identity documents to delete");
  if (!(await removeStored(paths))) back(page, "The documents could not be removed from storage, so nothing was deleted. Try again.");
  const removed = await store.removeIdentityFiles(id, admin.id);
  back(page, `${removed} document${removed === 1 ? "" : "s"} deleted`);
}

export async function deleteApplicationAction(formData: FormData): Promise<void> {
  const { admin, id, store, page } = await context(formData);
  if (field(formData, "confirm").toUpperCase() !== DELETE_APPLICATION_PHRASE) back(page, `Type ${DELETE_APPLICATION_PHRASE} exactly to confirm`);
  const reason = field(formData, "reason") as CareersDeletionReason;
  if (!REASONS.includes(reason)) back(page, "Choose why it is being deleted");
  const application = await store.get(id);
  if (!application) back(LIST, "There is no such application");
  if (!(await removeStored(application.files.map((f) => f.storagePath)))) {
    back(page, "The files could not be removed from storage, so nothing was deleted. Try again.");
  }
  const logged = await store.remove(id, admin.id, reason);
  back(LIST, logged ? "Application deleted" : "There was nothing left to delete");
}
