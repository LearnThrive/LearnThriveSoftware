import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, FileText } from "lucide-react";
import type { ApplicationEvent } from "@learnthrive/data/careers";
import { APPLICATION_STATUSES } from "@learnthrive/data/careers";
import { requireRole } from "@/lib/auth/guard";
import { accountRuntime } from "@/lib/account/runtime";
import { createMetadata } from "@/lib/metadata";
import { getRole } from "@/lib/careers";
import { readAgreementRecord } from "@/lib/agreement-record";
import { applicationSections } from "@/lib/careers-apply-email";
import { parseApplication } from "@/lib/careers-validation";
import { formatBytes } from "@/lib/careers-files";
import { careersStore } from "@/lib/careers/store";
import { DBS_HOW_LABELS, DELETE_APPLICATION_PHRASE, DELETE_DOCUMENTS_PHRASE, DELETION_REASONS, STATUS_LABELS, STATUS_TONES } from "@/lib/careers/review";
import {
  addApplicationNoteAction, deleteApplicationAction, deleteIdentityDocumentsAction, recordDbsSeenAction, recordIdentitySeenAction, setApplicationStatusAction,
} from "@/lib/actions/careers";
import { formatDateOnly, formatLessonDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FormActions } from "@/components/ui/Field";

export const metadata: Metadata = createMetadata({
  title: "Application",
  description: "A tutor application.",
  path: "/dashboard/admin/careers",
});

const today = () => new Date().toISOString().slice(0, 10);

/** Who did something, by name where the account still exists. Ids are never shown. */
async function namesFor(ids: Array<string | null>): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const rt = await accountRuntime();
  for (const id of new Set(ids.filter((v): v is string => Boolean(v)))) {
    const account = rt ? await rt.store.accounts.getAccount(id).catch(() => null) : null;
    names.set(id, account?.displayName || "An administrator");
  }
  return names;
}

function describe(event: ApplicationEvent, who: string): string {
  switch (event.kind) {
    case "RECEIVED": return "Application received";
    case "STATUS": return `${who} changed the status from ${STATUS_LABELS[event.fromStatus!] ?? event.fromStatus} to ${STATUS_LABELS[event.toStatus!] ?? event.toStatus}`;
    case "FILE_VIEWED": return `${who} opened ${event.detail ?? "a file"}`;
    case "IDENTITY_SEEN": return `${who} recorded identity as seen (${event.detail})`;
    case "DBS_SEEN": return `${who} recorded the DBS check as seen`;
    case "IDENTITY_FILES_DELETED": return `${who} deleted the identity documents (${event.detail})`;
  }
}

/**
 * One tutor application (launch checklist 3.12.3), ADMIN only. The answers as submitted, the files (each opened through the file route,
 * which logs who opened it), internal notes, the status and its retention dates, the identity and DBS records ("seen", by whom and when:
 * never a copy), the history, and deletion (3.12.5).
 */
