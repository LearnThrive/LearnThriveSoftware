import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";
import type { ApplicationStatus, ApplicationSummary } from "@learnthrive/data/careers";
import { APPLICATION_STATUSES, isApplicationStatus } from "@learnthrive/data/careers";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getRole } from "@/lib/careers";
import { careersStore } from "@/lib/careers/store";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/careers/review";
import { formatDateOnly } from "@/lib/format";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordList, RecordRow } from "@/components/records/RecordRow";

export const metadata: Metadata = createMetadata({
  title: "Applications",
  description: "Tutor applications received through the careers page.",
  path: "/dashboard/admin/careers",
});

/** How far ahead the "due for deletion" list looks: this month's routine also catches what falls due before the next one. */
const DUE_WINDOW_DAYS = 31;

const roleTitle = (slug: string) => getRole(slug)?.title ?? slug;

function ApplicationRows({ items, aside }: { items: ApplicationSummary[]; aside: (a: ApplicationSummary) => React.ReactNode }) {
  return (
    <RecordList>
      {items.map((a) => (
        <RecordRow
          key={a.id}
          href={`/dashboard/admin/careers/${a.id}`}
          title={`${a.firstName} ${a.lastName}`}
          meta={`${roleTitle(a.roleSlug)} · ${a.reference} · received ${formatDateOnly(a.receivedAt)}`}
          aside={aside(a)}
        />
      ))}
    </RecordList>
  );
}

/**
 * Tutor applications (launch checklist 3.12.3), ADMIN only: a list by status, and what is due for deletion under
 * docs/RETENTION_AND_DELETION.md (3.12.5). Tutors, families and learners never reach this page; the actions and the file route check
 * ADMIN again themselves.
 */
export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireRole(["ADMIN"]);
  const { status: asked } = await searchParams;
  const status: ApplicationStatus | undefined = isApplicationStatus(asked) ? asked : undefined;
  const store = careersStore();

  if (!store) {
    return (
      <>
        <PageHeader eyebrow="People" title="Applications" description="Tutor applications received through the careers page." />
        <Card className="card--empty">
          <EmptyState icon={<Inbox size={22} />} title="Applications are not available" description="This server has no database settings, so it cannot store or show applications." />
        </Card>
      </>
    );
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + DUE_WINDOW_DAYS * 86_400_000);
  const [all, due] = await Promise.all([store.list(), store.dueBy(horizon)]);
  const visible = status ? all.filter((a) => a.status === status) : all;
  const counts = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, all.filter((a) => a.status === s).length])) as Record<ApplicationStatus, number>;
  const nowIso = now.toISOString();
  const dueLabel = (when: string) => (when <= nowIso ? "Due now" : `Due ${formatDateOnly(when)}`);

  return (
    <>
      <PageHeader
        eyebrow="People"
        title="Applications"
        description="Tutor applications received through the careers page. Only administrators can see them; opening a file is recorded."
      />

      {(due.applications.length > 0 || due.identityDocuments.length > 0) && (
        <Card>
          <CardHeader
            title="Due for deletion"
            description={`Unsuccessful and withdrawn applications whose retention period ends within ${DUE_WINDOW_DAYS} days (docs/RETENTION_AND_DELETION.md). Delete each from its page.`}
          />
          <CardBody className="card__body--flush">
            {due.applications.length > 0 && (
              <ApplicationRows items={due.applications} aside={(a) => <Badge tone={a.deleteAfter! <= nowIso ? "critical" : "warning"}>{dueLabel(a.deleteAfter!)}</Badge>} />
            )}
            {due.identityDocuments.length > 0 && (
              <>
                <p className="muted" style={{ padding: "0.75rem 1rem 0" }}>Identity documents only (the application itself is kept longer):</p>
                <ApplicationRows
                  items={due.identityDocuments}
                  aside={(a) => <Badge tone={a.identityDeleteAfter! <= nowIso ? "critical" : "warning"}>{dueLabel(a.identityDeleteAfter!)}</Badge>}
                />
              </>
            )}
          </CardBody>
        </Card>
      )}

      <nav className="filter-tabs" aria-label="Application status">
        <Link href="/dashboard/admin/careers" className={`filter-tab ${status ? "" : "is-active"}`} aria-current={status ? undefined : "page"}>
          All<span className="filter-tab__count">{all.length}</span>
        </Link>
        {APPLICATION_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/dashboard/admin/careers?status=${s}`}
            className={`filter-tab ${status === s ? "is-active" : ""}`}
            aria-current={status === s ? "page" : undefined}
          >
            {STATUS_LABELS[s]}
            <span className="filter-tab__count">{counts[s]}</span>
          </Link>
        ))}
      </nav>

      <Card className={visible.length === 0 ? "card--empty" : ""}>
        {visible.length === 0 ? (
          <EmptyState
            icon={<Inbox size={22} />}
            title={status ? `No ${STATUS_LABELS[status].toLowerCase()} applications` : "No applications yet"}
            description={status ? "Choose another status above." : "Applications sent through the careers page appear here."}
          />
        ) : (
          <ApplicationRows
            items={visible}
            aside={(a) => (
              <>
                {a.sensitiveFileCount > 0 && <Badge tone="warning">ID documents</Badge>}
                <Badge tone={STATUS_TONES[a.status]}>{STATUS_LABELS[a.status]}</Badge>
              </>
            )}
          />
        )}
      </Card>
    </>
  );
}
