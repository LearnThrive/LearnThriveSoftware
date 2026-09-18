"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { requireRole } from "@/lib/auth/guard";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

// Every action below re-checks ADMIN itself, even though the only UI that renders a form
// pointing at it already lives behind /dashboard/admin's own requireRole() guard. Server Actions
// are callable directly (they're just POST endpoints under the hood) by anyone who knows the
// action id, not only through the page that renders the form — so the page-level guard alone
// isn't authoritative. See docs/ROLE_PERMISSIONS.md.

export async function createTutorAction(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const name = text(formData, "name");
  const email = text(formData, "email");
  const subjects = text(formData, "subjects");
  if (!name || !email) throw new Error("Name and email are required.");

  const data = getDataProvider();
  await data.tutors.create({
    name, email, active: true,
    subjects: subjects ? subjects.split(",").map((s) => s.trim()).filter(Boolean) : [],
  });
  revalidatePath("/dashboard/admin/people");
  redirect("/dashboard/admin/people");
}

export async function createClientAction(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const name = text(formData, "name");
  const email = text(formData, "email");
  const phone = text(formData, "phone");
  if (!name || !email) throw new Error("Name and email are required.");

  const data = getDataProvider();
  await data.clients.create({ name, email, active: true, ...(phone ? { phone } : {}) });
  revalidatePath("/dashboard/admin/people");
  redirect("/dashboard/admin/people");
}

export async function createStudentAction(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const name = text(formData, "name");
  const yearGroup = text(formData, "yearGroup");
  const clientId = text(formData, "clientId");
  if (!name) throw new Error("Name is required.");

  const data = getDataProvider();
  const student = await data.students.create({ name, active: true, ...(yearGroup ? { yearGroup } : {}) });
  if (clientId) await data.students.linkClient(clientId, student.id);
  revalidatePath("/dashboard/admin/people");
  redirect("/dashboard/admin/people");
}

export async function createAssignmentAction(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const title = text(formData, "title");
  const subject = text(formData, "subject");
  const level = text(formData, "level");
  const tutorId = text(formData, "tutorId");
  const studentIds = formData.getAll("studentIds").map(String).filter(Boolean);
  if (!title || !subject || !tutorId || studentIds.length === 0) {
    throw new Error("Title, subject, tutor, and at least one student are required.");
  }

  const data = getDataProvider();
  // clientIds is derived from the selected students' own linked clients, not entered
  // separately — an assignment's clients are exactly whoever pays for the students on it.
  const clientIdSet = new Set<string>();
  for (const studentId of studentIds) {
    const clients = await data.students.clientsFor(studentId);
    for (const client of clients) clientIdSet.add(client.id);
  }

  await data.assignments.create({
    title, subject, tutorId, studentIds,
    clientIds: [...clientIdSet],
    status: "ACTIVE",
    ...(level ? { level } : {}),
    defaultDurationMinutes: 60,
    defaultLocationType: "ONLINE",
  });
  revalidatePath("/dashboard/admin/assignments");
  redirect("/dashboard/admin/assignments");
}
