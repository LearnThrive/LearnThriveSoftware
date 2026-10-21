import type { AccessFacts, Account, AccountRole, Resource } from "./types";

export type AccessReason = "free_sample" | "enrolled" | "subscription" | "admin_grant" | "admin" | "unpublished" | "no_entitlement";

export interface AccessDecision {
  allowed: boolean;
  reason: AccessReason;
}

/**
 * The one place that decides whether a signed-in account may download a resource (plan19 section 3). Pure: the
 * caller reads the facts (the store does) and passes them in, so every combination can be tested in a table.
 *
 * A person has access if the resource is a free sample, or they are enrolled, or they hold an active paid
 * subscription, or an administrator granted access. An ADMIN account can reach everything, drafts included.
 * Anything unpublished (a draft, or scheduled for later) is closed to everyone else, whatever they hold.
 * No account at all is not a question this function answers: the route returns 401 before it asks.
 */
export function canAccess(account: Pick<Account, "role">, resource: Pick<Resource, "accessTier" | "publishedAt">, facts: AccessFacts, now: Date): AccessDecision {
  if (account.role === "ADMIN") return { allowed: true, reason: "admin" };
  if (resource.publishedAt === null || resource.publishedAt.getTime() > now.getTime()) return { allowed: false, reason: "unpublished" };
  if (resource.accessTier === "free_sample") return { allowed: true, reason: "free_sample" };
  if (facts.enrolled) return { allowed: true, reason: "enrolled" };
  if (facts.subscription) return { allowed: true, reason: "subscription" };
  if (facts.adminGrant) return { allowed: true, reason: "admin_grant" };
  return { allowed: false, reason: "no_entitlement" };
}

/**
 * Who gets what on the one LearnThrive sign-in. The platform has a single front door (`/login`); what a person finds behind it
 * is decided here, from their role and the same facts `canAccess` reads. Pure, so every combination is a table test.
 *
 *   staff     ADMIN and TUTOR accounts: the dashboard, the lessons and the classroom. Administrators also reach the whole Library and
 *             Study Buddy (as `canAccess` already lets them); a tutor's own account holds no Library right unless the facts give one.
 *   enrolled  an active tuition assignment links the family: everything. The dashboard, lessons, classroom, the Library and Study Buddy.
 *   library   a paid subscription or an administrator grant, and no enrolment: the Library and Study Buddy only, never the dashboard.
 *   none      signed in, entitled to nothing yet: the account page (and the free samples), with the way to subscribe.
 *
 * Enrolment beats a subscription: an enrolled family that also subscribes simply has everything.
 */
export type PlatformTier = "staff" | "enrolled" | "library" | "none";

export interface PlatformAccess {
  tier: PlatformTier;
  /** The signed-in app: dashboard, lessons, classroom. */
  dashboard: boolean;
  /** Members' downloads in the Library. */
  library: boolean;
  /** The assistant. */
  studyBuddy: boolean;
}

export function platformAccess(role: AccountRole, facts: AccessFacts): PlatformAccess {
  const libraryRight = role === "ADMIN" || facts.enrolled || facts.subscription || facts.adminGrant;
  if (role === "ADMIN" || role === "TUTOR") return { tier: "staff", dashboard: true, library: libraryRight, studyBuddy: libraryRight };
  if (facts.enrolled) return { tier: "enrolled", dashboard: true, library: true, studyBuddy: true };
  if (libraryRight) return { tier: "library", dashboard: false, library: true, studyBuddy: true };
  return { tier: "none", dashboard: false, library: false, studyBuddy: false };
}

/** What the front door can currently offer: Study Buddy only where the assistant is open, the dashboard only where the signed-in app is open. */
export interface HomeOptions {
  studyBuddyOpen: boolean;
  /** Default true. False while the signed-in app is closed (production before the portal opens): the dashboard is then nobody's home. */
  dashboardOpen?: boolean;
}

const effective = (access: PlatformAccess, options: HomeOptions): PlatformAccess => (options.dashboardOpen === false ? { ...access, dashboard: false } : access);

/** Where a person lands after signing in, with nothing more specific asked for. */
export function homePath(access: PlatformAccess, options: HomeOptions): string {
  const open = effective(access, options);
  if (open.dashboard) return "/dashboard";
  if (open.studyBuddy) return options.studyBuddyOpen ? "/library/study-buddy" : "/library";
  return "/account";
}

const GATES: ReadonlyArray<{ base: string; needs: keyof Pick<PlatformAccess, "dashboard" | "studyBuddy"> }> = [
  { base: "/dashboard", needs: "dashboard" },
  { base: "/library/study-buddy", needs: "studyBuddy" },
];

/**
 * The page to send a person to after sign-in: the one they asked for (`requested`, already reduced to a safe path on this site),
 * unless it is a page their access does not include, in which case their home. Everything else (the account page, the Library's
 * own pages, the public site) is theirs to open, so it is returned as asked.
 */
export function destinationFor(access: PlatformAccess, requested: string | null | undefined, options: HomeOptions): string {
  if (!requested || !requested.startsWith("/") || requested === "/login") return homePath(access, options);
  const open = effective(access, options);
  const path = requested.split(/[?#]/)[0]!;
  for (const gate of GATES) {
    if ((path === gate.base || path.startsWith(`${gate.base}/`)) && !open[gate.needs]) return homePath(access, options);
  }
  return requested;
}
