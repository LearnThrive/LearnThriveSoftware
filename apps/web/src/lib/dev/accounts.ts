import { SEED_IDS, TEAM } from "@learnthrive/data/inMemoryProvider";
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
  /** What they sign in with. */
  username: string;
  /** Their linked email. */
  email: string;
  password: string;
  /** The highest role they hold: always `primaryRole(roles)`, written out so a list reads at a glance (a test checks they agree). */
  role: Role;
  /** Every role they hold. More than one for the multi-role accounts (docs/ROLE_PERMISSIONS.md). */
  roles: readonly Role[];
  name: string;
  /** false = the account exists but is disabled, to exercise that sign-in state. */
  active: boolean;
  domainId?: string;
  /**
   * The domain record each role stands on, where they hold more than one (a tutor's own id, a family, a student). `domainId` is the one for the
   * primary role. An account with a single role has just `domainId`.
   */
  records?: { tutorId?: string; clientId?: string; studentId?: string };
  /** A learner's login belongs to this account's family (the id of the parent account whose family student they are). */
  learnerOf?: string;
  library: "enrolled" | "subscriber" | "none";
  /** Also seeded into the staff development provider (the accounts that open the dashboard). */
  inDevProvider: boolean;
}

/**
 * The four owners and testers (Alvi Hossain, Tahasin Hasan, Abdurrahman Mustafa, Brian James Khalawon), each with TWO logins so every role can be tried:
 *
 *   team.<name>          ADMIN + TUTOR + CLIENT   an administrator who teaches, and the parent of a family
 *   team.<name>.learner  STUDENT + JUNIOR_TUTOR   that family's learner, who is also a junior tutor
 *
 * No single login can hold every role: TUTOR and JUNIOR_TUTOR exclude each other, and so do CLIENT and STUDENT (docs/ROLE_PERMISSIONS.md). Their records
 * and lessons are in packages/data's TEAM. Like every account in this file they exist only on a local development server and never in production:
 * the same people's logins for the deployed site are made with apps/web/scripts/create-account.mjs, with passwords that are never in this repository.
 */
const TEAM_ACCOUNTS: readonly DevAccount[] = TEAM.flatMap((person, i): DevAccount[] => {
  const mainId = `d0000000-0000-4000-8000-00000000010${i}`;
  return [
    {
      id: mainId, username: `team.${person.key}`, email: `team-${person.key}@learnthrive.dev`, password: `team-${person.key}-pass`,
      role: "ADMIN", roles: ["ADMIN", "TUTOR", "CLIENT"], name: person.name, active: true, domainId: person.tutor,
      records: { tutorId: person.tutor, clientId: person.client }, library: "enrolled", inDevProvider: false,
    },
    {
      id: `d0000000-0000-4000-8000-00000000011${i}`, username: `team.${person.key}.learner`, email: `team-${person.key}-learner@learnthrive.dev`, password: `team-${person.key}-learner-pass`,
      role: "JUNIOR_TUTOR", roles: ["STUDENT", "JUNIOR_TUTOR"], name: `${person.name} (learner)`, active: true, domainId: person.juniorTutor,
      records: { tutorId: person.juniorTutor, studentId: person.student }, learnerOf: mainId, library: "enrolled", inDevProvider: false,
    },
  ];
});

