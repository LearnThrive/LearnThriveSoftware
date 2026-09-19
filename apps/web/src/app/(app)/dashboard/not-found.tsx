import Link from "next/link";
import { SearchX } from "lucide-react";

/** The authenticated 404 — inside the (app) group, so it keeps the sidebar and topbar around it
 * rather than dropping a signed-in person onto a marketing page (plan6 section 71). */
export default function DashboardNotFound() {
  return (
    <div className="status-page">
      <span className="status-page__icon"><SearchX size={26} aria-hidden="true" /></span>
      <p className="status-page__code">Not found</p>
      <h1 className="status-page__title">We couldn&apos;t find that page.</h1>
      <p className="status-page__description">
        It may have been removed, or the link may be out of date.
      </p>
      <div className="status-page__actions">
        <Link href="/dashboard" className="btn btn--primary">Back to dashboard</Link>
        <Link href="/dashboard/lessons" className="btn btn--secondary">View lessons</Link>
      </div>
    </div>
  );
}
