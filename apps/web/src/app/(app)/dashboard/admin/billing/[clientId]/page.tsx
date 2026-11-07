import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  contractEndFor, formatPence, isRefundApprover, lessonsNeedingDecision, londonYmd, previewStatement, previousPeriod, PERIOD, type StatementBlocker,
} from "@learnthrive/data/tuitionBilling";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { billingContext } from "@/lib/tuitionBilling/runtime";
import {
  decideChargeAction, decideRefundAction, issueStatementAction, recordPaymentAction, requestRefundAction, setFamilyRateAction, setSiblingEligibleAction, voidPaymentAction,
} from "@/lib/actions/tuitionBilling";
import { formatDateOnly } from "@/lib/format";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FormActions } from "@/components/ui/Field";

export const metadata: Metadata = createMetadata({ title: "Family billing", description: "One family's rates, statements, payments and refunds.", path: "/dashboard/admin/billing" });

const BLOCKERS: Record<StatementBlocker, string> = {
  NO_RATE: "No agreed rate covers a lesson in this month. Set the family rate first.",
  NEEDS_DECISION: "A cancelled or unfinished lesson has not been explained. Decide it below.",
  FEE_UNCONFIRMED: "A repeat late cancellation has no fee yet: the owners have not decided it (Billing rules).",
  EARLIER_PERIOD_NOT_ISSUED: "An earlier month has not been issued yet. Issue months in order.",
  PERIOD_NOT_ENDED: "That month has not finished yet.",
};

