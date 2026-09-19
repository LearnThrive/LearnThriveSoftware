"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Plan6 section 70: when something genuinely fails, say so in plain words and offer the next
 * step — retry, or go somewhere that works. The underlying error is logged for developers but
 * never printed at people, since a stack trace is not an action anyone can take.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Dashboard route error:", error);
  }, [error]);

  return (
    <div className="status-page">
      <span className="status-page__icon"><AlertTriangle size={26} aria-hidden="true" /></span>
      <p className="status-page__code">Something went wrong</p>
      <h1 className="status-page__title">We couldn&apos;t load this page.</h1>
      <p className="status-page__description">
        This is usually temporary. Try again, and if it keeps happening let a LearnThrive admin know.
      </p>
      <div className="status-page__actions">
        <button type="button" className="btn btn--primary" onClick={reset}>Try again</button>
        <Link href="/dashboard" className="btn btn--secondary">Back to dashboard</Link>
      </div>
    </div>
  );
}
