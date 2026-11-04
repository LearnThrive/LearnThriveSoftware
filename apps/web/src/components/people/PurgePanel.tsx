import type { PurgePreview } from "@learnthrive/data/repositories";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, FormActions } from "@/components/ui/Field";

/**
 * What a purge will do, shown before it can be confirmed (launch checklist 3.7.3). The lists come from the provider, so the screen and the
 * deletion cannot drift apart. The typed phrase is deliberate friction: a purge is final and cannot be undone by the app.
 */
export function PurgePanel({
  preview,
  action,
  id,
  returnTo,
  confirmation,
  title,
  description,
}: {
  preview: PurgePreview;
  action: (formData: FormData) => Promise<void>;
  id: string;
  returnTo: string;
  confirmation: string;
  title: string;
  description: string;
}) {
  const inputId = `purge-confirm-${id}`;
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
      </CardBody>
    </Card>
  );
}
