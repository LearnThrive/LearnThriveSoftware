import type { ReactNode } from "react";
import type { Viewport } from "next";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { MemberShell, type MemberNavItem } from "@/components/member/MemberShell";
import { currentAccess } from "@/lib/access/current";
import { assistantClosed } from "@/lib/assistant/runtime";
import { PORTAL_ENABLED } from "@/lib/portal";

/**
 * The signed-in area for Library members: the account page, the Library's member pages and Study Buddy, in one frame with one navigation
 * (MemberShell), never in the marketing header. Staff and enrolled families reach it from the dashboard's "Learning" menu and get a
 * "Dashboard" link here in return. Only pages that exist are in the menu: Study Buddy appears only where the assistant is open (not in
 * production by default).
 */
const ITEMS: readonly MemberNavItem[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/library", label: "Library", icon: "library" },
  { href: "/library/study-buddy", label: "Study Buddy", icon: "study-buddy" },
  { href: "/library/search", label: "Search", icon: "search" },
  { href: "/account", label: "Account", icon: "account" },
];

export const dynamic = "force-dynamic";

// On a phone the on-screen keyboard shrinks the layout instead of covering it, so Study Buddy's box stays above the keyboard.
export const viewport: Viewport = { interactiveWidget: "resizes-content" };

export default async function MemberLayout({ children }: { children: ReactNode }) {
  // Staff and enrolled families have the whole platform, so the member area links back to it (the same sign-in, the same account). A
  // Library subscriber has no dashboard, so no such link. `platformAccess` is the one rule, and the dashboard link also needs the signed-in app open.
  const who = await currentAccess();
  const items: MemberNavItem[] = [
    ...(who?.access.dashboard && PORTAL_ENABLED ? [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" } satisfies MemberNavItem] : []),
    ...ITEMS.filter((item) => item.href !== "/library/study-buddy" || assistantClosed() === null),
  ];
  return (
    <MotionRuntime>
      <MemberShell items={items}>{children}</MemberShell>
    </MotionRuntime>
  );
}
