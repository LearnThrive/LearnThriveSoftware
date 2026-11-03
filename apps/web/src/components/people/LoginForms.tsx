"use client";

import { startTransition, useActionState, type FormEvent, type ReactNode } from "react";
import { Field, FormActions } from "@/components/ui/Field";
import type { LoginFormState } from "@/lib/actions/accounts";

type LoginAction = (previous: LoginFormState, formData: FormData) => Promise<LoginFormState>;

const initial: LoginFormState = {};

/** Shown once, to the administrator who asked. It is in no URL and is gone when they leave this page: if it is lost, issue another. */
function TemporaryPassword({ username, password }: { username: string; password: string }) {
  return (
    <div role="status" className="form">
      <p>
        <strong>Give these to the person by a secure route.</strong> The password is shown only here, once. They must choose their own the first time they sign in.
      </p>
      <dl className="detail-list" style={{ marginTop: 0 }}>
        <div><dt>Username</dt><dd>{username}</dd></div>
        <div><dt>Temporary password</dt><dd><code data-testid="temporary-password">{password}</code></dd></div>
      </dl>
    </div>
  );
}

/** React empties a form when its `action` finishes, which would lose everything typed whenever a username is refused: submit by hand instead. */
function keepingFields(dispatch: (formData: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };
}

/** Makes a login. The fields that differ by person are `children`; the record it belongs to travels in `hidden`. */
export function CreateLoginForm({ action, hidden, children, submitLabel, intro }: { action: LoginAction; hidden?: Record<string, string>; children: ReactNode; submitLabel: string; intro?: string }) {
  const [state, formAction, pending] = useActionState(action, initial);
  if (state.status === "created" && state.username && state.temporaryPassword) return <TemporaryPassword username={state.username} password={state.temporaryPassword} />;
  return (
    <form action={formAction} onSubmit={keepingFields(formAction)} className="form">
      {intro ? <p className="muted">{intro}</p> : null}
      {Object.entries(hidden ?? {}).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {children}
      {state.status === "refused" ? <p className="field__error" role="alert">{state.message}</p> : null}
      <FormActions>
        <button type="submit" className="btn btn--primary" disabled={pending}>{pending ? "Working…" : submitLabel}</button>
      </FormActions>
    </form>
  );
}

/** The fallback when a person cannot use the emailed link. */
export function IssuePasswordForm({ action, profileId }: { action: LoginAction; profileId: string }) {
  const [state, formAction, pending] = useActionState(action, initial);
  if (state.status === "created" && state.username && state.temporaryPassword) return <TemporaryPassword username={state.username} password={state.temporaryPassword} />;
  return (
    <form action={formAction} className="form">
      <input type="hidden" name="profileId" value={profileId} />
      <p className="muted">Only after confirming who you are speaking to: for a child, a call to their parent. Their current password stops working.</p>
      {state.status === "refused" ? <p className="field__error" role="alert">{state.message}</p> : null}
      <FormActions>
        <button type="submit" className="btn btn--secondary" disabled={pending}>{pending ? "Working…" : "Issue a temporary password"}</button>
      </FormActions>
    </form>
  );
}

export function UsernameField({ id, required = true, hint }: { id: string; required?: boolean; hint?: string }) {
  return (
    <Field label="Username" htmlFor={id} required={required} hint={hint ?? "What they will sign in with. Lower-case letters and digits, 3 to 30 characters."}>
      <input id={id} name="username" required={required} autoComplete="off" autoCapitalize="none" spellCheck={false} />
    </Field>
  );
}
