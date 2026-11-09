import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CONCERN_CATEGORY_LABELS, CONCERN_STATUSES, readConcern, type ConcernEventKind } from "@learnthrive/data/safeguarding";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { formatLessonDateTime } from "@/lib/format";
import { getDataProvider } from "@/lib/data/provider";
import { updateConcernAction } from "@/lib/actions/safeguarding";
import { getSafeguarding, safeguardingLeads } from "@/lib/safeguarding/runtime";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, FormActions } from "@/components/ui/Field";

export const metadata: Metadata = createMetadata({ title: "Safeguarding concern", description: "One safeguarding concern.", path: "/dashboard/admin/concerns" });

const EVENT: Record<ConcernEventKind, string> = {
  RAISED: "Raised",
  VIEWED: "Opened",
  ACCESS_REFUSED: "Someone who is not a lead tried to open it and was refused",
  STATUS: "Status changed",
  NOTE: "Note",
};
const STATUS_LABEL: Record<string, string> = { OPEN: "Waiting", IN_REVIEW: "Being looked at", CLOSED: "Closed" };

/**
 * One concern, for a named safeguarding lead only. `readConcern` refuses anyone else (and records the attempt on the concern), and
 * records this opening. The concern's own words cannot be changed; a lead adds notes and moves the status.
 */
export default async function ConcernPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(["ADMIN"]);
  const { id } = await params;
  const result = await readConcern(getSafeguarding(), id, { id: user.id, email: user.email }, safeguardingLeads());
  if (!result.ok) {
    if (result.reason === "not_lead") redirect("/403");
    notFound();
  }
  const { concern, events } = result.value;
  // A tutor's account is shown by the tutor's name; any other account (an administrator has no tutor record unless they teach) by its id.
  const data = getDataProvider();
  const names = new Map<string, string>();
  for (const actorId of new Set([concern.raisedBy, ...events.map((e) => e.actorId)])) {
    const tutor = await data.tutors.getByUserId(actorId);
    names.set(actorId, tutor ? tutor.name : `account ${actorId}`);
  }
  const who = (actorId: string) => names.get(actorId) ?? `account ${actorId}`;

  return (
    <>
      <PageHeader
        backTo={{ href: "/dashboard/admin/concerns", label: "Back to concerns" }}
        eyebrow="Safeguarding concern"
        title={concern.reference}
        description={`${CONCERN_CATEGORY_LABELS[concern.category]}. Raised ${formatLessonDateTime(concern.raisedAt)} by a${concern.raisedByRole === "ADMIN" ? "n administrator" : " tutor"}.`}
        meta={
          <>
            {concern.immediateDanger && <Badge tone="critical">Immediate danger ticked</Badge>}
            <Badge tone={concern.status === "CLOSED" ? "muted" : concern.status === "IN_REVIEW" ? "info" : "warning"}>{STATUS_LABEL[concern.status]}</Badge>
          </>
        }
      />

      <Card>
        <CardHeader title="What was reported" description="As it was written. It cannot be edited." />
        <CardBody>
          <dl className="stack">
            <div><dt><strong>Who it is about</strong></dt><dd>{concern.about}</dd></div>
            <div><dt><strong>What was seen or heard</strong></dt><dd style={{ whiteSpace: "pre-wrap" }}>{concern.details}</dd></div>
            <div><dt><strong>Raised by</strong></dt><dd>{who(concern.raisedBy)}</dd></div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Update" description="Add a note, change the status, or both. Each is added to the history below." />
        <CardBody>
          <form action={updateConcernAction} className="form">
            <input type="hidden" name="concernId" value={concern.id} />
            <Field label="Status" htmlFor="concern-status" required>
              <select id="concern-status" name="status" defaultValue={concern.status} required>
                {CONCERN_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="Note" htmlFor="concern-note" hint="What was done, who was told, and when. Do not paste anything that belongs in a restricted case file.">
              <textarea id="concern-note" name="note" maxLength={2000} rows={4} />
            </Field>
            <FormActions><button className="button" type="submit">Save</button></FormActions>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="History" description="Who did what, and when. Nothing here can be changed or removed." />
        <CardBody>
          <ol className="stack">
            {events.map((e) => (
              <li key={e.id}>
                <strong>{EVENT[e.kind]}</strong> · {formatLessonDateTime(e.at)} · {who(e.actorId)}
                {e.note && <div>{e.note}</div>}
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </>
  );
}
