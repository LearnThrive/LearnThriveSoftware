import type { DataProvider } from "@learnthrive/data/repositories";
import type { NotificationType } from "@learnthrive/data/domain";
import type { Role } from "@/lib/auth/types";
import { accountBackend } from "@/lib/account/runtime";
import { findUserIdByProfileId, findUserIdsByRole } from "@/lib/auth/devProvider";

// Plan section 54: every notification is addressed to a real login, resolved here by the data
// provider from a domain record or a role — a record with no login simply gets no notification,
// silently, rather than an error. On the production database a recipient that is not a real
// login is not merely unread: notifications.user_id is a foreign key, so the insert would fail
// and take the report or lesson that raised it with it. See docs/NOTIFICATIONS.md.
//
// Only the in-memory backend looks at the development accounts: its seeded records belong to them.

async function loginFor(data: DataProvider, recordId: string): Promise<string | null> {
  const found = await data.notifications.recipientFor(recordId);
  return found ?? (accountBackend() === "memory" ? findUserIdByProfileId(recordId) : null);
}

function loginsWithRole(data: DataProvider, role: Role): Promise<string[]> {
  return accountBackend() === "memory" ? findUserIdsByRole(role) : data.notifications.recipientsWithRole(role);
}

export async function notifyProfile(
  data: DataProvider, profileId: string, type: NotificationType, message: string, link?: string,
): Promise<void> {
  const userId = await loginFor(data, profileId);
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
  const userIds = await loginsWithRole(data, role);
  for (const userId of userIds) await data.notifications.create({ userId, type, message, ...(link ? { link } : {}) });
}
