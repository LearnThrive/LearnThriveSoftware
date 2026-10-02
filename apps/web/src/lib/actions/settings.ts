"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { requireRole } from "@/lib/auth/guard";

/**
 * Plan15 feature A7: the platform-wide default for whether a lesson report needs an Admin's approval
 * before a Parent or Student can see it (PlatformSettings.requireReportApproval, which
 * lib/reports/reportService.ts has always respected, with a per-assignment override on top).
 *
 * Admin only, and re-checked HERE: a Server Action is a POST endpoint anyone can call directly, so the
 * page-level guard is not authoritative (docs/ROLE_PERMISSIONS.md). The value is validated, not coerced:
 * anything but "true" or "false" is refused rather than read as one of them.
 *
 * Note: this does not touch reports that already exist. A report's status is fixed when it is submitted
 * (SUBMITTED waits for approval, APPROVED is already visible); the setting changes what happens to reports
 * submitted from now on.
 */
export async function setReportApprovalAction(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const value = formData.get("requireReportApproval");
  if (value !== "true" && value !== "false") throw new Error("Choose whether reports need approval.");
  const require = value === "true";

  await getDataProvider().settings.update({ requireReportApproval: require });
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/admin/assignments");
  redirect(
    `/dashboard/settings?toast=${encodeURIComponent(
      require
        ? "Reports now need approval before families see them"
        : "Reports are now shared as soon as a tutor submits them",
    )}`,
  );
}
