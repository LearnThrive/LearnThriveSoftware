import type { InMemoryLibraryStore } from "@learnthrive/data/library";
import type { MemoryAccountAuth } from "@/lib/account/memoryAuth";
import { DEV_ACCOUNTS } from "./accounts";

/**
 * DEVELOPMENT ONLY (lib/account/runtime.ts calls it only on a local dev server): puts every development account behind the one sign-in.
 * Each is registered as already confirmed with its fixed id, given a profile with its role, and given the Library standing its
 * `library` field names (an active tuition assignment for "enrolled", an open subscription for "subscriber"). Idempotent per address.
 */
export async function seedDevAccounts(auth: MemoryAccountAuth, store: InMemoryLibraryStore, now: Date = new Date()): Promise<void> {
  for (const account of DEV_ACCOUNTS) {
    if (auth.userIdFor(account.email)) continue;
    await auth.seedUser({ id: account.id, email: account.email, displayName: account.name, password: account.password, disabled: !account.active });
    store.seedProfile({ id: account.id, role: account.role, displayName: account.name, adultConfirmed: true, email: account.email });
    if (account.library === "enrolled") store.seedAssignment(store.seedStudent(account.id), "ACTIVE");
    else if (account.library === "subscriber") store.seedEntitlement(account.id, "subscription", new Date(now.getTime() - 60_000), null);
  }
}
