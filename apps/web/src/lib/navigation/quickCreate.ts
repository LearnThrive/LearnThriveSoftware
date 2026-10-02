import type { Role } from "@/lib/auth/types";

/**
 * What the "+ Create" control offers, and to whom (plan6 section 51). One list for the menu
 * (components/dashboards/QuickCreateMenu.tsx) and the command palette (lib/palette/appCommands.ts), so
 * the two can never disagree about what a role may start. Each entry goes to the page that owns that
 * creation flow, where the real, authorised form lives: this list grants nothing by itself.
 */
export const QUICK_CREATE = [
  { href: "/dashboard/admin/people/students", label: "Student" },
  { href: "/dashboard/admin/people/clients", label: "Client" },
  { href: "/dashboard/admin/people/tutors", label: "Tutor" },
  { href: "/dashboard/admin/assignments", label: "Tuition assignment" },
  { href: "/dashboard/admin/lessons/new", label: "Lesson" },
] as const;

/** Only an Admin creates records today; every other role starts nothing from the palette or the menu. */
export function quickCreateFor(role: Role): readonly (typeof QUICK_CREATE)[number][] {
  return role === "ADMIN" ? QUICK_CREATE : [];
}
