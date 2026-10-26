import type { Role } from "@/lib/auth/types";

/**
 * The authenticated product's navigation, per role (plan6 sections 17-20).
 *
 * Every entry here points at a route that actually exists and does something — section 17's
 * "do not expose unavailable modules" is the rule this file enforces, so a role's sidebar is
 * never a menu of dead ends. Role sections differ deliberately: an Admin is running an
 * operation, a Tutor is teaching, a Client is following their children's progress, a Student is
 * turning up to lessons.
 */

export type AppNavIcon =
  | "home" | "calendar" | "lessons" | "students" | "clients" | "tutors"
  | "assignments" | "reports" | "notifications" | "activity" | "settings" | "availability"
  | "study-buddy" | "library" | "search" | "account";

export interface AppNavItem {
  label: string;
  href: string;
  icon: AppNavIcon;
  /** Matches child routes too (e.g. Lessons stays active on a lesson detail page). */
  matchPrefix?: string;
}

export interface AppNavSection {
  /** Omitted for single-group navigations (Client/Student) where headings would be noise. */
  title?: string;
  items: AppNavItem[];
}

const ADMIN_NAV: AppNavSection[] = [
  {
    title: "Workspace",
    items: [
      { label: "Overview", href: "/dashboard", icon: "home" },
      { label: "Calendar", href: "/dashboard/calendar", icon: "calendar" },
      { label: "Lessons", href: "/dashboard/lessons", icon: "lessons", matchPrefix: "/dashboard/lessons" },
    ],
  },
  {
    title: "People",
    items: [
      { label: "Students", href: "/dashboard/admin/people/students", icon: "students", matchPrefix: "/dashboard/admin/students" },
      { label: "Clients", href: "/dashboard/admin/people/clients", icon: "clients", matchPrefix: "/dashboard/admin/clients" },
      { label: "Tutors", href: "/dashboard/admin/people/tutors", icon: "tutors", matchPrefix: "/dashboard/admin/tutors" },
    ],
  },
  {
    title: "Tuition",
    items: [
      { label: "Assignments", href: "/dashboard/admin/assignments", icon: "assignments" },
      { label: "Reports", href: "/dashboard/reports", icon: "reports" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Notifications", href: "/dashboard/notifications", icon: "notifications" },
      { label: "Activity", href: "/dashboard/activity", icon: "activity" },
    ],
  },
  {
    title: "System",
    items: [{ label: "Settings", href: "/dashboard/settings", icon: "settings" }],
  },
];

const TUTOR_NAV: AppNavSection[] = [
  {
    title: "Teaching",
    items: [
      { label: "Overview", href: "/dashboard", icon: "home" },
      { label: "Calendar", href: "/dashboard/calendar", icon: "calendar" },
      { label: "Lessons", href: "/dashboard/lessons", icon: "lessons", matchPrefix: "/dashboard/lessons" },
      { label: "Students", href: "/dashboard/students", icon: "students" },
      { label: "Reports", href: "/dashboard/reports", icon: "reports" },
    ],
  },
  {
    title: "You",
    items: [
      { label: "Availability", href: "/dashboard/tutor/availability", icon: "availability" },
      { label: "Notifications", href: "/dashboard/notifications", icon: "notifications" },
      { label: "Settings", href: "/dashboard/settings", icon: "settings" },
    ],
  },
];

const CLIENT_NAV: AppNavSection[] = [
  {
    items: [
      { label: "Home", href: "/dashboard", icon: "home" },
      { label: "Children", href: "/dashboard/children", icon: "students" },
      { label: "Calendar", href: "/dashboard/calendar", icon: "calendar" },
      { label: "Lesson reports", href: "/dashboard/reports", icon: "reports" },
      { label: "Notifications", href: "/dashboard/notifications", icon: "notifications" },
      { label: "Settings", href: "/dashboard/settings", icon: "settings" },
    ],
  },
];

const STUDENT_NAV: AppNavSection[] = [
  {
    items: [
      { label: "Home", href: "/dashboard", icon: "home" },
      { label: "Calendar", href: "/dashboard/calendar", icon: "calendar" },
      { label: "Lessons", href: "/dashboard/lessons", icon: "lessons", matchPrefix: "/dashboard/lessons" },
      { label: "Feedback", href: "/dashboard/reports", icon: "reports" },
      { label: "Notifications", href: "/dashboard/notifications", icon: "notifications" },
      { label: "Settings", href: "/dashboard/settings", icon: "settings" },
    ],
  },
];

const NAV_BY_ROLE: Record<Role, AppNavSection[]> = {
  ADMIN: ADMIN_NAV,
  TUTOR: TUTOR_NAV,
  CLIENT: CLIENT_NAV,
  STUDENT: STUDENT_NAV,
};

/**
 * What the person's Library standing adds to their menu (`platformAccess` in packages/data decides it; the caller also checks the thing is
 * open, so a link never promises a page that says "coming soon"). Both pages live in the member area, one click from here: the same
 * sign-in, the same account, a "Dashboard" link back (components/member/MemberShell.tsx).
 */
export interface NavExtras {
  studyBuddy?: boolean;
  library?: boolean;
}

export function navigationFor(role: Role, extras: NavExtras = {}): AppNavSection[] {
  const learning: AppNavItem[] = [];
  if (extras.studyBuddy) learning.push({ label: "LearnThrive AI", href: "/library/study-buddy", icon: "study-buddy" });
  if (extras.library) learning.push({ label: "Library", href: "/library", icon: "library" });
  return learning.length > 0 ? [...NAV_BY_ROLE[role], { title: "Learning", items: learning }] : NAV_BY_ROLE[role];
}

/**
 * The ONE navigation of the signed-in product, built from capabilities, never from a hard-coded role list (docs/IDENTITY.md, "One shell"):
 *
 *   tuition      the dashboard areas for this role (families, learners with their own enrolment, tutors, administrators)
 *   studyBuddy   LearnThrive AI, where the assistant is open and this person's access includes it
 *   library      the Library and its search, where the catalogue is open and this person's access includes it
 *   account      the account page (adult account holders and learners; closed inside a supervised view)
 *
 * A link appears only for a page that is open to this person, but hiding a link is never the control: every page and API checks again.
 */
export interface PlatformNavInput {
  role: Role;
  tuition: boolean;
  studyBuddy: boolean;
  library: boolean;
  account: boolean;
}

export function platformNavigation(input: PlatformNavInput): AppNavSection[] {
  const sections: AppNavSection[] = input.tuition ? [...NAV_BY_ROLE[input.role]] : [];
  const learning: AppNavItem[] = [];
  if (input.studyBuddy) learning.push({ label: "LearnThrive AI", href: "/library/study-buddy", icon: "study-buddy" });
  if (input.library) learning.push({ label: "Library", href: "/library", icon: "library", matchPrefix: "/library/search" });
  // A person with the whole platform keeps a short sidebar: the Library's search is in the top-bar palette and the account is in the
  // account menu. A Library-only member has no such tools, so their small menu carries both.
  if (!input.tuition && input.library) learning.push({ label: "Search", href: "/library/search", icon: "search" });
  const account: AppNavItem[] = input.account && !input.tuition ? [{ label: "Account", href: "/account", icon: "account" }] : [];
  if (sections.length === 0) return [{ items: [...learning, ...account] }].filter((s) => s.items.length > 0);
  if (learning.length > 0) sections.push({ title: "Learning", items: learning });
  return sections;
}

/** True when `pathname` is this item's own route or a page nested under it. */
export function isNavItemActive(item: AppNavItem, pathname: string): boolean {
  if (item.matchPrefix) return pathname === item.href || pathname.startsWith(`${item.matchPrefix}/`) || pathname === item.matchPrefix;
  // "/dashboard" would otherwise light up for every page in the app.
  if (item.href === "/dashboard") return pathname === "/dashboard";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
