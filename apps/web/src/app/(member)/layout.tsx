import type { ReactNode } from "react";
import type { Viewport } from "next";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { MemberShell, type MemberNavItem } from "@/components/member/MemberShell";
import { assistantClosed } from "@/lib/assistant/runtime";

/**
 * The signed-in area: the account page, the Library's member pages and Study Buddy, in one frame with one navigation (MemberShell),
 * never in the marketing header. Only pages that exist are in the menu: Study Buddy appears only where the assistant is open (not in
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

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <MotionRuntime>
      <MemberShell items={ITEMS.filter((item) => item.href !== "/library/study-buddy" || assistantClosed() === null)}>{children}</MemberShell>
    </MotionRuntime>
  );
}
