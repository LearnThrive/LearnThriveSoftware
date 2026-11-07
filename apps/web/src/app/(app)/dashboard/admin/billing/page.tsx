import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { familyBalances, formatPence } from "@learnthrive/data/tuitionBilling";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { billingContext } from "@/lib/tuitionBilling/runtime";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader, StatTile } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordList, RecordRow } from "@/components/records/RecordRow";

export const metadata: Metadata = createMetadata({
  title: "Tuition billing",
  description: "What each family owes, monthly in arrears.",
  path: "/dashboard/admin/billing",
});

/** Admin only, and never rendered for a tutor: money is not shown to tutors (owner answer B17). */
export default async function BillingPage() {
  await requireRole(["ADMIN"]);
  const rows = await familyBalances(billingContext());
  const overdue = rows.filter((r) => r.overdue.overdue).length;
  const undecided = rows.reduce((n, r) => n + r.lessonsNeedingDecision, 0);

  return (
    <>
      <PageHeader
        eyebrow="Tuition"
        title="Billing"
        description="Monthly statements in arrears for lessons delivered. Overdue is a flag for a person to look at: nothing here pauses a family's lessons."
        actions={
          <>
            <Link className="button button--secondary" href="/dashboard/admin/billing/tutor-rates">Tutor pay</Link>
            <Link className="button button--secondary" href="/dashboard/admin/billing/settings">Billing rules</Link>
          </>
        }
      />
      <div className="stat-grid">
        <StatTile label="Families" value={rows.length} />
        <StatTile label="Overdue" value={overdue} hint="A flag only; nothing is paused" />
        <StatTile label="Lessons needing a decision" value={undecided} hint="Cancelled or unfinished, not yet explained" />
      </div>
      <Card>
        <CardHeader title="Families" description="Balance is what the family owes now. A negative balance means they are in credit." />
        <CardBody className="card__body--flush">
          {rows.length === 0 ? (
            <EmptyState title="No families yet" icon={<Receipt size={20} />} description="A family appears here once it exists as a client." />
          ) : (
            <RecordList>
              {rows.map((r) => (
                <RecordRow
                  key={r.clientId}
                  href={`/dashboard/admin/billing/${encodeURIComponent(r.clientId)}`}
                  avatarName={r.clientName}
                  title={r.clientName}
                  meta={r.lastStatementPeriod ? `Last statement: ${r.lastStatementPeriod}` : "No statement issued yet"}
                  aside={
                    <>
                      {r.overdue.overdue && <Badge tone="critical">Overdue</Badge>}
                      {r.lessonsNeedingDecision > 0 && <Badge tone="warning">{r.lessonsNeedingDecision} to decide</Badge>}
                      {r.siblingDiscountEligible && <Badge tone="info">Sibling discount</Badge>}
                      <strong>{formatPence(r.balancePence)}</strong>
                    </>
                  }
                />
              ))}
            </RecordList>
          )}
        </CardBody>
      </Card>
    </>
  );
}