/** Admin only. Money about a family is never rendered to a tutor (owner answer B17); every action behind these forms re-checks ADMIN. */
export default async function FamilyBillingPage({ params, searchParams }: { params: Promise<{ clientId: string }>; searchParams: Promise<{ period?: string }> }) {
  const user = await requireRole(["ADMIN"]);
  const { clientId } = await params;
  const ctx = billingContext();
  const client = await ctx.data.clients.get(clientId);
  if (!client) notFound();

  const requested = (await searchParams).period ?? "";
  const today = londonYmd(new Date().toISOString());
  const period = PERIOD.test(requested) ? requested : previousPeriod(today.slice(0, 7));
  const approver = isRefundApprover({ id: user.id, email: user.email }, ctx.approvers);

  const [profile, assignments, rates, undecided, draft, statements, payments, refunds] = await Promise.all([
    ctx.billing.profiles.get(clientId), ctx.data.assignments.forClient(clientId), ctx.billing.familyRates.list(clientId), lessonsNeedingDecision(ctx, clientId),
    previewStatement(ctx, clientId, period), ctx.billing.statements.list(clientId), ctx.billing.payments.list(clientId), ctx.billing.refunds.list(clientId),
  ]);
  const issued = statements.find((s) => s.period === period) ?? null;

  return (
    <>
      <PageHeader
        backTo={{ href: "/dashboard/admin/billing", label: "Back to billing" }}
        eyebrow="Tuition billing"
        title={client.name}
        description="Rates, statements, payments and refunds for this family. Tutors never see any of it."
      />

      <Card>
        <CardHeader title="Sibling discount" description="10% on delivered lessons. Who counts as a sibling is still being decided, so set it by hand." />
        <CardBody>
          <form action={setSiblingEligibleAction} className="form">
            <input type="hidden" name="clientId" value={clientId} />
            <Field label="Applies to this family" htmlFor="sib">
              <select id="sib" name="eligible" defaultValue={String(profile.siblingDiscountEligible)}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </Field>
            <FormActions><button className="button" type="submit">Save</button></FormActions>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Family rate" description="Fixed for the contract year: it cannot be changed inside it." />
        <CardBody>
          {assignments.length === 0 && <EmptyState title="No tuition assignments" description="A rate belongs to an assignment." />}
          {assignments.map((a) => {
            const mine = rates.filter((r) => r.assignmentId === a.id);
            return (
              <div key={a.id} className="stack">
                <h3>{a.title}</h3>
                {mine.length === 0 ? <p>No rate set.</p> : <ul>{mine.map((r) => <li key={r.id}>{formatPence(r.hourlyPence)} an hour, {r.contractStart} to {r.contractEnd}</li>)}</ul>}
                <form action={setFamilyRateAction} className="form">
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="assignmentId" value={a.id} />
                  <Field label="Rate per hour (£)" htmlFor={`rate-${a.id}`} required><input id={`rate-${a.id}`} name="hourly" inputMode="decimal" required autoComplete="off" /></Field>
                  <Field label="Contract starts" htmlFor={`start-${a.id}`} required hint={`Runs a year, to ${contractEndFor(today)} if it starts today.`}>
                    <input id={`start-${a.id}`} name="contractStart" type="date" defaultValue={today} required />
                  </Field>
                  <FormActions><button className="button" type="submit">Set rate</button></FormActions>
                </form>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Lessons to decide" description="Cancelled or unfinished lessons nobody has explained. Each must be decided before its month can be issued." />
        <CardBody>
          {undecided.length === 0 ? <p>Nothing to decide.</p> : undecided.map((l) => (
            <form key={l.lessonId} action={decideChargeAction} className="form">
              <input type="hidden" name="clientId" value={clientId} />
              <input type="hidden" name="lessonId" value={l.lessonId} />
              <p><strong>{l.title}</strong> · {l.studentName} · {formatDateOnly(l.startAt)} · {l.status.toLowerCase()}</p>
              <Field label="What happened" htmlFor={`d-${l.lessonId}`} required>
                <select id={`d-${l.lessonId}`} name="choice" required defaultValue="">
                  <option value="" disabled>Choose</option>
                  <option value="FAMILY">The family cancelled</option>
                  <option value="TUTOR">The tutor cancelled</option>
                  <option value="LEARNTHRIVE">LearnThrive cancelled</option>
                  <option value="WAIVE">Do not charge (say why)</option>
                </select>
              </Field>
              <Field label="Note" htmlFor={`n-${l.lessonId}`} hint="Required when you choose not to charge.">
                <input id={`n-${l.lessonId}`} name="note" maxLength={500} autoComplete="off" />
              </Field>
              <FormActions><button className="button" type="submit">Save decision</button></FormActions>
            </form>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Statement for ${period}`} description="Monthly, in arrears. Once issued it is frozen." action={
          <form method="get" className="form">
            <input aria-label="Month" name="period" type="month" defaultValue={period} />
            <button className="button button--secondary" type="submit">Show</button>
          </form>
        } />
        <CardBody>
          {issued ? (
            <p><Badge tone="positive">Issued</Badge> {issued.invoiceNumber} on {issued.issuedOn}. Total {formatPence(issued.totalChargesPence)}, closing balance {formatPence(issued.closingBalancePence)}.</p>
          ) : !draft ? <p>No such family.</p> : (
            <>
              {draft.blockers.length > 0 && <ul>{draft.blockers.map((b) => <li key={b}><Badge tone="warning">Cannot issue yet</Badge> {BLOCKERS[b]}</li>)}</ul>}
              {draft.lines.length === 0 ? <p>No chargeable lessons this month.</p> : (
                <ul>
                  {draft.lines.map((l) => (
                    <li key={`${l.lessonId}-${l.studentId}`}>
                      {l.date} · {l.studentName} · {l.title} · {l.description} · <strong>{l.flag ? "to be confirmed" : formatPence(l.amountPence)}</strong>
                    </li>
                  ))}
                </ul>
              )}
              <p>Lessons {formatPence(draft.lessonChargesPence)} · missed {formatPence(draft.missedLessonChargesPence)}{draft.siblingDiscountApplied ? ` · sibling discount -${formatPence(draft.siblingDiscountPence)}` : ""} · total <strong>{formatPence(draft.totalChargesPence)}</strong></p>
              <p>Opening {formatPence(draft.openingBalancePence)} · payments received {formatPence(draft.paymentsReceivedPence)} · closing <strong>{formatPence(draft.closingBalancePence)}</strong></p>
              <form action={issueStatementAction} className="form">
                <input type="hidden" name="clientId" value={clientId} />
                <input type="hidden" name="period" value={period} />
                <FormActions><button className="button" type="submit" disabled={draft.blockers.length > 0}>Issue statement</button></FormActions>
              </form>
            </>
          )}
          {statements.length > 0 && <p>Issued: {statements.map((s) => `${s.period} (${s.invoiceNumber})`).join(", ")}</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Payments" description="Recorded by hand. A mistake is voided with a reason, never edited." />
        <CardBody>
          {payments.length === 0 ? <p>No payments recorded.</p> : (
            <ul>
              {payments.map((p) => (
                <li key={p.id}>
                  {p.receivedOn} · <strong>{formatPence(p.amountPence)}</strong> · {p.method} · {p.note}
                  <form action={voidPaymentAction} className="form">
                    <input type="hidden" name="clientId" value={clientId} />
                    <input type="hidden" name="paymentId" value={p.id} />
                    <Field label="Reason for voiding" htmlFor={`v-${p.id}`} required><input id={`v-${p.id}`} name="reason" required minLength={3} maxLength={500} autoComplete="off" /></Field>
                    <FormActions><button className="button button--secondary" type="submit">Void</button></FormActions>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={recordPaymentAction} className="form">
            <input type="hidden" name="clientId" value={clientId} />
            <Field label="Amount (£)" htmlFor="p-amount" required><input id="p-amount" name="amount" inputMode="decimal" required autoComplete="off" /></Field>
            <Field label="Date received" htmlFor="p-date" required><input id="p-date" name="receivedOn" type="date" defaultValue={today} required /></Field>
            <Field label="Method" htmlFor="p-method" required hint="For example bank transfer or cash."><input id="p-method" name="method" required maxLength={40} autoComplete="off" /></Field>
            <Field label="Note" htmlFor="p-note" required hint="Who paid and for what."><input id="p-note" name="note" required minLength={3} maxLength={500} autoComplete="off" /></Field>
            <FormActions><button className="button" type="submit">Record payment</button></FormActions>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Refunds" description={approver ? "You are a named refund approver." : "Any admin can request a refund. Only the named approvers can approve or reject it."} />
        <CardBody>
          {refunds.length === 0 ? <p>No refund requests.</p> : (
            <ul>
              {refunds.map((r) => (
                <li key={r.id}>
                  {formatPence(r.amountPence)} · {r.reason}{r.statutory ? " · statutory right" : ""} · <Badge tone={r.status === "APPROVED" ? "positive" : r.status === "REJECTED" ? "muted" : "warning"}>{r.status.toLowerCase().replaceAll("_", " ")}</Badge>
                  {approver && (r.status === "REQUESTED" || r.status === "AWAITING_SECOND_APPROVAL") && (
                    <form action={decideRefundAction} className="form">
                      <input type="hidden" name="clientId" value={clientId} />
                      <input type="hidden" name="refundId" value={r.id} />
                      <Field label="Note" htmlFor={`rn-${r.id}`} hint="Required when rejecting."><input id={`rn-${r.id}`} name="note" maxLength={1000} autoComplete="off" /></Field>
                      <FormActions>
                        <button className="button" type="submit" name="decision" value="approve">Approve</button>
                        <button className="button button--secondary" type="submit" name="decision" value="reject">Reject</button>
                      </FormActions>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form action={requestRefundAction} className="form">
            <input type="hidden" name="clientId" value={clientId} />
            <Field label="Amount (£)" htmlFor="r-amount" required><input id="r-amount" name="amount" inputMode="decimal" required autoComplete="off" /></Field>
            <Field label="Reason" htmlFor="r-reason" required><input id="r-reason" name="reason" required minLength={3} maxLength={1000} autoComplete="off" /></Field>
            <Field label="A statutory right" htmlFor="r-stat" hint="For example a refund the family is legally owed.">
              <select id="r-stat" name="statutory" defaultValue="false"><option value="false">No</option><option value="true">Yes</option></select>
            </Field>
            <FormActions><button className="button" type="submit">Request refund</button></FormActions>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
