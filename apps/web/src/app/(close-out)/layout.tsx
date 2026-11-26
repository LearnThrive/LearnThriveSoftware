import type { ReactNode } from "react";
import styles from "./dashboard/close-out/closeOut.module.css";

/** No sidebar or top bar on purpose: there is nowhere else to go until the lesson is finished (docs/LESSON_REPORTS.md). */
export default function CloseOutLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`close-out ${styles.screen}`}>
      <main id="main-content" className={`app-content ${styles.column}`}>{children}</main>
    </div>
  );
}
