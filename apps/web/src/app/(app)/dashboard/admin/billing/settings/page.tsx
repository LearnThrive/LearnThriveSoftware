import type { Metadata } from "next";
import { formatPence } from "@learnthrive/data/tuitionBilling";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { billingContext } from "@/lib/tuitionBilling/runtime";
import { updateBillingSettingsAction } from "@/lib/actions/tuitionBilling";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, FormActions } from "@/components/ui/Field";

export const metadata: Metadata = createMetadata({
  title: "Billing rules",
  description: "The tuition billing rules the owners have decided, and the ones still open.",
  path: "/dashboard/admin/billing/settings",
});

const pounds = (pence: number | null) => (pence === null ? "" : (pence / 100).toFixed(2));

export default async function BillingSettingsPage() {
  await requireRole(["ADMIN"]);
  const s = await billingContext().billing.settings.get();
  return (
    <>
      <PageHeader
        backTo={{ href: "/dashboard/admin/billing", label: "Back to billing" }}
        eyebrow="Tuition billing"
        title="Billing rules"
        description="Decided rules are fixed here. Open rules stay blank until the owners decide them; while blank, a statement flags the line instead of guessing."
      />
      <Card>
        <CardHeader title="Decided" />
        <CardBody>
          <ul className="stack">
            <li>A lesson cancelled with less than {s.lateCancelNoticeHours} hours&apos; notice is charged, except a child&apos;s first one (waived). Later ones are charged{s.repeatLateCancelFeePence === null ? " at the lesson price" : ""}.</li>
            <li>A tutor waits 15 minutes from the scheduled start before marking a student absent. A child&apos;s first no-show is waived; later ones are charged.</li>
            <li>Families commit for three months to start with, then give a month&apos;s notice. There is no fixed contract year, so a rate applies until a newer one replaces it.</li>
            <li>Lessons are paused once a family is more than a month overdue, until the payment is sorted out. A person pauses them, with a reason, from the family&apos;s billing page.</li>
            <li>Sibling discount: {s.siblingDiscountPercent}% on delivered lessons, for families marked eligible.</li>
            <li>Statements are monthly, in arrears. There are no late fees. Parents pay by bank transfer for now (see the instructions below).</li>
            <li>Only the named refund approver can approve a refund.</li>
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Settings" description="Leave a number box empty for “not decided yet”." />
        <CardBody>
          <form action={updateBillingSettingsAction} className="form">
            <Field label="How parents pay" htmlFor="b-pay" hint="Shown to parents on their Fees page, beside each statement. Say who to pay, the account details and that they should quote the invoice number as the reference. Set it before the first statement is issued.">
              <textarea id="b-pay" name="paymentInstructions" rows={5} maxLength={1000} defaultValue={s.paymentInstructions} />
            </Field>
            <Field label="Fixed fee for a repeat late cancellation (£)" htmlFor="b-repeat" hint={`Now: ${s.repeatLateCancelFeePence === null ? "none set, so a repeat is charged at the lesson price" : formatPence(s.repeatLateCancelFeePence)}.`}>
              <input id="b-repeat" name="repeatLateCancelFee" inputMode="decimal" defaultValue={pounds(s.repeatLateCancelFeePence)} autoComplete="off" />
            </Field>
            <Field label="Months until a child's waived-first allowance resets" htmlFor="b-reset" hint={`Now: ${s.allowanceResetMonths === null ? "never resets" : `${s.allowanceResetMonths} months`}.`}>
              <input id="b-reset" name="allowanceResetMonths" inputMode="numeric" defaultValue={s.allowanceResetMonths ?? ""} autoComplete="off" />
            </Field>
            <Field label="Refund amount that needs a second approver (£)" htmlFor="b-second" hint={`Now: ${s.refundSecondApprovalPence === null ? "one approver is enough" : formatPence(s.refundSecondApprovalPence)}.`}>
              <input id="b-second" name="refundSecondApproval" inputMode="decimal" defaultValue={pounds(s.refundSecondApprovalPence)} autoComplete="off" />
            </Field>
            <FormActions><button className="btn btn--primary" type="submit">Save</button></FormActions>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
