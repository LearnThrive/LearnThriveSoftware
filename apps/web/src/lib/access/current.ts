import { cache } from "react";
import { accessFactsFor, platformAccess, type Account, type AccessFacts, type PlatformAccess } from "@learnthrive/data/library";
import { currentSession } from "@/lib/account/pages";
import type { AccountRuntime } from "@/lib/account/runtime";
import type { AuthUser } from "@/lib/account/types";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { PORTAL_ENABLED } from "@/lib/portal";
import { nextJar } from "@/lib/account/next";
import { inSupervisedView } from "@/lib/learner/resolve";
import { toPlatformUser } from "./platformUser";

/**
 * Who is signed in, and what the one LearnThrive sign-in gives them (`platformAccess` holds the rule).
 *
 * There is a single front door (/login, the account sign-in). Behind it a person finds the signed-in app (the dashboard, the lessons,
 * the classroom) only if they are staff or an enrolled family; a Library subscriber finds the Library and Study Buddy; anyone else
 * finds their account page. Everything that used to ask the development sign-in "who is this?" (`getSession`, 87 call sites) now gets
 * its answer from here when there is no development session, so none of those pages changed.
 */
export interface SignedInAccess {
  rt: AccountRuntime;
  user: AuthUser;
  account: Account;
  facts: AccessFacts;
  access: PlatformAccess;
}

/**
 * The signed-in account with its access, or null (not signed in, an expired access token that needs the renewing route, no backend,
 * or no profile). Cached for one render so a layout and its page ask the database once. Never sets a cookie.
 */
export const currentAccess = cache(async (): Promise<SignedInAccess | null> => {
  const { rt, state } = await currentSession();
  if (!rt || state.status !== "ok") return null;
  const account = await rt.store.accounts.getAccount(state.user.id);
  if (!account) return null;
  // A learner's facts are their own (docs/IDENTITY.md), the family's for an adult: one function for every guard.
  const facts = await accessFactsFor(rt.store, account);
  return { rt, user: state.user, account, facts, access: platformAccess(account.role, facts) };
});

/** True when the browser holds a refresh token but no usable access token: the page should go through /api/account/refresh. */
export async function accountSessionExpired(): Promise<boolean> {
  const { state } = await currentSession();
  return state.status === "refresh_needed";
}

/**
 * The signed-in app's user for the current request, from the account sign-in: only for someone whose access includes the dashboard,
 * and only where the signed-in app is open at all (always in development and tests; in production only once the portal is opened, so a
 * real sign-in can never reach the in-memory demo data behind the dashboard before that data is real).
 */
export async function accountPlatformUser(): Promise<AuthenticatedUser | null> {
  if (!PORTAL_ENABLED) return null;
  const who = await currentAccess();
  if (!who || !who.access.dashboard) return null;
  // A guardian viewing as a learner has the learner's view, not the family's: the dashboard (the family's lessons and billing) is closed.
  if (await inSupervisedView(who.rt, await nextJar(), who.account.profileId)) return null;
  return toPlatformUser(who.user, who.account, await who.rt.store.accounts.domainRef(who.account.profileId));
}
