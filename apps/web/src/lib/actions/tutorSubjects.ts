"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { accountRuntime } from "@/lib/account/runtime";
import { getDataProvider } from "@/lib/data/provider";
import { requireTutor } from "@/lib/auth/guard";
import { TEACHING_SUBJECTS, withTickedSubjects, type TeachingSubject } from "@/lib/subjects";

const PAGE = "/dashboard/tutor/subjects";

/**
 * A tutor ticks the subjects they teach (as many as they specialise in). Like availability, this works on the CALLING tutor's own record
 * only: the tutor id is the session's, never one taken from the form, so one tutor cannot change another's subjects. The change is audited
 * by field name, the same as an administrator's correction of the same record.
 */
export async function updateOwnSubjectsAction(formData: FormData): Promise<void> {
  const user = await requireTutor();
  if (!user.profileId) throw new Error("Your account isn't linked to a Tutor profile yet.");

  const ticked = TEACHING_SUBJECTS.filter((subject): subject is TeachingSubject => formData.getAll("subjects").includes(subject));
  if (ticked.length === 0) redirect(`${PAGE}?toast=${encodeURIComponent("Choose at least one subject.")}`);

  const data = getDataProvider();
  const tutor = await data.tutors.get(user.profileId);
  if (!tutor) redirect(`${PAGE}?toast=${encodeURIComponent("Your tutor record could not be found.")}`);

  const subjects = withTickedSubjects(tutor.subjects, ticked);
  if (subjects.join("|") === tutor.subjects.join("|")) redirect(`${PAGE}?toast=${encodeURIComponent("Nothing was changed")}`);

  await data.tutors.update(tutor.id, { subjects });
  const rt = await accountRuntime();
  if (rt) await rt.store.identity.recordAudit({ actor: user.id, action: "tutor_details_changed", tutorId: tutor.id, fields: ["subjects"], now: new Date() });
  revalidatePath(PAGE);
  revalidatePath("/dashboard/admin/assignments");
  redirect(`${PAGE}?toast=${encodeURIComponent("Subjects saved")}`);
}
