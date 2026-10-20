import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { HubNavBench } from "./HubNavBench";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "HubNav | LearnThrive",
  robots: { index: false, follow: false },
};

/**
 * A development-only bench for HubNav (plan19.md section 7): every current item, the URL-derived current item,
 * and one live fixed instance whose links are harmless same-page anchors. A 404 in production, never indexed.
 */
export default function DevHubNavPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <MotionRuntime>
      <main id="main-content" className={styles.page}>
        <h1>HubNav</h1>
        <p>
          Development only. Under 64rem the menu is a bottom bar; from 64rem it is a side rail. The first block shows each
          current item in the page flow; the live one is pinned to the edge.
        </p>
        <HubNavBench />
      </main>
    </MotionRuntime>
  );
}
