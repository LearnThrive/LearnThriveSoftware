import type { ReactNode } from "react";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { requireSession } from "@/lib/auth/guard";
import { navigationFor } from "@/lib/navigation/appNavigation";
import { AppShellClient } from "@/components/shell/AppShellClient";

/**
 * Chrome for every authenticated route (plan6 section 13's AppShell): sidebar, topbar, account
 * menu, notification count. Deliberately no public marketing navigation anywhere inside it.
 *
 * Server component: the session and the unread count are read here so the client shell renders
 * correctly on first paint rather than flashing an empty badge, and so navigation is built from
 * the server-validated role rather than anything the browser could claim.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const user = await requireSession();
  const unreadCount = await getDataProvider().notifications.unreadCountForUser(user.id);

  return (
    <AppShellClient user={user} sections={navigationFor(user.role)} unreadCount={unreadCount}>
      {children}
    </AppShellClient>
  );
}
