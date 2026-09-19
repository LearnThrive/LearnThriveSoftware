import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { createMetadata } from "@/lib/metadata";

export const metadata: Metadata = createMetadata({
  title: "No access",
  description: "You don't have access to this page.",
  path: "/403",
});

/**
 * Plan6 section 72. Says what happened and offers the way back, without naming roles,
 * permissions or which specific rule refused — that's internal detail a person can't act on.
 */
export default function ForbiddenPage() {
  return (
    <div className="status-page">
      <span className="status-page__icon"><ShieldAlert size={26} aria-hidden="true" /></span>
      <p className="status-page__code">No access</p>
      <h1 className="status-page__title">You don&apos;t have access to this page.</h1>
      <p className="status-page__description">
        If you think you should, ask a LearnThrive admin to check your account.
      </p>
      <div className="status-page__actions">
        <Link href="/dashboard" className="btn btn--primary">Back to dashboard</Link>
      </div>
    </div>
  );
}
