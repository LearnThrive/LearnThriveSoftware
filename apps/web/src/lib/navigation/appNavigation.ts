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
  | "assignments" | "reports" | "notifications" | "activity" | "settings" | "availability";

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

export function navigationFor(role: Role): AppNavSection[] {
  return NAV_BY_ROLE[role];
}

/** True when `pathname` is this item's own route or a page nested under it. */
export function isNavItemActive(item: AppNavItem, pathname: string): boolean {
  if (item.matchPrefix) return pathname === item.href || pathname.startsWith(`${item.matchPrefix}/`) || pathname === item.matchPrefix;
  // "/dashboard" would otherwise light up for every page in the app.
  if (item.href === "/dashboard") return pathname === "/dashboard";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
