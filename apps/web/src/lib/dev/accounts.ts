import { SEED_IDS } from "@learnthrive/data/inMemoryProvider";
import type { Role } from "@/lib/auth/types";

/**
 * The development accounts, in one list (docs/DEVELOPMENT_ACCOUNTS.md). They exist only on a local development server: the in-memory
 * sign-in (lib/account/memoryAuth.ts) is seeded from this list by `seedDevAccounts`, and the development provider (lib/auth/devProvider.ts)
 * reads the same ids, so a person has ONE id whichever way the code looks them up and notifications stay addressed to the right place.
 *
 * `library` is what the Library store is told about each account, so every kind of person behind the one sign-in can be tried:
 *   enrolled    an active tuition assignment: the dashboard, the Library and LearnThrive AI
 *   subscriber  an active subscription and no enrolment: the Library and LearnThrive AI, not the dashboard
 *   none        signed in but entitled to nothing (staff accounts hold their rights through their role)
 *
 * `domainId` links an account to its record in the development domain data (packages/data's SEED_IDS), which is what the dashboard
 * looks a signed-in tutor, parent or student up by. An account without one (an administrator, a Library member) has no such record.
 *
 * Nothing here is a secret and none of it can run in production: see `isDevelopmentBuild`.
 */
export interface DevAccount {
  id: string;
  email: string;
  password: string;
  role: Role;
  name: string;
  /** false = the account exists but is disabled, to exercise that sign-in state. */
  active: boolean;
  domainId?: string;
  library: "enrolled" | "subscriber" | "none";
  /** Also seeded into the staff development provider (the accounts that open the dashboard). */
  inDevProvider: boolean;
}

export const DEV_ACCOUNTS: readonly DevAccount[] = [
  { id: "d0000000-0000-4000-8000-000000000001", email: "admin@learnthrive.dev", password: "dev-admin-pass", role: "ADMIN", name: "Alvi Hossain (Admin)", active: true, library: "none", inDevProvider: true },
  { id: "d0000000-0000-4000-8000-000000000002", email: "tutor@learnthrive.dev", password: "dev-tutor-pass", role: "TUTOR", name: "Tahasin Hasan (Tutor)", active: true, domainId: SEED_IDS.tutorJamiePatel, library: "none", inDevProvider: true },
  { id: "d0000000-0000-4000-8000-000000000003", email: "client@learnthrive.dev", password: "dev-client-pass", role: "CLIENT", name: "Abdurrahman Mustafa (Client)", active: true, domainId: SEED_IDS.clientSarahAhmed, library: "enrolled", inDevProvider: true },
  { id: "d0000000-0000-4000-8000-000000000004", email: "student@learnthrive.dev", password: "dev-student-pass", role: "STUDENT", name: "Brian James Khalawon (Student)", active: true, domainId: SEED_IDS.studentAyaanAhmed, library: "enrolled", inDevProvider: true },
  { id: "d0000000-0000-4000-8000-000000000005", email: "disabled@learnthrive.dev", password: "dev-disabled-pass", role: "STUDENT", name: "Disabled Test Account", active: false, library: "none", inDevProvider: true },
  { id: "d0000000-0000-4000-8000-000000000006", email: "member@learnthrive.dev", password: "dev-member-pass", role: "CLIENT", name: "Library Member", active: true, library: "subscriber", inDevProvider: false },
  { id: "d0000000-0000-4000-8000-000000000007", email: "visitor@learnthrive.dev", password: "dev-visitor-pass", role: "CLIENT", name: "New Visitor", active: true, library: "none", inDevProvider: false },
];

/** True only on a local development server. Production and the built-and-started site are never "development". */
export function isDevelopmentBuild(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "development";
}

/** The development domain record (tutor, parent or student) an account is linked to, if any. Never answers in production. */
export function devDomainIdFor(accountId: string, env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.NODE_ENV === "production") return undefined;
  return DEV_ACCOUNTS.find((account) => account.id === accountId)?.domainId;
}
