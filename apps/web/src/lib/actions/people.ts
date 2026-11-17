"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountRuntime } from "@/lib/account/runtime";
import { getDataProvider } from "@/lib/data/provider";
import { mirrorStudent } from "@/lib/dev/memoryMirror";
import { requireRole } from "@/lib/auth/guard";
import { studentCorrection, tutorCorrection } from "@/lib/people/corrections";
import { canonicalSubject, tutorTeaches } from "@/lib/subjects";

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
  revalidatePath("/dashboard/admin/people/tutors");
  redirect(`/dashboard/admin/people/tutors?toast=${encodeURIComponent(`${name} added as a tutor`)}`);
}

export async function createStudentAction(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const name = text(formData, "name");
  const yearGroup = text(formData, "yearGroup");
  const clientId = text(formData, "clientId");
  if (!name) throw new Error("Name is required.");

  const data = getDataProvider();
  let student;
  try {
    // `clientId` is how the Postgres provider knows which family the student belongs to; the development provider links afterwards.
    student = await data.students.create({ name, active: true, ...(yearGroup ? { yearGroup } : {}), ...({ clientId: clientId || undefined } as object) });
  } catch (error) {
    redirect(`/dashboard/admin/people/students?toast=${encodeURIComponent(error instanceof Error ? error.message : "That could not be added.")}`);
  }
  if (clientId) await data.students.linkClient(clientId, student.id);
  await mirrorStudent(await accountRuntime(), data, student.id);
  revalidatePath("/dashboard/admin/people/students");
  redirect(`/dashboard/admin/people/students?toast=${encodeURIComponent(`${name} added as a student`)}`);
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
  // The subject is one of ours (the form offers a list) and the tutor must teach it: tutors pick their own subjects, so an assignment
  // never pairs a tutor with a subject they have not said they teach (lib/subjects.ts).
  const canonical = canonicalSubject(subject);
  const back = "/dashboard/admin/assignments";
  if (!canonical) redirect(`${back}?toast=${encodeURIComponent("Choose one of the listed subjects.")}`);

  const data = getDataProvider();
  const tutor = await data.tutors.get(tutorId);
  if (!tutor) redirect(`${back}?toast=${encodeURIComponent("That tutor no longer exists.")}`);
  if (!tutorTeaches(tutor.subjects, canonical)) {
    redirect(`${back}?toast=${encodeURIComponent(`${tutor.name} does not teach ${canonical}. Choose another tutor, or add the subject on their page.`)}`);
  }
  // clientIds is derived from the selected students' own linked clients, not entered
  // separately — an assignment's clients are exactly whoever pays for the students on it.
  const clientIdSet = new Set<string>();
  for (const studentId of studentIds) {
    const clients = await data.students.clientsFor(studentId);
    for (const client of clients) clientIdSet.add(client.id);
  }

  await data.assignments.create({
    title, subject: canonical, tutorId, studentIds,
    clientIds: [...clientIdSet],
    status: "ACTIVE",
    ...(level ? { level } : {}),
    defaultDurationMinutes: 60,
    defaultLocationType: "ONLINE",
  });
  const rt = await accountRuntime();
  for (const studentId of studentIds) await mirrorStudent(rt, data, studentId);
  revalidatePath("/dashboard/admin/assignments");
  redirect(`/dashboard/admin/assignments?toast=${encodeURIComponent(`${title} created`)}`);
}

// ---- corrections (docs/improvement/PLAN.md item 5) ---------------------------------------------------------------------------------
// A record that is wrong can be put right, by an administrator, and the correction is audited: who changed which fields of whose
// record. The audit never holds the old or the new value (identity_audit: ids and actions only).

export async function updateStudentAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const id = text(formData, "studentId");
  const page = `/dashboard/admin/students/${encodeURIComponent(id)}`;
  const data = getDataProvider();
  const student = await data.students.get(id);
  if (!student) redirect(`/dashboard/admin/people/students?toast=${encodeURIComponent("That student no longer exists.")}`);
  const change = studentCorrection(student, { name: text(formData, "name"), yearGroup: text(formData, "yearGroup") });
  if (!change.ok) redirect(`${page}?toast=${encodeURIComponent(change.message)}`);
  if (change.fields.length === 0) redirect(`${page}?toast=${encodeURIComponent("Nothing was changed")}`);
  await data.students.update(id, change.patch);
  const rt = await accountRuntime();
  if (rt) {
    const family = (await data.students.clientsFor(id))[0];
    await rt.store.identity.recordAudit({ actor: admin.id, action: "student_details_changed", studentId: id, clientId: family?.id ?? null, fields: change.fields, now: new Date() });
  }
  revalidatePath(page);
  revalidatePath("/dashboard/admin/people/students");
  redirect(`${page}?toast=${encodeURIComponent("Details corrected")}`);
}

export async function updateTutorAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const id = text(formData, "tutorId");
  const page = `/dashboard/admin/tutors/${encodeURIComponent(id)}`;
  const data = getDataProvider();
  const tutor = await data.tutors.get(id);
  if (!tutor) redirect(`/dashboard/admin/people/tutors?toast=${encodeURIComponent("That tutor no longer exists.")}`);
  const change = tutorCorrection(tutor, { name: text(formData, "name"), email: text(formData, "email"), subjects: text(formData, "subjects") });
  if (!change.ok) redirect(`${page}?toast=${encodeURIComponent(change.message)}`);
  if (change.fields.length === 0) redirect(`${page}?toast=${encodeURIComponent("Nothing was changed")}`);
  await data.tutors.update(id, change.patch);
  const rt = await accountRuntime();
  if (rt) await rt.store.identity.recordAudit({ actor: admin.id, action: "tutor_details_changed", tutorId: id, fields: change.fields, now: new Date() });
  revalidatePath(page);
  revalidatePath("/dashboard/admin/people/tutors");
  redirect(`${page}?toast=${encodeURIComponent("Details corrected")}`);
}
