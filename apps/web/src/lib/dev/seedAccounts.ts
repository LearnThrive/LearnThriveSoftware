import type { InMemoryLibraryStore } from "@learnthrive/data/library";
import type { MemoryAccountAuth } from "@/lib/account/memoryAuth";
import { DEV_ACCOUNTS } from "./accounts";

/**
 * DEVELOPMENT ONLY (lib/account/runtime.ts calls it only on a local dev server): puts every development account behind the one sign-in.
 * Each is registered as already confirmed with its fixed id, given a profile with its role, and given the Library standing its
 * `library` field names (an active tuition assignment for "enrolled", an open subscription for "subscriber"). Idempotent per address.
 *
 * The development student is a LEARNER: their own login bound (as an accepted invitation would) to an adult student record in the
 * development client's family, which is the one on the active assignment. So their dashboard follows their own enrolment, the family
 * keeps its Library benefit, and they never hold a family account of their own (docs/IDENTITY.md). They are an adult learner so Study
 * Buddy opens for them without the children's approval switch.
 */
export async function seedDevAccounts(auth: MemoryAccountAuth, store: InMemoryLibraryStore, now: Date = new Date()): Promise<void> {
  let familyStudent: string | null = null;
  for (const account of DEV_ACCOUNTS) {
    if (auth.userIdFor(account.email)) continue;
    await auth.seedUser({ id: account.id, email: account.email, displayName: account.name, password: account.password, disabled: !account.active });
    store.seedProfile({ id: account.id, role: account.role, displayName: account.name, adultConfirmed: true, email: account.email });
    if (account.role === "STUDENT" && account.library === "enrolled" && familyStudent) store.seedLearner(familyStudent, account.id);
    else if (account.library === "enrolled") {
      familyStudent = store.seedStudent(account.id, { displayName: "Brian", isMinor: false, yearGroup: "A Level" });
      store.seedAssignment(familyStudent, "ACTIVE");
    } else if (account.library === "subscriber") store.seedEntitlement(account.id, "subscription", new Date(now.getTime() - 60_000), null);
  }
}
