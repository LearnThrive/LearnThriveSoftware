import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { CONCERN_CATEGORY_LABELS, listConcerns, type ConcernStatus } from "@learnthrive/data/safeguarding";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { formatLessonDateTime } from "@/lib/format";
import { concernsOpen, getSafeguarding, safeguardingLeads } from "@/lib/safeguarding/runtime";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordList, RecordRow } from "@/components/records/RecordRow";

export const metadata: Metadata = createMetadata({
  title: "Safeguarding concerns",
  description: "Concerns raised by tutors and administrators, for the safeguarding leads.",
  path: "/dashboard/admin/concerns",
});

const STATUS: Record<ConcernStatus, { label: string; tone: BadgeTone }> = {
  OPEN: { label: "Waiting", tone: "warning" },
  IN_REVIEW: { label: "Being looked at", tone: "info" },
  CLOSED: { label: "Closed", tone: "muted" },
};

/**
 * The concern log (docs/SAFEGUARDING_RECORDS.md). Being an administrator is NOT enough to read it: `listConcerns` returns nothing unless the
 * signed-in person is a named safeguarding lead. Any other administrator sees why, and how to raise a concern themselves.
 */
export default async function ConcernsLogPage() {
  const user = await requireRole(["ADMIN"]);
  const result = await listConcerns(getSafeguarding(), { id: user.id, email: user.email }, safeguardingLeads());
  const raise = <Link className="button button--secondary" href="/dashboard/concerns">Raise a concern</Link>;

  if (!result.ok) {
    return (
      <>
        <PageHeader eyebrow="Safeguarding" title="Concerns" description="Only the named safeguarding leads can read concerns." actions={raise} />
        <Card>
          <CardBody>
            <EmptyState
              icon={<ShieldAlert size={20} />}
              title="You are not a named safeguarding lead"
              description={concernsOpen()
                ? "What tutors and administrators raise here is read only by the safeguarding lead and deputy. You can still raise a concern yourself."
                : "No safeguarding lead has been named for this site yet, so concerns cannot be recorded here. Use the contact details on the safeguarding page."}
            />
          </CardBody>
        </Card>
      </>
    );
  }

  const concerns = result.value;
  const waiting = concerns.filter((c) => c.status !== "CLOSED");
  return (
    <>
      <PageHeader
        eyebrow="Safeguarding"
        title="Concerns"
        description="Every concern raised, newest first. Opening one is recorded on it, with your name and the time."
        actions={raise}
      />
      <Card>
        <CardHeader title={`${waiting.length} not closed`} description="Immediate danger is marked. The list shows no detail: open a concern to read it." />
        <CardBody className="card__body--flush">
          {concerns.length === 0 ? (
            <EmptyState title="No concerns have been raised" icon={<ShieldAlert size={20} />} />
          ) : (
            <RecordList>
              {concerns.map((c) => (
                <RecordRow
                  key={c.id}
                  href={`/dashboard/admin/concerns/${c.id}`}
                  title={c.reference}
                  meta={`${CONCERN_CATEGORY_LABELS[c.category]} · raised ${formatLessonDateTime(c.raisedAt)}`}
                  aside={
                    <>
                      {c.immediateDanger && <Badge tone="critical">Immediate danger</Badge>}
                      <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
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
