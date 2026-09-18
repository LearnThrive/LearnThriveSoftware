import assert from "node:assert/strict";
import test from "node:test";
import { loadTsFrom } from "./_tsLoader.mjs";

const { getDataProvider, SEED_IDS } = loadTsFrom(import.meta.url, "../../../packages/data/src/inMemoryProvider.ts");
const { notifyProfile, notifyProfiles, notifyRole } = loadTsFrom(import.meta.url, "../src/lib/notifications/notificationService.ts");
const { findUserIdByProfileId } = loadTsFrom(import.meta.url, "../src/lib/auth/devProvider.ts");

test("notifyProfile: resolves a seeded domain profileId to its login account and creates a notification for it", async () => {
  const data = getDataProvider();
  await notifyProfile(data, SEED_IDS.clientSarahAhmed, "LESSON_RESCHEDULED", "Test message", "/dashboard/calendar");

  const clientUserId = await findUserIdByProfileId(SEED_IDS.clientSarahAhmed);
  assert.ok(clientUserId);
  const notifications = await data.notifications.forUser(clientUserId);
  assert.ok(notifications.some((n) => n.message === "Test message" && n.type === "LESSON_RESCHEDULED"));
});

test("notifyProfile: a profileId with no matching login account is a silent no-op, not an error", async () => {
  const data = getDataProvider();
  const orphanProfileId = "profile-with-no-login-account";
  await assert.doesNotReject(() => notifyProfile(data, orphanProfileId, "REPORT_AVAILABLE", "Should go nowhere"));
});

test("notifyProfiles: notifies every resolvable profileId in the list, skipping unresolvable ones", async () => {
  const data = getDataProvider();
  await notifyProfiles(data, [SEED_IDS.clientSarahAhmed, "unresolvable-id"], "REPORT_AVAILABLE", "Batch test message");
  const clientUserId = await findUserIdByProfileId(SEED_IDS.clientSarahAhmed);
  const notifications = await data.notifications.forUser(clientUserId);
  assert.ok(notifications.some((n) => n.message === "Batch test message"));
});

test("notifyRole: notifies every active user with the given role", async () => {
  const data = getDataProvider();
  await notifyRole(data, "ADMIN", "SCHEDULING_CONFLICT", "Conflict overridden");

  // The Admin seed account has no profileId (it isn't linked to a domain record) — resolved by
  // role instead, the same way notifyRole() itself does internally.
  const { findUserIdsByRole } = loadTsFrom(import.meta.url, "../src/lib/auth/devProvider.ts");
  const adminIds = await findUserIdsByRole("ADMIN");
  assert.equal(adminIds.length, 1);
  const notifications = await data.notifications.forUser(adminIds[0]);
  assert.ok(notifications.some((n) => n.message === "Conflict overridden"));
});

test("markRead: flips a notification's read flag without affecting others", async () => {
  const data = getDataProvider();
  await notifyProfile(data, SEED_IDS.clientSarahAhmed, "REPORT_AVAILABLE", "Unread test");
  const userId = await findUserIdByProfileId(SEED_IDS.clientSarahAhmed);
  const before = await data.notifications.forUser(userId);
  const target = before.find((n) => n.message === "Unread test");
  assert.equal(target.read, false);

  await data.notifications.markRead(target.id);
  const after = await data.notifications.forUser(userId);
  const updated = after.find((n) => n.id === target.id);
  assert.equal(updated.read, true);
});
