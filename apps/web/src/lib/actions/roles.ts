"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/guard";
import { accountRuntime } from "@/lib/account/runtime";
import { changeRolesFor } from "@/lib/roles/handlers";

/**
 * The admin Roles screen's action (docs/ROLE_PERMISSIONS.md). It re-checks who is calling HERE (a Server Action is a POST endpoint anyone
 * can call directly) and then runs the same handler as the API, which reads only `profileId` and `roles` from the form: no other field
 * of the submission can ever reach a role.
 */
export async function changeRolesAction(formData: FormData): Promise<void> {
  const admin = await requirePermission("roles.assign");
  const rt = await accountRuntime();
  const profileId = formData.get("profileId");
  // Back to the same person, so the screen stays on whoever was just changed (the id only fills a URL; the handler validates it).
  const person = typeof profileId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(profileId) ? `person=${encodeURIComponent(profileId)}&` : "";
  const back = (message: string): never => redirect(`/dashboard/admin/roles?${person}toast=${encodeURIComponent(message)}`);
  if (!rt) return back("Accounts are not available on this server.");
  const result = await changeRolesFor(admin, { profileId, roles: formData.getAll("roles") }, rt.store.accounts);
  revalidatePath("/dashboard/admin/roles");
  return back(result.body.ok ? "Roles saved." : result.body.message);
}
