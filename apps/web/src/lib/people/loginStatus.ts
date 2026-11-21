import { accountRuntime } from "@/lib/account/runtime";

/**
 * Whether each person has taken up their login, for an administrator's lists (docs/AUTHENTICATION.md, "The first sign-in").
 * A login is made with a temporary password and `must_change_password`; that flag clears only when the person chooses their own password, so it
 * is the honest answer to "have they set up their own password". The last sign-in time comes from Auth.
 *
 *   none        the person has no login at all
 *   never       a login exists and has never been signed in to
 *   temporary   they signed in on the temporary password but have not chosen their own yet
 *   set         they chose their own password
 */
export type LoginState = "none" | "never" | "temporary" | "set";
export interface LoginStatus { state: LoginState; lastSignIn: string | null }

export function loginState(account: { mustChangePassword: boolean } | null, lastSignIn: string | null): LoginState {
  if (!account) return "none";
  if (!account.mustChangePassword) return "set";
  return lastSignIn ? "temporary" : "never";
}

/** A status for each profile id given (people with no id are left out: they have no login). Server only. Failing to read Auth leaves the dates empty, not the states. */
export async function loginStatuses(userIds: ReadonlyArray<string | undefined>): Promise<Map<string, LoginStatus>> {
  const out = new Map<string, LoginStatus>();
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return out;
  const rt = await accountRuntime();
  if (!rt) return out;
  const signIns = (await rt.admin?.lastSignIns().catch(() => null)) ?? new Map<string, string>();
  await Promise.all(ids.map(async (id) => {
    const account = await rt.store.accounts.getAccount(id);
    const last = signIns.get(id) ?? null;
    out.set(id, { state: loginState(account, last), lastSignIn: last });
  }));
  return out;
}

export const LOGIN_LABELS: Record<LoginState, string> = {
  none: "No login",
  never: "Never signed in",
  temporary: "Signed in, password not set",
  set: "Set own password",
};