export const DEV_ACCOUNTS: readonly DevAccount[] = [
  { id: "d0000000-0000-4000-8000-000000000001", username: "dev.admin", email: "admin@learnthrive.dev", password: "dev-admin-pass", role: "ADMIN", roles: ["ADMIN"], name: "Alvi Hossain (Admin)", active: true, library: "none", inDevProvider: true },
  { id: "d0000000-0000-4000-8000-000000000002", username: "dev.tutor", email: "tutor@learnthrive.dev", password: "dev-tutor-pass", role: "TUTOR", roles: ["TUTOR"], name: "Tahasin Hasan (Tutor)", active: true, domainId: SEED_IDS.tutorJamiePatel, library: "none", inDevProvider: true },
  { id: "d0000000-0000-4000-8000-000000000003", username: "dev.client", email: "client@learnthrive.dev", password: "dev-client-pass", role: "CLIENT", roles: ["CLIENT"], name: "Abdurrahman Mustafa (Client)", active: true, domainId: SEED_IDS.clientSarahAhmed, library: "enrolled", inDevProvider: true },
  { id: "d0000000-0000-4000-8000-000000000004", username: "dev.student", email: "student@learnthrive.dev", password: "dev-student-pass", role: "STUDENT", roles: ["STUDENT"], name: "Brian James Khalawon (Student)", active: true, domainId: SEED_IDS.studentAyaanAhmed, library: "enrolled", inDevProvider: true },
  { id: "d0000000-0000-4000-8000-000000000005", username: "dev.disabled", email: "disabled@learnthrive.dev", password: "dev-disabled-pass", role: "STUDENT", roles: ["STUDENT"], name: "Disabled Test Account", active: false, library: "none", inDevProvider: true },
  { id: "d0000000-0000-4000-8000-000000000006", username: "dev.member", email: "member@learnthrive.dev", password: "dev-member-pass", role: "CLIENT", roles: ["CLIENT"], name: "Library Member", active: true, library: "subscriber", inDevProvider: false },
  { id: "d0000000-0000-4000-8000-000000000007", username: "dev.visitor", email: "visitor@learnthrive.dev", password: "dev-visitor-pass", role: "CLIENT", roles: ["CLIENT"], name: "New Visitor", active: true, library: "none", inDevProvider: false },
  // An administrator who teaches (docs/ROLE_PERMISSIONS.md): their domain record is a tutor's. `dev.admin` above is the one who does not.
  { id: "d0000000-0000-4000-8000-000000000008", username: "dev.teaching-admin", email: "teaching-admin@learnthrive.dev", password: "dev-teaching-admin-pass", role: "ADMIN", roles: ["ADMIN", "TUTOR"], name: "Meera Shah (Admin and tutor)", active: true, domainId: SEED_IDS.tutorMeeraShah, records: { tutorId: SEED_IDS.tutorMeeraShah }, library: "none", inDevProvider: false },
  // A 17-year-old who is a STUDENT and a JUNIOR TUTOR, and their parent (all synthetic). The student's tutoring record is the junior tutor's; they
  // learn with the teaching admin above and teach the peer seeded beside them. Brian (dev.student) is neither of these and the junior must not see him.
  { id: "d0000000-0000-4000-8000-000000000009", username: "dev.junior-parent", email: "junior-parent@learnthrive.dev", password: "dev-junior-parent-pass", role: "CLIENT", roles: ["CLIENT"], name: "Pat Parent-Test (Parent)", active: true, domainId: SEED_IDS.clientJuniorParent, library: "enrolled", inDevProvider: false },
  { id: "d0000000-0000-4000-8000-000000000010", username: "dev.junior", email: "junior@learnthrive.dev", password: "dev-junior-pass", role: "JUNIOR_TUTOR", roles: ["STUDENT", "JUNIOR_TUTOR"], name: "Sam Junior-Test (Student and junior tutor)", active: true, domainId: SEED_IDS.tutorJuniorSam, records: { tutorId: SEED_IDS.tutorJuniorSam, studentId: SEED_IDS.studentJuniorSam }, learnerOf: "d0000000-0000-4000-8000-000000000009", library: "enrolled", inDevProvider: false },
  ...TEAM_ACCOUNTS,
];

/** The roles an account holds, as the one list says (a development account only). */
export function devRolesFor(accountId: string, env: Record<string, string | undefined> = process.env): readonly Role[] | undefined {
  if (env.NODE_ENV === "production") return undefined;
  return DEV_ACCOUNTS.find((account) => account.id === accountId)?.roles;
}

/** The record each role stands on for a development account (`records`, else `domainId` for the one role). Never answers in production. */
export function devRecordsFor(accountId: string, env: Record<string, string | undefined> = process.env): { tutorId?: string; clientId?: string; studentId?: string } | undefined {
  if (env.NODE_ENV === "production") return undefined;
  const account = DEV_ACCOUNTS.find((a) => a.id === accountId);
  if (!account) return undefined;
  if (account.records) return account.records;
  if (!account.domainId) return undefined;
  return account.role === "CLIENT" ? { clientId: account.domainId } : account.role === "STUDENT" ? { studentId: account.domainId } : { tutorId: account.domainId };
}

/** True only on a local development server. Production and the built-and-started site are never "development". */
export function isDevelopmentBuild(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "development";
}

/** The development domain record (tutor, parent or student) an account is linked to, if any. Never answers in production. */
export function devDomainIdFor(accountId: string, env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.NODE_ENV === "production") return undefined;
  return DEV_ACCOUNTS.find((account) => account.id === accountId)?.domainId;
}
