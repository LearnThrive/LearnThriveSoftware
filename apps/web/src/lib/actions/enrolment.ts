"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountRuntime } from "@/lib/account/runtime";
import { parseUsername, usernameFormatError } from "@/lib/account/username";
import { requireRole } from "@/lib/auth/guard";
import { changeRolesFor } from "@/lib/roles/handlers";
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

/**
 * The per-assignment override of "reports need approval" (docs/LESSON_REPORTS.md): follow the platform setting, always approve, or
 * never. It changes what happens to reports submitted from now on; a report already submitted keeps its status.
 */
export async function setAssignmentReportApprovalAction(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const id = field(formData, "assignmentId");
  const choice = field(formData, "reportApproval");
  if (!ID.test(id) || !["default", "required", "not_required"].includes(choice)) throw new Error("That is not a valid change.");
  const data = getDataProvider();
  if (!(await data.assignments.get(id))) throw new Error("There is no such assignment.");
  await data.assignments.update(id, { requireReportApproval: choice === "default" ? null : choice === "required" });
  back(`/dashboard/admin/assignments/${id}`, choice === "default" ? "Reports here follow the platform setting" : choice === "required" ? "Reports here need approval" : "Reports here are shared as soon as they are submitted");
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
  const username = parseUsername(formData.get("username"));
  if (!ID.test(tutorId) || usernameFormatError(username)) throw new Error("Enter the username of their login.");
  const result = await getDataProvider().tutors.linkLogin(tutorId, username, admin.id);
  const path = `/dashboard/admin/tutors/${tutorId}`;
  const message: Record<typeof result, string> = {
    ok: "Login linked. They now teach as this tutor.",
    no_tutor: "There is no such tutor.",
    no_account: "There is no login with that username.",
    not_eligible: "That login cannot become this tutor (it is a family or learner account, is a tutor already, or this tutor already has a login).",
    unsupported: "Logins are linked in the production database only.",
  };
  back(path, message[result]);
}

/**
 * A tutor who is also a student: the student's own login becomes an EXISTING login (the tutor's), so one sign-in holds both. Two steps: the
 * login is bound to the student record, then the STUDENT role is added to it (a role needs its record first; the Roles screen can finish the
 * second step by hand if it is refused). Nothing is taken from the person: they keep every role and record they had.
 */
export async function linkLearnerLoginAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const studentId = field(formData, "studentId");
  const username = parseUsername(formData.get("username"));
  if (!ID.test(studentId) || usernameFormatError(username)) throw new Error("Enter the username of their login.");
  const path = `/dashboard/admin/students/${studentId}`;
  const result = await getDataProvider().students.linkLogin(studentId, username, admin.id);
  if (result !== "ok") {
    const refusal: Record<Exclude<typeof result, "ok">, string> = {
      no_student: "There is no such student.",
      no_account: "There is no login with that username.",
      not_eligible: "That login cannot be this student's (it owns a family account, holds the parent role or is a learner already), or this student already has a login or no parent linked.",
      unsupported: "Logins are linked in the production database only.",
    };
    back(path, refusal[result]);
  }
  const rt = await accountRuntime();
  const person = rt ? (await rt.store.accounts.listProfiles()).find((p) => p.username?.toLowerCase() === username.toLowerCase()) : undefined;
  if (!rt || !person) back(path, "Login linked. Add the Student role on the Roles screen to finish.");
  const roles = person!.roles.includes("STUDENT") ? person!.roles : [...person!.roles, "STUDENT" as const];
  // Through the role handler, like the Roles screen: it is the only code that changes roles (tests/multiRole.test.mjs checks that).
  const changed = await changeRolesFor(admin, { profileId: person!.profileId, roles }, rt!.store.accounts);
  back(path, changed.body.ok
    ? "Login linked. They now have their student side on the same sign-in as their other roles."
    : `Login linked, but the Student role could not be added (${changed.body.message}). Add it on the Roles screen.`);
}
