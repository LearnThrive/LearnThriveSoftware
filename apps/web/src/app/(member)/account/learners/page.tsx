import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LearnersPanel } from "@/components/learner/LearnersPanel";
import { requireAccountPage } from "@/lib/account/pages";
import { nextJar } from "@/lib/account/next";
import { inSupervisedView } from "@/lib/learner/resolve";
import styles from "../account.module.css";

export const metadata: Metadata = { title: "Your learners | LearnThrive", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The guardian's learner management. Adult account holders only; closed inside a supervised view (they leave it with their password first). */
export default async function LearnersPage() {
  const { rt, account } = await requireAccountPage("/account/learners");
  if (account.role === "STUDENT" || account.learner || !account.adultConfirmed) notFound();
  if (await inSupervisedView(rt, await nextJar(), account.profileId)) redirect("/library/ai");
  return (
    <main id="main-content" className={styles.page} style={{ maxWidth: "52rem" }}>
      <h1>Your learners</h1>
      <LearnersPanel />
      <p>
        <Link className="text-link" href="/account">
          Back to your account
        </Link>
      </p>
    </main>
  );
}
