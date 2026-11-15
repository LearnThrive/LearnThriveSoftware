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
  const back = (message: string): never => redirect(`/dashboard/admin/roles?toast=${encodeURIComponent(message)}`);
  if (!rt) return back("Accounts are not available on this server.");
  const profileId = formData.get("profileId");
  const result = await changeRolesFor(admin, { profileId, roles: formData.getAll("roles") }, rt.store.accounts);
  revalidatePath("/dashboard/admin/roles");
  return back(result.body.ok ? "Roles saved." : result.body.message);
}
