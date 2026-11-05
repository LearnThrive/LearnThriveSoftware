import type { PurgeKind, PurgePreview } from "@learnthrive/data/repositories";
import { PURGE_DELAY_DAYS } from "@learnthrive/data/repositories";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, FormActions } from "@/components/ui/Field";
import { bringForwardAction, cancelLeftAction, markLeftAction } from "@/lib/actions/purge";

/**
 * What a purge will do, shown before it can be confirmed (launch checklist 3.7.3). The lists come from the provider, so the screen and
 * the deletion cannot drift apart. The typed phrase is deliberate friction: a purge is final and cannot be undone by the app.
 *
 * And before any of that, the pause. A record is marked as left first, which deletes nothing and can be undone; the purge becomes
 * possible {PURGE_DELAY_DAYS} days later, and an administrator may bring that date forward but never push it back. The database holds
 * the same rule (migration 0019), so a purge cannot skip the wait even if this screen is bypassed.
 */
const dayOnly = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
/** A date input wants yyyy-mm-dd, and must not offer a day before today. */
const forInput = (date: Date) => date.toISOString().slice(0, 10);

export function PurgePanel({
  preview,
  action,
  kind,
  id,
  returnTo,
  confirmation,
  title,
  description,
}: {
  preview: PurgePreview;
  action: (formData: FormData) => Promise<void>;
  kind: PurgeKind;
  id: string;
  returnTo: string;
  confirmation: string;
  title: string;
  description: string;
}) {
  const inputId = `purge-confirm-${id}`;
  const dateId = `purge-after-${id}`;
  const hidden = (
    <>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="returnTo" value={returnTo} />
    </>
  );

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody>
        <p className="muted">This removes, in one step:</p>
        <ul className="plain-list">
          {preview.removes.map((item) => (
            <li key={item.what}>
              <span>{item.what}</span>
              <span>{item.count}</span>
            </li>
          ))}
        </ul>

        {preview.keeps.length > 0 && (
          <>
            <p className="muted" style={{ marginTop: "1rem" }}>This is kept, and why:</p>
            <ul className="plain-list">
              {preview.keeps.map((item) => (
                <li key={item.what}>
                  <span>
                    {item.what}
                    <span className="muted"> — {item.reason}</span>
                  </span>
                  <span>{item.count}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <ul className="plain-list" style={{ marginTop: "1rem" }}>
          {preview.notes.map((note) => (
            <li key={note}>
              <span className="muted">{note}</span>
            </li>
          ))}
        </ul>

        {preview.readiness === "not_left" ? (
          <form action={markLeftAction} className="form">
            {hidden}
            <p className="muted">
              Nothing can be purged until it is marked as left. That deletes nothing and can be undone; the purge becomes possible{" "}
              {PURGE_DELAY_DAYS} days later, so a mistake has time to be noticed.
            </p>
            <FormActions>
              <button type="submit" className="btn btn--secondary">Mark as left</button>
            </FormActions>
          </form>
        ) : (
          <>
            <dl className="detail-list">
              <div><dt>Marked as left</dt><dd>{preview.leftAt ? dayOnly(preview.leftAt) : "—"}</dd></div>
              <div>
                <dt>Can be purged from</dt>
                <dd>{preview.purgeAfter ? dayOnly(preview.purgeAfter) : "—"}{preview.readiness === "due" ? " (now)" : ""}</dd>
              </div>
            </dl>

            <form action={cancelLeftAction} className="form">
              {hidden}
              <p className="muted">If they have come back, or this was a mistake, undo it: nothing has been deleted yet.</p>
              <FormActions>
                <button type="submit" className="btn btn--secondary">They have not left</button>
              </FormActions>
            </form>

            {preview.readiness === "not_due" && (
              <form action={bringForwardAction} className="form">
                {hidden}
                <Field label="Bring the purge forward to" htmlFor={dateId} hint="Only earlier than the date above. Today means it can be purged at once.">
                  <input id={dateId} name="purgeAfter" type="date" required min={forInput(new Date())} max={preview.purgeAfter ? forInput(new Date(preview.purgeAfter)) : undefined} />
                </Field>
                <FormActions>
                  <button type="submit" className="btn btn--secondary">Bring it forward</button>
                </FormActions>
              </form>
            )}

            {preview.readiness === "due" && (
              <form action={action} className="form">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <Field label={`Type ${confirmation} to confirm`} htmlFor={inputId} hint="A purge cannot be undone.">
                  <input id={inputId} name="confirm" required autoComplete="off" autoCapitalize="none" spellCheck={false} />
                </Field>
                <FormActions>
                  <button type="submit" className="btn btn--danger">Purge for good</button>
                </FormActions>
              </form>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