export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireRole(["ADMIN"]);
  const { id } = await params;
  const store = careersStore();
  const app = store ? await store.get(id) : null;
  if (!app) notFound();

  const fields = parseApplication(app.answers);
  const sections = applicationSections({ fields, record: readAgreementRecord(app.agreement) });
  const names = await namesFor([...app.events.map((e) => e.actorId), ...app.notes.map((n) => n.authorId), app.identitySeen?.by ?? null, app.dbsSeen?.by ?? null]);
  const who = (actor: string | null) => (actor === admin.id ? "You" : actor ? names.get(actor) ?? "An administrator" : "An administrator");
  const role = getRole(app.roleSlug)?.title ?? app.roleSlug;
  const sensitive = app.files.filter((f) => f.sensitive);

  return (
    <>
      <PageHeader
        backTo={{ href: "/dashboard/admin/careers", label: "Back to applications" }}
        breadcrumbs={[{ label: "Applications", href: "/dashboard/admin/careers" }, { label: app.reference }]}
        eyebrow={role}
        title={`${app.firstName} ${app.lastName}`}
        description={`Reference ${app.reference} · received ${formatLessonDateTime(app.receivedAt)}`}
        actions={
          <a className="btn btn--secondary" href={`/api/admin/careers/${app.id}/export`} download>
            <Download size={16} aria-hidden="true" />Export (subject access)
          </a>
        }
      />

      <div className="profile-grid">
        <div className="stack">
          <Card>
            <CardHeader title="Files" description="Untrusted: they came from a public form. Each download is recorded with your name." />
            <CardBody className="card__body--flush">
              {app.files.length === 0 ? (
                <EmptyState title="No files held" />
              ) : (
                <ul className="plain-list" style={{ padding: "0.5rem 1rem" }}>
                  {app.files.map((file) => (
                    <li key={file.id}>
                      <span>
                        <FileText size={16} aria-hidden="true" /> {file.label}
                        <span className="muted"> — {file.filename} ({formatBytes(file.sizeBytes)})</span>
                        {file.sensitive && <> <Badge tone="warning">Identity</Badge></>}
                      </span>
                      <a className="btn btn--secondary btn--sm" href={`/api/admin/careers/${app.id}/files/${file.id}`} download>
                        Download<span className="sr-only"> {file.label}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {sections.map((section) => (
            <Card key={section.heading}>
              <CardHeader title={section.heading} />
              <CardBody>
                <dl className="detail-list">
                  {section.rows.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd style={{ whiteSpace: "pre-wrap" }}>{value || <span className="muted">Not answered</span>}</dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
          ))}
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="Status" />
            <CardBody>
              <p><Badge tone={STATUS_TONES[app.status]}>{STATUS_LABELS[app.status]}</Badge></p>
              <dl className="detail-list">
                {app.decidedAt && <div><dt>Decided</dt><dd>{formatDateOnly(app.decidedAt)}</dd></div>}
                <div><dt>Kept for future roles</dt><dd>{app.talentPool ? "Yes, they asked to be (12 months after the decision)" : "No"}</dd></div>
                <div><dt>Delete the application by</dt><dd>{app.deleteAfter ? formatDateOnly(app.deleteAfter) : app.status === "ACCEPTED" ? "Kept while they work with us" : "Set when a decision is made"}</dd></div>
                {sensitive.length > 0 && (
                  <div><dt>Delete identity documents by</dt><dd>{app.identityDeleteAfter ? formatDateOnly(app.identityDeleteAfter) : "Once identity is verified, or 6 months after an unsuccessful decision"}</dd></div>
                )}
              </dl>
              <form action={setApplicationStatusAction} className="form">
                <input type="hidden" name="id" value={app.id} />
                <Field label="Change the status" htmlFor="application-status" hint="Unsuccessful or withdrawn starts the retention clock; reopening it stops the clock.">
                  <select id="application-status" name="status" defaultValue={app.status}>
                    {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                  </select>
                </Field>
                <FormActions><button type="submit" className="btn btn--primary">Save status</button></FormActions>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Checks" description="Record that you saw them. Never upload or keep a copy, and never note a certificate number." />
            <CardBody>
              <dl className="detail-list">
                <div>
                  <dt>Identity and right to work</dt>
                  <dd>{app.identitySeen ? `Seen ${formatDateOnly(app.identitySeen.on)} by ${who(app.identitySeen.by)}` : "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Enhanced DBS with barred list</dt>
                  <dd>{app.dbsSeen ? `${DBS_HOW_LABELS[app.dbsSeen.how]}, ${formatDateOnly(app.dbsSeen.on)}, by ${who(app.dbsSeen.by)}` : "Not recorded"}</dd>
                </div>
              </dl>
              <form action={recordIdentitySeenAction} className="form">
                <input type="hidden" name="id" value={app.id} />
                <Field label="Identity and right to work seen on" htmlFor="identity-on" required>
                  <input id="identity-on" name="on" type="date" required max={today()} defaultValue={today()} />
                </Field>
                <FormActions><button type="submit" className="btn btn--secondary">Record identity as seen</button></FormActions>
              </form>
              <form action={recordDbsSeenAction} className="form">
                <input type="hidden" name="id" value={app.id} />
                <Field label="DBS check seen on" htmlFor="dbs-on" required>
                  <input id="dbs-on" name="on" type="date" required max={today()} defaultValue={today()} />
                </Field>
                <Field label="How" htmlFor="dbs-how" required>
                  <select id="dbs-how" name="how" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {Object.entries(DBS_HOW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <FormActions><button type="submit" className="btn btn--secondary">Record DBS as seen</button></FormActions>
              </form>
              {sensitive.length > 0 && (
                <form action={deleteIdentityDocumentsAction} className="form">
                  <input type="hidden" name="id" value={app.id} />
                  <p className="muted">
                    Once identity is verified the scans are no longer needed: delete them and keep only the record above. This deletes {sensitive.length} document
                    {sensitive.length === 1 ? "" : "s"} for good.
                  </p>
                  <Field label={`Type ${DELETE_DOCUMENTS_PHRASE} to confirm`} htmlFor="delete-documents" required>
                    <input id="delete-documents" name="confirm" required autoComplete="off" autoCapitalize="none" spellCheck={false} />
                  </Field>
                  <FormActions><button type="submit" className="btn btn--danger">Delete identity documents</button></FormActions>
                </form>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Internal notes" description="Seen by administrators only. An applicant can ask for a copy, so write what you would be content for them to read." />
            <CardBody>
              {app.notes.length === 0 ? (
                <p className="muted">No notes yet.</p>
              ) : (
                <ul className="plain-list">
                  {app.notes.map((note) => (
                    <li key={note.id} style={{ display: "block" }}>
                      <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{note.body}</p>
                      <p className="muted" style={{ margin: 0 }}>{who(note.authorId)}, {formatLessonDateTime(note.at)}</p>
                    </li>
                  ))}
                </ul>
              )}
              <form action={addApplicationNoteAction} className="form">
                <input type="hidden" name="id" value={app.id} />
                <Field label="Add a note" htmlFor="application-note" required>
                  <textarea id="application-note" name="body" rows={4} maxLength={4000} required />
                </Field>
                <FormActions><button type="submit" className="btn btn--secondary">Add note</button></FormActions>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" description="Every change, and every time a file was opened." />
            <CardBody>
              <ul className="plain-list">
                {[...app.events].reverse().map((event) => (
                  <li key={event.id}>
                    <span>{describe(event, who(event.actorId))}</span>
                    <span className="muted">{formatLessonDateTime(event.at)}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Delete this application" description="Removes the answers, the files, the notes and the history for good. A log keeps only the date, who did it, why and how many files." />
            <CardBody>
              <form action={deleteApplicationAction} className="form">
                <input type="hidden" name="id" value={app.id} />
                <Field label="Why" htmlFor="delete-reason" required>
                  <select id="delete-reason" name="reason" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {DELETION_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </Field>
                <Field label={`Type ${DELETE_APPLICATION_PHRASE} to confirm`} htmlFor="delete-application" hint="This cannot be undone." required>
                  <input id="delete-application" name="confirm" required autoComplete="off" autoCapitalize="none" spellCheck={false} />
                </Field>
                <FormActions><button type="submit" className="btn btn--danger">Delete for good</button></FormActions>
              </form>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
