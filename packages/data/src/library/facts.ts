import type { LibraryStore } from "./ports";
import type { AccessFacts, Account } from "./types";

const NONE: AccessFacts = { enrolled: false, subscription: false, adminGrant: false };

/**
 * The facts `platformAccess` and `canAccess` read, for ANY signed-in account, from live state: the family's for an adult, the learner's
 * own for a learner (their own tuition, the household's Library benefit), nothing for a learner whose login is not active. One function,
 * so the sign-in routing, the navigation, the page guards and the downloads cannot disagree about who is a learner.
 */
export async function accessFactsFor(store: LibraryStore, account: Pick<Account, "clientId" | "learner">, now: Date = new Date()): Promise<AccessFacts> {
  if (account.learner) return account.learner.status === "active" ? store.access.learnerFacts(account.learner.studentId, now) : { ...NONE, ownTuition: false };
  return account.clientId ? store.access.facts(account.clientId, now) : NONE;
}

/**
 * The family account a person's records and counters belong to: their own for an adult, the household's for a learner whose login is
 * active, null for anyone else. A learner has no account of their own to pay with; this is only for scoping (downloads, caps).
 */
export function familyClientIdOf(account: Pick<Account, "clientId" | "learner">): string | null {
  if (account.learner) return account.learner.status === "active" && account.learner.guardianActive ? account.learner.familyClientId : null;
  return account.clientId;
}
