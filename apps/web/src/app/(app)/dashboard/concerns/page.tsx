import type { Metadata } from "next";
import Link from "next/link";
import { CONCERN_CATEGORIES, CONCERN_CATEGORY_LABELS, myConcernReceipts } from "@learnthrive/data/safeguarding";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { formatDateOnly } from "@/lib/format";
import { siteConfig } from "@/lib/site";
import { raiseConcernAction } from "@/lib/actions/safeguarding";
import { concernsOpen, getSafeguarding } from "@/lib/safeguarding/runtime";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, FormActions } from "@/components/ui/Field";

export const metadata: Metadata = createMetadata({
  title: "Raise a safeguarding concern",
  description: "Tell the safeguarding lead about something that worries you.",
  path: "/dashboard/concerns",
});

const REFERENCE = /^SC-\d{8}-[0-9A-F]{6}$/;

/**
 * Where a tutor or an administrator raises a safeguarding concern (docs/SAFEGUARDING_RECORDS.md). What they write is read only by the
 * named safeguarding leads; afterwards the person who raised it sees a reference and a status here, never the content. If no lead has
 * been named, nothing can be stored and the page gives the published contact route instead.
 */
export default async function ConcernsPage({ searchParams }: { searchParams: Promise<{ raised?: string; told?: string }> }) {
  const user = await requireRole(["TUTOR", "ADMIN"]);
  const { raised = "", told } = await searchParams;
  const open = concernsOpen();
  const receipts = open ? await myConcernReceipts(getSafeguarding(), user.id) : [];

  return (
    <>
      <PageHeader
        eyebrow="Safeguarding"
        title="Raise a concern"
        description="If something you saw or heard worries you, say so here. You do not need to be sure, and you do not need proof."
      />

      <div className="alert alert--error" role="note">
        <p><strong>If a child is in immediate danger, call 999 first.</strong> Then tell the safeguarding lead.</p>
      </div>

      {REFERENCE.test(raised) && (
        <div className="alert alert--info" role="status">
          <div className="alert__body">
          <p><strong>Your concern has been recorded. Reference {raised}.</strong></p>
          <p>{told === "0"
            ? "We could not email the safeguarding lead just now. Please also contact them directly so they know it is waiting."
            : "The safeguarding lead has been told that it is waiting."} Do not investigate yourself, and do not discuss it with the family or other tutors.</p>
          </div>
        </div>
      )}

      {open ? (
        <Card>
          <CardHeader title="What happened" description="Only the safeguarding lead and deputy can read what you write. Write what you saw or heard, in the person's own words where you can, with dates and times." />
          <CardBody>
            <form action={raiseConcernAction} className="form">
              <Field label="What is it about" htmlFor="concern-category" required>
                <select id="concern-category" name="category" required defaultValue="">
                  <option value="" disabled>Choose</option>
                  {CONCERN_CATEGORIES.map((c) => <option key={c} value={c}>{CONCERN_CATEGORY_LABELS[c]}</option>)}
                </select>
              </Field>
              <Field label="Who is it about" htmlFor="concern-about" required hint="The learner or adult, and the lesson if it happened in one.">
                <input id="concern-about" name="about" required minLength={2} maxLength={200} autoComplete="off" />
              </Field>
              <Field label="What you saw or heard" htmlFor="concern-details" required hint="Facts first. Say what was said, by whom and when. Do not ask the child leading questions to find out more.">
                <textarea id="concern-details" name="details" required minLength={10} maxLength={5000} rows={8} />
              </Field>
              <Field label="Could someone be in immediate danger" htmlFor="concern-danger" required>
                <select id="concern-danger" name="immediateDanger" required defaultValue="false">
                  <option value="false">No, or I do not know</option>
                  <option value="true">Yes</option>
                </select>
              </Field>
              <FormActions><button className="btn btn--primary" type="submit">Send to the safeguarding lead</button></FormActions>
            </form>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Tell the safeguarding lead directly" />
          <CardBody>
            <p>Concerns cannot be recorded here yet. Contact the safeguarding lead straight away using the details on the <Link href="/safeguarding">safeguarding page</Link>, or email <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.</p>
          </CardBody>
        </Card>
      )}

      {receipts.length > 0 && (
        <Card>
          <CardHeader title="Concerns you have raised" description="A reference and where it has got to. What you wrote is not shown again." />
          <CardBody className="card__body--flush">
            <ul className="record-list">
              {receipts.map((r) => (
                <li key={r.id} className="record-list__item">
                  <div className="record-list__link">
                    <span className="record-list__body">
                      <span className="record-list__title">{r.reference}</span>
                      <span className="record-list__meta">Raised {formatDateOnly(r.raisedAt)}</span>
                    </span>
                    <span className="record-list__aside">
                      <Badge tone={r.status === "CLOSED" ? "muted" : r.status === "IN_REVIEW" ? "info" : "warning"}>{r.status === "IN_REVIEW" ? "Being looked at" : r.status === "CLOSED" ? "Closed" : "Waiting"}</Badge>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}
