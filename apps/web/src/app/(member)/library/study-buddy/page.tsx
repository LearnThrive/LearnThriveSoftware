import type { Metadata } from "next";
import Link from "next/link";
import { platformAccess } from "@learnthrive/data/library";
import { StudyBuddyLoader } from "@/components/study-buddy/StudyBuddyLoader";
import { requireAccountPage } from "@/lib/account/pages";
import { assistantClosed } from "@/lib/assistant/runtime";
import styles from "@/components/study-buddy/study-buddy.module.css";

export const metadata: Metadata = { title: "Study Buddy | LearnThrive", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Study Buddy (plan19 phase F), for signed-in adult accounts that hold Library access (enrolled, a subscription or a grant). It is
 * a 404 where the assistant is closed (the kill switch, production without the recorded approval), so a link to it never promises
 * what is not there. The page itself holds no chat: the client fetches it from the routes, which check everything again.
 */
export default async function StudyBuddyPage() {
  const { rt, account } = await requireAccountPage("/library/study-buddy");
  if (assistantClosed(process.env, true)) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
  const facts = account.clientId ? await rt.store.access.facts(account.clientId) : { enrolled: false, subscription: false, adminGrant: false };
  if (!platformAccess(account.role, facts).studyBuddy) {
    return (
      <main id="main-content" className={styles.center}>
        <div>
          <h1>Study Buddy</h1>
          <p>Study Buddy is included for enrolled students and Library subscribers.</p>
          <p>
            <Link className="text-link" href="/pricing">
              About the Library <span aria-hidden="true">→</span>
            </Link>
          </p>
        </div>
      </main>
    );
  }
  if (!account.adultConfirmed) {
    return (
      <main id="main-content" className={styles.center}>
        <p>Study Buddy is for adult account holders.</p>
      </main>
    );
  }
  return (
    <main id="main-content">
      <StudyBuddyLoader />
    </main>
  );
}
