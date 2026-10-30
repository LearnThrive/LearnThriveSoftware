import type { Metadata } from "next";
import Link from "next/link";
import { accessFactsFor, platformAccess } from "@learnthrive/data/library";
import { StudyBuddyLoader } from "@/components/study-buddy/StudyBuddyLoader";
import { requireAccountPage } from "@/lib/account/pages";
import { assistantClosed } from "@/lib/assistant/runtime";
import styles from "@/components/study-buddy/study-buddy.module.css";

export const metadata: Metadata = { title: "LearnThrive AI | LearnThrive", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * LearnThrive AI (plan19 phase F), for signed-in adult accounts that hold Library access (enrolled, a subscription or a grant). It is
 * a 404 where the assistant is closed (the kill switch, production without the recorded approval), so a link to it never promises
 * what is not there. The page itself holds no chat: the client fetches it from the routes, which check everything again.
 */
export default async function StudyBuddyPage() {
  const { rt, account } = await requireAccountPage("/library/ai");
  if (assistantClosed(process.env, true)) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
  const facts = await accessFactsFor(rt.store, account);
  if (!platformAccess(account.role, facts).studyBuddy) {
    return (
      <main id="main-content" className={styles.center}>
        <div>
          <h1>LearnThrive AI</h1>
          <p>LearnThrive AI is included for enrolled students and Library subscribers.</p>
          <p>
            <Link className="text-link" href="/pricing">
              About the Library <span aria-hidden="true">→</span>
            </Link>
          </p>
        </div>
      </main>
    );
  }
  if (!account.adultConfirmed && !account.learner) {
    return (
      <main id="main-content" className={styles.center}>
        <p>LearnThrive AI is for adult account holders.</p>
      </main>
    );
  }
  return (
    <main id="main-content">
      <StudyBuddyLoader />
    </main>
  );
}
