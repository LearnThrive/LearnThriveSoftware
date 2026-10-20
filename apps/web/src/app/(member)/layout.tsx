import type { ReactNode } from "react";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { HubNav } from "@/components/ui/HubNav";
import styles from "./member.module.css";

/**
 * The signed-in area: the account page now, the Study Buddy later. The icon menu lives here and only here (never in
 * the marketing header). The space the fixed menu needs is reserved by member.module.css.
 */
export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <MotionRuntime>
      <div className={styles.shell}>
        <HubNav />
        {children}
      </div>
    </MotionRuntime>
  );
}
