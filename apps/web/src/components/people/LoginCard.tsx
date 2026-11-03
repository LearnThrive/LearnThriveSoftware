import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, FormActions } from "@/components/ui/Field";
import { loginDetails } from "@/lib/account/loginDetails";
import { changeLinkedEmailAction, issueTemporaryPasswordAction, setLoginDisabledAction } from "@/lib/actions/accounts";
import { IssuePasswordForm } from "./LoginForms";

/**
 * A person's login, on their profile page: what it is, and the administrator's tools for it. `noLogin` is what to show for someone who has
 * none yet. The page has already checked the viewer is an administrator, and each action checks again.
 */
export async function LoginCard({ profileId, returnTo, noLogin, childLinked = false }: { profileId?: string; returnTo: string; noLogin: ReactNode; childLinked?: boolean }) {
  const account = await loginDetails(profileId);
  if (!account?.username) {
    return (
      <Card>
        <CardHeader title="Login" />
        <CardBody>{noLogin}</CardBody>
      </Card>
    );
  }
  const id = account.profileId;
  return (
    <Card>
      <CardHeader title="Login" />
      <CardBody>
        <dl className="detail-list" style={{ marginTop: 0 }}>
          <div><dt>Username</dt><dd>{account.username}</dd></div>
          <div><dt>Linked email</dt><dd>{account.linkedEmail ?? "None"}</dd></div>
          <div><dt>Status</dt><dd>{account.loginDisabled ? "Disabled" : account.mustChangePassword ? "Waiting for them to choose a password" : "Active"}</dd></div>
        </dl>
        {childLinked ? (
          <p className="muted">A child&apos;s linked email is their parent&apos;s. Change it on the parent&apos;s page: it follows from there.</p>
        ) : (
          <form action={changeLinkedEmailAction} className="form">
            <input type="hidden" name="profileId" value={id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Field label="Change linked email" htmlFor={`linked-email-${id}`} required hint="Where their password resets, notices and invoices go.">
              <input id={`linked-email-${id}`} name="email" type="email" required autoComplete="off" />
            </Field>
            <FormActions>
              <button type="submit" className="btn btn--secondary">Save email</button>
            </FormActions>
          </form>
        )}
        <IssuePasswordForm action={issueTemporaryPasswordAction} profileId={id} />
        <form action={setLoginDisabledAction} className="form">
          <input type="hidden" name="profileId" value={id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="disabled" value={account.loginDisabled ? "false" : "true"} />
          <FormActions>
            <button type="submit" className="btn btn--secondary">{account.loginDisabled ? "Enable login" : "Disable login"}</button>
          </FormActions>
        </form>
      </CardBody>
    </Card>
  );
}
