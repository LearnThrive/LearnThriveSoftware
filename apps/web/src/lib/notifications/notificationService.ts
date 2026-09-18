import type { DataProvider } from "@learnthrive/data/repositories";
import type { NotificationType } from "@learnthrive/data/domain";
import type { Role } from "@/lib/auth/types";
import { findUserIdByProfileId, findUserIdsByRole } from "@/lib/auth/devProvider";

// Plan section 54: "Implement in-app notifications for meaningful events... Keep them in-memory
// for current development provider." Every notification is addressed to an AuthenticatedUser.id,
// resolved here from a domain profileId (via devProvider.ts's reverse lookup) or a role — a
// domain record with no matching login account (most Admin-created Tutors/Clients/Students,
// which only the four seed accounts have) simply gets no notification, silently, rather than an
// error. See docs/NOTIFICATIONS.md.

export async function notifyProfile(
  data: DataProvider, profileId: string, type: NotificationType, message: string, link?: string,
): Promise<void> {
  const userId = await findUserIdByProfileId(profileId);
  if (!userId) return;
  await data.notifications.create({ userId, type, message, ...(link ? { link } : {}) });
}

export async function notifyProfiles(
  data: DataProvider, profileIds: string[], type: NotificationType, message: string, link?: string,
): Promise<void> {
  for (const profileId of profileIds) await notifyProfile(data, profileId, type, message, link);
}

export async function notifyRole(
  data: DataProvider, role: Role, type: NotificationType, message: string, link?: string,
): Promise<void> {
  const userIds = await findUserIdsByRole(role);
  for (const userId of userIds) await data.notifications.create({ userId, type, message, ...(link ? { link } : {}) });
}
