import type { InMemoryLibraryStore } from "@learnthrive/data/library";
import type { MemoryAccountAuth } from "@/lib/account/memoryAuth";
import { internalEmailFor } from "@/lib/account/username";
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
  const familyStudents = new Map<string, string>(); // a parent account's id -> the family's student in the Library store
  let familyStudent: string | null = null;
  for (const account of DEV_ACCOUNTS) {
    const address = internalEmailFor(account.username);
    if (auth.userIdFor(address)) continue;
    await auth.seedUser({ id: account.id, email: address, displayName: account.name, password: account.password, disabled: !account.active });
    store.seedProfile({ id: account.id, roles: [...account.roles], displayName: account.name, adultConfirmed: true, email: account.email, username: account.username, linkedEmail: account.email });
    if (account.records?.tutorId) store.seedTutorRef(account.id, account.records.tutorId);
    const learnerOf = account.learnerOf ? familyStudents.get(account.learnerOf) : account.roles.includes("STUDENT") && account.library === "enrolled" ? familyStudent : null;
    if (learnerOf) store.seedLearner(learnerOf, account.id);
    else if (account.library === "enrolled") {
      // The first family is the development client's (Brian, an adult learner); a later one is a family with a 17-year-old (a minor).
      const first = familyStudent === null;
      // The junior's family has a 17-year-old (a minor); the team's learners are adults, so LearnThrive AI opens for them without the children's switch.
      const junior = account.username === "dev.junior-parent";
      const student = store.seedStudent(account.id, first ? { displayName: "Brian", isMinor: false, yearGroup: "A Level" } : { displayName: junior ? "Sam" : account.name.split(" ")[0]!, isMinor: junior, yearGroup: junior ? "Year 12" : "A Level" });
      store.seedAssignment(student, "ACTIVE");
      familyStudents.set(account.id, student);
      familyStudent ??= student;
    } else if (account.library === "subscriber") store.seedEntitlement(account.id, "subscription", new Date(now.getTime() - 60_000), null);
  }
}
