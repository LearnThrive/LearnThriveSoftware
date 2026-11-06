import type { ReactNode } from "react";
import type { LinkStatus } from "@learnthrive/data/library";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, FormActions } from "@/components/ui/Field";
import { loginDetails } from "@/lib/account/loginDetails";
import { changeLinkedEmailAction, issueTemporaryPasswordAction, setLearnerLoginAction, setLoginDisabledAction } from "@/lib/actions/accounts";
import { IssuePasswordForm } from "./LoginForms";

/**
 * A person's login, on their profile page: what it is, and the administrator's tools for it. `noLogin` is what to show for someone who has
 * none yet. The page has already checked the viewer is an administrator, and each action checks again.
 *
 * `learner` is set for a child's login: its access (the switch the parent has too) is shown and can be suspended, restored or removed.
 */
export async function LoginCard({ profileId, returnTo, noLogin, childLinked = false, learner }: {
  profileId?: string;
  returnTo: string;
  noLogin: ReactNode;
  childLinked?: boolean;
  learner?: { studentId: string; status: LinkStatus };
}) {
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
          {learner && <div><dt>Access</dt><dd>{learner.status === "suspended" ? "Suspended: they can sign in, but nothing opens" : "Open"}</dd></div>}
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
        {learner && <LearnerAccess studentId={learner.studentId} status={learner.status} returnTo={returnTo} />}
      </CardBody>
    </Card>
  );
}

/**
 * A child's access (launch checklist 3.5). Suspending is the same switch the parent has on their learners page, so the parent sees it and can
 * restore it; to stop a login in a way only staff can undo, disable it above. Removing is final and frees the student for a new login.
 */
function LearnerAccess({ studentId, status, returnTo }: { studentId: string; status: LinkStatus; returnTo: string }) {
  const confirmId = `remove-login-${studentId}`;
  return (
    <>
      <form action={setLearnerLoginAction} className="form">
        <input type="hidden" name="studentId" value={studentId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="change" value={status === "suspended" ? "restore" : "suspend"} />
        <p className="muted">
          {status === "suspended"
            ? "Restoring opens their lessons and progress again. Their parent can also restore it."
            : "Suspending closes their lessons and progress at once. Their parent sees it, and can restore it."}
        </p>
        <FormActions>
          <button type="submit" className="btn btn--secondary">{status === "suspended" ? "Restore login" : "Suspend login"}</button>
        </FormActions>
      </form>
      <form action={setLearnerLoginAction} className="form">
        <input type="hidden" name="studentId" value={studentId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="change" value="remove" />
        <label className="checkbox-field" htmlFor={confirmId}>
          <input id={confirmId} type="checkbox" name="confirm" value="yes" required />
          <span>
            <span className="checkbox-field__label">Remove this login for good</span>
            <span className="checkbox-field__hint">The username stops working and cannot be brought back. You can then create a new login for this student.</span>
          </span>
        </label>
        <FormActions>
          <button type="submit" className="btn btn--secondary">Remove login</button>
        </FormActions>
      </form>
    </>
  );
}
