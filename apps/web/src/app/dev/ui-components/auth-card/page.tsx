import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MotionRuntime } from "@/components/motion/MotionRuntime";
import { AuthCardBench } from "./AuthCardBench";
import styles from "./AuthCardBench.module.css";

export const metadata: Metadata = {
  title: "AuthCard | LearnThrive",
  robots: { index: false, follow: false },
};

/**
 * Development-only bench for AuthCard (plan19.md section 7). Every mode and state on one page with stable
 * `data-state` hooks for tests, plus one interactive card that behaves like the real flow would (no network).
 * Same convention as /dev/motion: a 404 in production (the proxy also refuses /dev/**), never indexed.
 */
export default function DevAuthCardPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <MotionRuntime>
      <main id="main-content" className={styles.page}>
        <h1>AuthCard</h1>
        <p>Development only. Nothing here talks to a server; the interactive card below answers from a few fixed rules.</p>
        <AuthCardBench />
      </main>
    </MotionRuntime>
  );
}
