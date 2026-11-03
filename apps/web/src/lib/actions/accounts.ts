"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { generateChildUsername } from "@/lib/account/credentials";
import { changeLinkedEmail, createLogin, issueTemporaryPassword, setLoginDisabled, type Created, type Refused } from "@/lib/account/provision";
import { accountRuntime, type AccountRuntime } from "@/lib/account/runtime";
import { parseUsername } from "@/lib/account/username";
import { parseEmail } from "@/lib/account/validation";
import { requireRole } from "@/lib/auth/guard";
import { getDataProvider } from "@/lib/data/provider";
import { mirrorStudent } from "@/lib/dev/memoryMirror";

/**
 * The administrator's account tools (docs/AUTHENTICATION.md, "Accounts are made, not signed up for"). Every action re-checks ADMIN (a Server
 * Action is a public POST endpoint) and takes its role from the code, never the form, so a posted role can do nothing: no action here can
 * make an administrator. The temporary password comes back to the one screen that asked and is never put in a URL, stored or logged.
 */
export interface LoginFormState {
  status?: "created" | "refused";
  message?: string;
  username?: string;
  temporaryPassword?: string;
}

const ID = /^[0-9a-zA-Z-]{8,64}$/;
/** How many generated usernames to try before asking the administrator to choose one. A clash is rare: 45 words and 9,000 numbers. */
const USERNAME_TRIES = 8;

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function answer(result: Created | Refused): LoginFormState {
  if (result.status === "refused") return { status: "refused", message: result.message };
  return { status: "created", username: result.username, temporaryPassword: result.temporaryPassword };
}

const NOT_CONFIGURED: LoginFormState = { status: "refused", message: "Accounts are not available on this server." };

async function runtime(): Promise<AccountRuntime | null> {
  return accountRuntime();
}

/** A parent or guardian: the login and their family together. A family cannot exist without its account holder. */
export async function createFamilyAccountAction(_previous: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const admin = await requireRole(["ADMIN"]);
  const rt = await runtime();
  if (!rt) return NOT_CONFIGURED;
  const name = field(formData, "name");
  const email = parseEmail(formData.get("email"));
  const phone = field(formData, "phone");
  const data = getDataProvider();
  const result = await createLogin(rt, { username: parseUsername(formData.get("username")), linkedEmail: email, displayName: name, role: "CLIENT", actor: admin.id });
  if (result.status === "created") {
    if (rt.memory) {
      // The development domain data is a separate store: on the database, provisioning has already made this row.
      const client = await data.clients.create({ userId: result.profileId, name, email, active: true, ...(phone ? { phone } : {}) });
      rt.memory.seedDomainRef(result.profileId, client.id);
    } else if (phone) {
      const client = await data.clients.getByUserId(result.profileId);
      if (client) await data.clients.update(client.id, { phone });
    }
    revalidatePath("/dashboard/admin/people/clients");
  }
  return answer(result);
}

export async function createTutorLoginAction(_previous: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const admin = await requireRole(["ADMIN"]);
  const rt = await runtime();
  if (!rt) return NOT_CONFIGURED;
  const tutorId = field(formData, "tutorId");
  if (!ID.test(tutorId)) return { status: "refused", message: "There is no such tutor." };
  const data = getDataProvider();
  const tutor = await data.tutors.get(tutorId);
  if (!tutor) return { status: "refused", message: "There is no such tutor." };
  const result = await createLogin(rt, {
    username: parseUsername(formData.get("username")),
    linkedEmail: parseEmail(formData.get("email")) || tutor.email.toLowerCase(),
    displayName: tutor.name,
    role: "TUTOR",
    tutorId,
    actor: admin.id,
  });
  if (result.status === "created") {
    if (rt.memory) await data.tutors.update(tutorId, { userId: result.profileId });
    revalidatePath(`/dashboard/admin/tutors/${tutorId}`);
  }
  return answer(result);
}

/** A child's login, linked to their parent: its resets and notices go to the parent's address, and its username says nothing about them. */
export async function createLearnerLoginAction(_previous: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const admin = await requireRole(["ADMIN"]);
  const rt = await runtime();
  if (!rt) return NOT_CONFIGURED;
  const studentId = field(formData, "studentId");
  if (!ID.test(studentId)) return { status: "refused", message: "There is no such student." };
  const data = getDataProvider();
  const [student, families] = await Promise.all([data.students.get(studentId), data.students.clientsFor(studentId)]);
  if (!student) return { status: "refused", message: "There is no such student." };
  const family = families[0];
  if (!family) return { status: "refused", message: "Link this student to their parent first: a child's login belongs to a family." };
  const linkedEmail = (family.userId ? await rt.store.accounts.getEmail(family.userId) : null) ?? family.email;
  await mirrorStudent(rt, data, studentId);

  const chosen = parseUsername(formData.get("username"));
  const new_ = (username: string) => createLogin(rt, { username, linkedEmail: linkedEmail.toLowerCase(), displayName: student.name, role: "STUDENT", studentId, actor: admin.id });
  let result = await new_(chosen || generateChildUsername());
  for (let tries = 1; !chosen && result.status === "refused" && result.reason === "username_taken" && tries < USERNAME_TRIES; tries += 1) result = await new_(generateChildUsername());
  if (result.status === "created") revalidatePath(`/dashboard/admin/students/${studentId}`);
  return answer(result);
}

/** The fallback for a forgotten password, once the person's identity is confirmed (a call to the parent, for a child). */
export async function issueTemporaryPasswordAction(_previous: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const admin = await requireRole(["ADMIN"]);
  const rt = await runtime();
  if (!rt) return NOT_CONFIGURED;
  const profileId = field(formData, "profileId");
  if (!ID.test(profileId)) return { status: "refused", message: "There is no such login." };
  return answer(await issueTemporaryPassword(rt, profileId, admin.id));
}

function back(path: string, toast: string): never {
  revalidatePath(path);
  redirect(`${path}?toast=${encodeURIComponent(toast)}`);
}

/** Only ever back to a page of this dashboard: the form names where it came from. */
function returnPath(formData: FormData): string {
  const path = field(formData, "returnTo");
  return /^\/dashboard\/admin\/(tutors|clients|students)\/[0-9a-zA-Z-]{1,64}$/.test(path) ? path : "/dashboard/admin/people/students";
}

export async function setLoginDisabledAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const rt = await runtime();
  const path = returnPath(formData);
  const profileId = field(formData, "profileId");
  const disable = field(formData, "disabled") === "true";
  if (profileId === admin.id) back(path, "You cannot disable your own login");
  const done = rt && ID.test(profileId) ? await setLoginDisabled(rt, profileId, disable, admin.id) : false;
  back(path, !done ? "That could not be changed" : disable ? "Login disabled" : "Login enabled");
}

export async function changeLinkedEmailAction(formData: FormData): Promise<void> {
  const admin = await requireRole(["ADMIN"]);
  const rt = await runtime();
  const path = returnPath(formData);
  const profileId = field(formData, "profileId");
  if (!rt || !ID.test(profileId)) back(path, "That could not be changed");
  const result = await changeLinkedEmail(rt, profileId, parseEmail(formData.get("email")), admin.id);
  back(path, result.status === "changed" ? "Linked email updated" : result.message);
}
