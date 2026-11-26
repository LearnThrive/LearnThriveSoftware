import { redirect } from "next/navigation";
import { teachingTutorId } from "@/lib/auth/teaching";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { getDataProvider } from "@/lib/data/provider";
import { lessonsToCloseOut } from "@/lib/lessons/closeOut";

export const CLOSE_OUT_PATH = "/dashboard/close-out";

// What stays open while a lesson waits: the close-out screen itself, a classroom (the next student must not be kept waiting) and raising a
// safeguarding concern (which can never wait).
const STAYS_OPEN = /^\/dashboard\/(close-out|concerns|lessons\/[^/]+\/classroom)(\/|$)/;

export const staysOpen = (path: string): boolean => STAYS_OPEN.test(path.split("?")[0] ?? "");

/** Sends a tutor with a finished-but-not-closed-out lesson to the close-out screen. Costs one lessons query per page, for tutors only. */
export async function enforceCloseOut(user: AuthenticatedUser, path: string): Promise<void> {
  if (!teachingTutorId(user) || staysOpen(path)) return;
  if ((await lessonsToCloseOut(getDataProvider(), user)).length > 0) redirect(CLOSE_OUT_PATH);
}
