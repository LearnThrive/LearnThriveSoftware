import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { formatPence, londonYmd, PERIOD, previousPeriod, tutorPayFor } from "@learnthrive/data/tuitionBilling";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { billingContext } from "@/lib/tuitionBilling/runtime";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, StatTile } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = createMetadata({
  title: "Tutor pay for a month",
  description: "What each tutor is owed for a month's lessons.",
  path: "/dashboard/admin/billing/tutor-pay",
});

const monthName = (period: string) => new Date(`${period}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * What each tutor is owed for the lessons they delivered in a month. Tutors are paid from the company bank account on the 15th of the
 * following month (Tahasin, 14 Nov 2026), so the usual month to look at is last month's. This adds up; it moves no money, and a tutor never
 * sees it. Admin only.
 */
export default async function TutorPayPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  await requireRole(["ADMIN"]);
  const requested = (await searchParams).period ?? "";
  const period = PERIOD.test(requested) ? requested : previousPeriod(londonYmd(new Date().toISOString()).slice(0, 7));
  const summaries = await tutorPayFor(billingContext(), period);
  const total = summaries.reduce((n, s) => n + s.totalPence, 0);
  const withWork = summaries.filter((s) => s.lines.length > 0 || s.allAbsentLessons.length > 0);
  const csv = (kind: string) => `/api/admin/billing/export?kind=${kind}&period=${period}`;

  return (
    <>
      <PageHeader
        backTo={{ href: "/dashboard/admin/billing", label: "Back to billing" }}
        eyebrow="Tuition billing"
        title={`Tutor pay for ${monthName(period)}`}
        description="Lessons completed in the month, at each tutor's hourly pay on the day, or at the pay set for a lesson (or repeated across lessons) on the Lesson prices page. Paid from the business account on the 15th of the next month. This adds up what is owed; nothing is paid from here."
        actions={
          <>
            <a className="btn btn--secondary" href={`/dashboard/admin/billing/lessons?period=${period}`}>Lesson prices</a>
            <a className="btn btn--secondary" href={csv("tutor-pay")}>Download pay run (CSV)</a>
            <a className="btn btn--secondary" href={csv("statements")}>Download statements (CSV)</a>
            <a className="btn btn--secondary" href="/api/admin/billing/export?kind=payments">Download payments (CSV)</a>
          </>
        }
      />
      <form method="get" className="form">
        <label className="field__label" htmlFor="tp-period">Month</label>
        <input id="tp-period" name="period" type="month" defaultValue={period} />
        <button type="submit" className="btn btn--secondary">Show</button>
      </form>
      <div className="stat-grid">
        <StatTile label="Total owed to tutors" value={formatPence(total)} />
        <StatTile label="Tutors with lessons" value={withWork.length} />
      </div>
      {withWork.length === 0 ? (
        <Card><CardBody><EmptyState icon={<Wallet size={20} />} title="No completed lessons this month" description="A lesson counts once it is marked complete." /></CardBody></Card>
      ) : (
        withWork.map((s) => (
          <Card key={s.tutorId}>
            <CardHeader title={s.tutorName} description={`${s.lines.length} lesson${s.lines.length === 1 ? "" : "s"}, ${(s.totalMinutes / 60).toFixed(2)} hours · ${formatPence(s.totalPence)}`} />
            <CardBody>
              {s.unpricedLessons > 0 && <p><Badge tone="warning">No pay rate</Badge> {s.unpricedLessons} lesson{s.unpricedLessons === 1 ? " has" : "s have"} no hourly pay set for this tutor on that date, so {s.unpricedLessons === 1 ? "it is" : "they are"} counted at nothing. Set it on the Tutor pay page.</p>}
              {s.allAbsentLessons.length > 0 && <p><Badge tone="info">To decide</Badge> {s.allAbsentLessons.length} lesson{s.allAbsentLessons.length === 1 ? " was" : "s were"} not counted because every child was absent: {s.allAbsentLessons.map((l) => `${l.date} ${l.title}`).join("; ")}. Whether a tutor is paid for waiting has not been decided.</p>}
              <ul>{s.lines.map((l) => <li key={l.lessonId}>{l.date} · {l.title} · {l.minutes} min · {l.priceFrom === "lesson" ? "set for this lesson" : l.priceFrom === "repeating" ? "repeating price" : l.ratePence === null ? "no rate" : `${formatPence(l.ratePence)} an hour`} · <strong>{formatPence(l.amountPence)}</strong></li>)}</ul>
            </CardBody>
          </Card>
        ))
      )}
    </>
  );
}
