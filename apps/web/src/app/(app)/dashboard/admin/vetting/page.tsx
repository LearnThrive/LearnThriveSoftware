import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { needsAttention, vettingStatus, VETTING_DUE_SOON_DAYS, VETTING_KINDS, VETTING_LABELS } from "@learnthrive/data/safeguarding";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@/lib/data/provider";
import { getSafeguarding, todayInLondon } from "@/lib/safeguarding/runtime";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader, StatTile } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { VettingBadge } from "@/components/people/VettingCard";

export const metadata: Metadata = createMetadata({
  title: "Tutor checks",
  description: "Which checks have been seen for each tutor, and which are missing or running out.",
  path: "/dashboard/admin/vetting",
});

/**
 * The single central record of tutor checks (docs/SAFEGUARDING_RECORDS.md). Administrators only. It is a list for a person to act on:
 * nothing here stops a tutor teaching.
 */
export default async function VettingRegisterPage() {
  await requireRole(["ADMIN"]);
  const today = todayInLondon();
  const [tutors, checks] = await Promise.all([getDataProvider().tutors.list(), getSafeguarding().vetting.list()]);
  const rows = tutors.filter((t) => t.active).map((tutor) => {
    const lines = vettingStatus(checks.filter((c) => c.tutorId === tutor.id), today);
    return { tutor, lines, attention: needsAttention(lines) };
  }).sort((a, b) => Number(b.attention) - Number(a.attention) || a.tutor.name.localeCompare(b.tutor.name));
  const attention = rows.filter((r) => r.attention).length;

  return (
    <>
      <PageHeader
        eyebrow="People"
        title="Tutor checks"
        description={`What has been seen for each active tutor. A check is flagged when it is missing, has run out, or runs out within ${VETTING_DUE_SOON_DAYS} days. Nothing is blocked automatically.`}
      />
      <div className="stat-grid">
        <StatTile label="Active tutors" value={rows.length} />
        <StatTile label="Need attention" value={attention} hint="A required check missing, or any check expired or running out" />
      </div>
      {rows.length === 0 ? (
        <Card><CardBody><EmptyState title="No active tutors" icon={<ShieldCheck size={20} />} description="A tutor appears here once they are added." /></CardBody></Card>
      ) : (
        rows.map(({ tutor, lines }) => (
          <Card key={tutor.id}>
            <CardHeader title={<Link href={`/dashboard/admin/tutors/${tutor.id}`}>{tutor.name}</Link>} description="Open the tutor to record or remove a check." />
            <CardBody>
              <dl className="vetting-grid">
                {VETTING_KINDS.map((kind) => {
                  const line = lines.find((l) => l.kind === kind)!;
                  return (
                    <div key={kind} className="vetting-grid__item">
                      <dt>{VETTING_LABELS[kind]}</dt>
                      <dd>
                        <VettingBadge line={line} />
                        {line.check?.expiresOn && <span className="vetting-grid__date"> until {line.check.expiresOn}</span>}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </CardBody>
          </Card>
        ))
      )}
    </>
  );
}
