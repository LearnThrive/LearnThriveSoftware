import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { formatPence, lessonMoneyFor, londonYmd, PERIOD, type LessonMoney } from "@learnthrive/data/tuitionBilling";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { billingContext } from "@/lib/tuitionBilling/runtime";
import { clearLessonPriceAction, setLessonPriceAction } from "@/lib/actions/tuitionBilling";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, StatTile } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import styles from "./lessonPrices.module.css";

export const metadata: Metadata = createMetadata({
  title: "Lesson prices",
  description: "What each lesson costs the family and pays the tutor, side by side.",
  path: "/dashboard/admin/billing/lessons",
});

const monthName = (period: string) => new Date(`${period}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const pounds = (pence: number | null | undefined) => (pence === null || pence === undefined ? "" : (pence / 100).toFixed(2));
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

/**
 * Every lesson in a month with the two sides of its money kept apart: what the families are charged for it and what its tutor is paid for it.
 * Each lesson can be given its own price on either side (a lesson may cost a family 10 pounds and pay its tutor 5); left blank, the hourly
 * rates apply. Admin only, like every billing screen: a tutor never sees any of it (B17).
 */
export default async function LessonPricesPage({ searchParams }: { searchParams: Promise<{ period?: string; toast?: string }> }) {
  await requireRole(["ADMIN"]);
  const requested = (await searchParams).period ?? "";
  const period = PERIOD.test(requested) ? requested : londonYmd(new Date().toISOString()).slice(0, 7);
  const rows = await lessonMoneyFor(billingContext(), period);
  const owed = rows.reduce((n, r) => n + r.clientOwedPence, 0);
  const paid = rows.reduce((n, r) => n + (r.tutorPayPence ?? 0), 0);
  const ownPrice = rows.filter((r) => r.price).length;

  return (
    <>
      <PageHeader
        backTo={{ href: "/dashboard/admin/billing", label: "Back to billing" }}
        eyebrow="Tuition billing"
        title={`Lesson prices for ${monthName(period)}`}
        description="What each lesson costs the family and what its tutor is paid, kept apart. Give a lesson its own price on either side; leave it blank and the hourly rates apply."
        actions={<Link className="btn btn--secondary" href={`/dashboard/admin/billing/tutor-pay?period=${period}`}>Pay run for this month</Link>}
      />
      <form method="get" className="form">
        <label className="field__label" htmlFor="lp-period">Month</label>
        <input id="lp-period" name="period" type="month" defaultValue={period} />
        <button type="submit" className="btn btn--secondary">Show</button>
      </form>
      <div className="stat-grid">
        <StatTile label="Families are charged" value={formatPence(owed)} hint="Before any sibling discount" />
        <StatTile label="Tutors are paid" value={formatPence(paid)} hint="Completed lessons only" />
        <StatTile label="Difference" value={formatPence(owed - paid)} />
        <StatTile label="Lessons with their own price" value={`${ownPrice} of ${rows.length}`} />
      </div>
      {rows.length === 0 ? (
        <Card><CardBody><EmptyState icon={<CalendarClock size={20} />} title="No lessons this month" description="Lessons appear here for the month they are taught in." /></CardBody></Card>
      ) : (
        <Card>
          <CardHeader title="Lessons" description="The family amount is per child and is what goes on the statement. The tutor amount is for the lesson, once, and is what goes in the pay run." />
          <CardBody className="card__body--flush">
            <ul className={styles.list}>{rows.map((r) => <LessonRow key={r.lessonId} row={r} period={period} />)}</ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function LessonRow({ row: r, period }: { row: LessonMoney; period: string }) {
  const id = r.lessonId;
  return (
    <li className={styles.row} id={`lesson-${id}`}>
      <div className={styles.head}>
        <Link href={`/dashboard/lessons/${encodeURIComponent(id)}`} className={styles.title}>{r.title}</Link>
        <span className={styles.meta}>{r.date} at {time(r.startAt)} · {r.minutes} min · {r.tutorName || "No tutor"} · {r.status.toLowerCase().replace(/_/g, " ")}</span>
        <span className={styles.badges}>
          {r.price && <Badge tone="info">Own price</Badge>}
          {r.invoiced && <Badge tone="neutral">On an issued statement</Badge>}
          {r.flags.includes("NO_RATE") && <Badge tone="warning">No family rate</Badge>}
          {r.flags.includes("NEEDS_DECISION") && <Badge tone="warning">Needs a decision</Badge>}
        </span>
      </div>
      <dl className={styles.money}>
        <div><dt>Family owes</dt><dd>{formatPence(r.clientOwedPence)}</dd></div>
        <div><dt>Tutor gets</dt><dd>{r.tutorPayPence === null ? "Not paid yet" : formatPence(r.tutorPayPence)}</dd></div>
        <div><dt>Difference</dt><dd className={r.marginPence !== null && r.marginPence < 0 ? styles.negative : undefined}>{r.marginPence === null ? "-" : formatPence(r.marginPence)}</dd></div>
      </dl>
      <details className={styles.edit}>
        <summary>{r.price ? "Change this lesson's price" : "Set a price for this lesson"}</summary>
        <form action={setLessonPriceAction} className={styles.form}>
          <input type="hidden" name="lessonId" value={id} />
          <input type="hidden" name="period" value={period} />
          <label>
            <span>Family pays, per child (£)</span>
            {/* Once the family has been sent a statement with this lesson on it, its price is fixed; the field is kept so the form says so. */}
            <input name="client" inputMode="decimal" autoComplete="off" placeholder="Hourly rate" defaultValue={pounds(r.price?.clientPence)} readOnly={r.invoiced} aria-describedby={r.invoiced ? `frozen-${id}` : undefined} />
          </label>
          <label>
            <span>Tutor gets, for the lesson (£)</span>
            <input name="tutor" inputMode="decimal" autoComplete="off" placeholder="Hourly pay" defaultValue={pounds(r.price?.tutorPence)} />
          </label>
          <label className={styles.note}>
            <span>Note (optional)</span>
            <input name="note" maxLength={500} autoComplete="off" defaultValue={r.price?.note ?? ""} />
          </label>
          <button type="submit" className="btn btn--secondary">Save</button>
          {r.invoiced && <p id={`frozen-${id}`} className={styles.hint}>This lesson is on an issued statement, so what the family pays can no longer change. The tutor&apos;s pay still can.</p>}
        </form>
        {r.price && !(r.invoiced && r.price.clientPence !== null) && (
          <form action={clearLessonPriceAction}>
            <input type="hidden" name="lessonId" value={id} />
            <input type="hidden" name="period" value={period} />
            <button type="submit" className="btn btn--ghost">Back to the hourly rates</button>
          </form>
        )}
      </details>
    </li>
  );
}
