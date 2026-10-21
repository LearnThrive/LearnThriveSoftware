import type { ReactNode } from "react";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { assistantClosed } from "@/lib/assistant/runtime";
import { HubNav } from "@/components/ui/HubNav";
import styles from "./member.module.css";

/**
 * The signed-in area: the account page now, the Study Buddy later. The icon menu lives here and only here (never in
 * the marketing header). The space the fixed menu needs is reserved by member.module.css.
 *
 * Only pages that exist are in the menu: the Study Buddy appears only where the assistant is open (not in production by default).
 */
const ITEMS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/library", label: "Library", icon: "library" },
  { href: "/library/study-buddy", label: "Study Buddy", icon: "study-buddy" },
  { href: "/library/search", label: "Search", icon: "search" },
  { href: "/account", label: "Account", icon: "account" },
] as const;

export const dynamic = "force-dynamic";

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <MotionRuntime>
      <div className={styles.shell}>
        <HubNav items={ITEMS.filter((item) => item.href !== "/library/study-buddy" || assistantClosed() === null)} />
        {children}
      </div>
    </MotionRuntime>
  );
}
