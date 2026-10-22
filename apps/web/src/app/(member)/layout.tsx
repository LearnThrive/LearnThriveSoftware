import type { ReactNode } from "react";
import type { Viewport } from "next";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { PlatformShell } from "@/components/shell/PlatformShell";

/**
 * The signed-in Library area: the account page, the Library's member pages and Study Buddy. They live in the SAME shell as the tuition
 * dashboard (PlatformShell): one sidebar, one top bar, one account menu, with the navigation built from what the person may use. Study
 * Buddy's conversation history is rendered into the shell's secondary slot (SidebarSlot.tsx), never a second navigation column.
 */
export const dynamic = "force-dynamic";

// On a phone the on-screen keyboard shrinks the layout instead of covering it, so Study Buddy's box stays above the keyboard.
export const viewport: Viewport = { interactiveWidget: "resizes-content" };

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <MotionRuntime>
      <PlatformShell>{children}</PlatformShell>
    </MotionRuntime>
  );
}
