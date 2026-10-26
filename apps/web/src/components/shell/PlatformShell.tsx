import type { ReactNode } from "react";
import { SupervisedBanner } from "@/components/learner/SupervisedBanner";
import { AppShellClient } from "@/components/shell/AppShellClient";
import { currentAccess } from "@/lib/access/current";
import { nextJar } from "@/lib/account/next";
import { assistantClosed } from "@/lib/assistant/runtime";
import { getSession } from "@/lib/auth/session";
import { requireSession } from "@/lib/auth/guard";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { getDataProvider } from "@/lib/data/provider";
import { supervisedLearner } from "@/lib/learner/resolve";
import { libraryPhase, libraryShows } from "@/lib/library-config";
import { platformNavigation } from "@/lib/navigation/appNavigation";
import { PORTAL_ENABLED } from "@/lib/portal";

/**
 * The one authenticated frame (docs/IDENTITY.md, "One shell"), used by the tuition area AND the Library/LearnThrive AI/account area, so moving
 * between lessons, the Library and LearnThrive AI is one product with one sidebar, one top bar and one account menu. It is never nested inside
 * another shell. Everything it shows is derived on the server from the signed-in person and `platformAccess`:
 *
 *   - the dashboard areas only for someone whose access includes them (and only where the signed-in app is open);
 *   - LearnThrive AI and the Library only where open and included;
 *   - inside a guardian's supervised view, the LEARNER's menu only, a banner, and no Account link (the way out needs a password).
 *
 * `requireDashboard` is for the tuition routes: a person without a dashboard session is redirected exactly as before. The Library routes
 * guard themselves (requireAccountPage), so there the shell simply fits whoever is signed in and renders bare for no one.
 */
export async function PlatformShell({ children, requireDashboard = false }: { children: ReactNode; requireDashboard?: boolean }) {
  const dashboardUser: AuthenticatedUser | null = requireDashboard ? await requireSession() : await getSession();
  const who = await currentAccess();
  if (!dashboardUser && !who) return <>{children}</>;

  const viewing = who ? await supervisedLearner(who.rt, await nextJar(), who.account.profileId) : null;
  const tuition = Boolean(dashboardUser) && !viewing && (PORTAL_ENABLED || requireDashboard);
  const studyBuddy = Boolean(who?.access.studyBuddy) && assistantClosed(process.env, true) === null;
  const library = Boolean(who?.access.library) && libraryShows(libraryPhase()).catalogue;
  // The account page is for the person signed in as themselves; inside a supervised view it stays shut.
  const account = Boolean(who) && !viewing;

  const role = dashboardUser?.role ?? (who?.account.role ?? "CLIENT");
  const user: AuthenticatedUser = dashboardUser ?? {
    id: who!.account.profileId,
    email: who!.user.email,
    role,
    name: who!.account.displayName || who!.user.displayName || who!.user.email,
    profileId: who!.account.profileId,
  };
  const unreadCount = tuition ? await getDataProvider().notifications.unreadCountForUser(user.id) : 0;
  const learnerRole = Boolean(who?.account.learner) || Boolean(viewing);
  const roleLabel = viewing ? `Viewing as ${viewing.displayName}` : tuition ? undefined : learnerRole ? "Learner" : "Member";
  const home = tuition ? "/dashboard" : studyBuddy ? "/library/study-buddy" : library ? "/library" : "/account";

  return (
    <AppShellClient
      user={user}
      sections={platformNavigation({ role, tuition, studyBuddy, library, account })}
      unreadCount={unreadCount}
      isDevelopment={process.env.NODE_ENV !== "production"}
      homeHref={home}
      accountHref={account ? "/account" : tuition ? "/dashboard/settings" : home}
      accountLabel={account ? "Your account" : "Account settings"}
      roleLabel={roleLabel}
      tuition={tuition}
      banner={viewing ? <SupervisedBanner name={viewing.displayName} /> : null}
    >
      {children}
    </AppShellClient>
  );
}
