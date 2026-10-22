"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountRuntime } from "@/lib/account/runtime";
import { requireRole } from "@/lib/auth/guard";
import { getDataProvider } from "@/lib/data/provider";

/**
 * The administrator's enrolment workflow: change a tuition assignment's status (pause, resume, END it), change its tutor, add or remove
 * its students, and give a tutor record a login. Enrolment is DERIVED from these records (a family is enrolled while one of its
 * students is on an ACTIVE assignment, and a learner follows their own), so ending an assignment ends the lessons-and-Library
 * benefit that came from it, and nothing else: a separately paid Library subscription is untouched. Every action re-checks ADMIN (a
 * Server Action is a public POST endpoint) and writes an audit entry (ids only). Ordinary operations never need Supabase's table editor.
 */
const STATUSES = ["ACTIVE", "PAUSED", "ENDED"] as const;
type Status = (typeof STATUSES)[number];
const ID = /^[0-9a-zA-Z-]{8,64}$/;

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function audit(actor: string, action: string, studentIds: string[]) {
  const rt = await accountRuntime();
  if (!rt) return;
  const now = new Date();
  for (const studentId of studentIds.length ? studentIds : [null]) await rt.store.identity.recordAudit({ actor, action, studentId, now });
}

function back(path: string, toast: string): never {
  revalidatePath(path);
  redirect(`${path}?toast=${encodeURIComponent(toast)}`);
}

export async function setAssignmentStatusAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const id = field(formData, "assignmentId");
  const status = field(formData, "status") as Status;
  if (!ID.test(id) || !STATUSES.includes(status)) throw new Error("That is not a valid change.");
  const data = getDataProvider();
  const assignment = await data.assignments.get(id);
  if (!assignment) throw new Error("There is no such assignment.");
  await data.assignments.update(id, { status });
  await audit(admin.id, status === "ENDED" ? "enrolment_ended" : status === "PAUSED" ? "enrolment_paused" : "enrolment_resumed", assignment.studentIds);
  back(`/dashboard/admin/assignments/${id}`, status === "ENDED" ? "Enrolment ended" : status === "PAUSED" ? "Assignment paused" : "Assignment resumed");
}

export async function setAssignmentTutorAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const id = field(formData, "assignmentId");
  const tutorId = field(formData, "tutorId");
  if (!ID.test(id) || !ID.test(tutorId)) throw new Error("That is not a valid change.");
  const data = getDataProvider();
  const [assignment, tutor] = await Promise.all([data.assignments.get(id), data.tutors.get(tutorId)]);
  if (!assignment || !tutor || !tutor.active) throw new Error("There is no such assignment or active tutor.");
  await data.assignments.update(id, { tutorId });
  await audit(admin.id, "assignment_tutor_changed", assignment.studentIds);
  back(`/dashboard/admin/assignments/${id}`, "Tutor changed");
}

export async function addAssignmentStudentAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const id = field(formData, "assignmentId");
  const studentId = field(formData, "studentId");
  if (!ID.test(id) || !ID.test(studentId)) throw new Error("That is not a valid change.");
  const data = getDataProvider();
  const [assignment, student] = await Promise.all([data.assignments.get(id), data.students.get(studentId)]);
  if (!assignment || !student || !student.active) throw new Error("There is no such assignment or active student.");
  if (assignment.studentIds.includes(studentId)) back(`/dashboard/admin/assignments/${id}`, "Already on this assignment");
  // The families who pay for the students on it follow the students (the Postgres provider derives them; the development one stores them).
  const clientIds = [...new Set([...assignment.clientIds, ...(await data.students.clientsFor(studentId)).map((c) => c.id)])];
  await data.assignments.update(id, { studentIds: [...assignment.studentIds, studentId], clientIds });
  await audit(admin.id, "enrolment_started", [studentId]);
  back(`/dashboard/admin/assignments/${id}`, "Student added");
}

export async function removeAssignmentStudentAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const id = field(formData, "assignmentId");
  const studentId = field(formData, "studentId");
  if (!ID.test(id) || !ID.test(studentId)) throw new Error("That is not a valid change.");
  const data = getDataProvider();
  const assignment = await data.assignments.get(id);
  if (!assignment || !assignment.studentIds.includes(studentId)) throw new Error("That student is not on this assignment.");
  if (assignment.studentIds.length === 1) throw new Error("An assignment needs at least one student: end it instead.");
  const remaining = assignment.studentIds.filter((s) => s !== studentId);
  const clientIds = [...new Set((await Promise.all(remaining.map((s) => data.students.clientsFor(s)))).flat().map((c) => c.id))];
  await data.assignments.update(id, { studentIds: remaining, clientIds });
  await audit(admin.id, "enrolment_ended", [studentId]);
  back(`/dashboard/admin/assignments/${id}`, "Student removed");
}

export async function linkTutorLoginAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const tutorId = field(formData, "tutorId");
  const email = field(formData, "email").toLowerCase();
  if (!ID.test(tutorId) || !email.includes("@") || email.length > 254) throw new Error("Enter the tutor's sign-in email address.");
  const result = await getDataProvider().tutors.linkLogin(tutorId, email, admin.id);
  const path = `/dashboard/admin/tutors/${tutorId}`;
  const message: Record<typeof result, string> = {
    ok: "Login linked. They now sign in as this tutor.",
    no_tutor: "There is no such tutor.",
    no_account: "There is no confirmed account with that address. Ask them to create one and confirm their email first.",
    not_eligible: "That account cannot become this tutor (it is a family or learner account, is staff already, or this tutor already has a login).",
    unsupported: "Logins are linked in the production database only.",
  };
  back(path, message[result]);
}
