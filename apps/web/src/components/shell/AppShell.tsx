import type { ReactNode } from "react";
import { getDataProvider } from "@/lib/data/provider";
import { currentAccess } from "@/lib/access/current";
import { assistantClosed } from "@/lib/assistant/runtime";
import { requireSession } from "@/lib/auth/guard";
import { libraryPhase, libraryShows } from "@/lib/library-config";
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
  // Study Buddy and the Library are part of the same platform for whoever the one access rule gives them to (enrolled families get
  // everything; an administrator holds them by role). A link appears only where the page behind it is open. Someone signed in only
  // through the development provider has no account session, so nothing is added.
  const who = await currentAccess();
  const learning = {
    studyBuddy: Boolean(who?.access.studyBuddy) && assistantClosed(process.env, true) === null,
    library: Boolean(who?.access.library) && libraryShows(libraryPhase()).catalogue,
  };

  return (
    <AppShellClient
      user={user}
      sections={navigationFor(user.role, learning)}
      unreadCount={unreadCount}
      // Plan6 section 74: a subtle, always-visible reminder that this is a development build on
      // throwaway data — shown to every role (not just Admin, who already gets the full
      // explanation and the reset control on Settings) so nobody mistakes a demo for production.
      isDevelopment={process.env.NODE_ENV !== "production"}
    >
      {children}
    </AppShellClient>
  );
}
