import type { Account, LinkStatus } from "@learnthrive/data/library";
import { accountRuntime } from "./runtime";

/** A person's login, for an administrator's screen. null if they have none, or there is no account backend. */
export async function loginDetails(profileId: string | undefined): Promise<Account | null> {
  if (!profileId) return null;
  const rt = await accountRuntime();
  return rt ? rt.store.accounts.getAccount(profileId) : null;
}

/**
 * A student's own login and its status, whatever the status, for the administrator's student page. The student record's `userId` names only
 * an ACTIVE login, so without this a login the parent suspended would look like no login at all. null if there is none, or no backend.
 */
export async function learnerLogin(studentId: string): Promise<{ profileId: string; status: LinkStatus } | null> {
  const rt = await accountRuntime();
  return rt ? rt.store.identity.learnerLogin(studentId) : null;
}
