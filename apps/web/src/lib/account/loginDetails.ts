import type { Account } from "@learnthrive/data/library";
import { accountRuntime } from "./runtime";

/** A person's login, for an administrator's screen. null if they have none, or there is no account backend. */
export async function loginDetails(profileId: string | undefined): Promise<Account | null> {
  if (!profileId) return null;
  const rt = await accountRuntime();
  return rt ? rt.store.accounts.getAccount(profileId) : null;
}
