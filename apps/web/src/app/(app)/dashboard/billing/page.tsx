import type { Metadata } from "next";
import { ReceiptPoundSterling } from "lucide-react";
import { formatPence, parentAccount } from "@learnthrive/data/tuitionBilling";
import { requireRole } from "@/lib/auth/guard";
import { recordFor } from "@/lib/auth/scope";
import { bankTransferFor } from "@/lib/bank/handler";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@/lib/data/provider";
import { billingContext } from "@/lib/tuitionBilling/runtime";
import { siteConfig } from "@/lib/site";
import { formatDateOnly } from "@/lib/format";
import { BankTransferPanel } from "@/components/billing/BankTransferPanel";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = createMetadata({
  title: "Fees",
  description: "Your statements, what you have paid and how to pay.",
  path: "/dashboard/billing",
});

const monthName = (period: string) => new Date(`${period}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * A parent's own fees (docs/TUITION_BILLING.md). For a PARENT only: `requireRole(["CLIENT"])`, and the family is the one the signed-in
 * parent owns (`user.profileId`), never one named in the address. What is shown is `parentAccount`'s projection, so it cannot carry another
 * family's data, a child's id, or an administrator's internal note. A tutor or a learner is refused before anything is read. Payment is by
 * bank transfer for now: the page says how, in words an administrator writes on the billing rules page.
 */
export default async function FeesPage() {
  const user = await requireRole(["CLIENT"]);
  const ctx = billingContext();
  // The family the PARENT role stands on (a person with several roles has a record for each; lib/auth/scope.ts), never one named in the address.
  const familyId = recordFor(user, "CLIENT");
  const family = familyId ? await getDataProvider().clients.get(familyId) : null;
  const account = family ? await parentAccount(ctx, family.id) : null;
  // The company's bank details and THIS family's payment reference, through the same function as the endpoint (lib/bank/handler.ts). Nothing
  // is shown where the details are not set up on this server: the older "how to pay" text below stands in.
  const transfer = family ? await bankTransferFor(user, null, getDataProvider().clients) : null;
  const bank = transfer?.status === 200 && transfer.body.reference ? { ...transfer.body.bank, reference: transfer.body.reference } : null;

  return (
    <>
      <PageHeader
        eyebrow="Your family"
        title="Fees"
        description="You are invoiced each month for the lessons your children have already had. Pay by bank transfer, using the details below."
      />

      {!account ? (
        <Card><CardBody><EmptyState icon={<ReceiptPoundSterling size={20} />} title="No fees to show yet" description={`If you think this is wrong, email ${siteConfig.email}.`} /></CardBody></Card>
      ) : (
        <>
          <Card>
            <CardHeader title={account.balancePence > 0 ? "What you owe" : account.balancePence < 0 ? "You are in credit" : "You are up to date"} />
            <CardBody>
              <p style={{ fontSize: "var(--text-large, 1.5rem)", margin: 0 }}><strong>{formatPence(Math.abs(account.balancePence))}</strong></p>
              {account.overdue && (
                <p><Badge tone="critical">Overdue</Badge> A payment has been outstanding for more than a month. Please pay it, or get in touch on {siteConfig.email} if there is a problem. Lessons may be paused until it is sorted out.</p>
              )}
            </CardBody>
          </Card>

          {bank && (
            <Card>
              <CardBody><BankTransferPanel details={bank} /></CardBody>
            </Card>
          )}

          {/* With the bank panel above, this card is only for what an administrator has added; without it, it is the fallback. */}
          {(!bank || account.paymentInstructions) && (
          <Card>
            <CardHeader title={bank ? "More about paying" : "How to pay"} />
            <CardBody>
              {account.paymentInstructions ? (
                <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{account.paymentInstructions}</p>
              ) : (
                <p style={{ margin: 0 }}>Email {siteConfig.email} and we will send you the bank details to pay into.</p>
              )}
              {!bank && account.statements[0] && <p>Quote the invoice number as your payment reference: <strong>{account.statements[0].invoiceNumber}</strong>.</p>}
            </CardBody>
          </Card>
          )}

          <Card>
            <CardHeader title="Statements" description="Newest first. Each lists the lessons it covers." />
            <CardBody>
              {account.statements.length === 0 ? (
                <EmptyState icon={<ReceiptPoundSterling size={20} />} title="No statement yet" description="Your first statement is sent after the end of the first month of lessons." />
              ) : (
                account.statements.map((s) => (
                  <details key={s.invoiceNumber} className="stack">
                    <summary><strong>{monthName(s.period)}</strong> · {s.invoiceNumber} · issued {formatDateOnly(`${s.issuedOn}T12:00:00Z`)} · total {formatPence(s.totalChargesPence)} · balance {formatPence(s.closingBalancePence)}</summary>
                    {s.lines.length === 0 ? <p>No lessons were charged this month.</p> : (
                      <ul>
                        {s.lines.map((l, i) => (
                          <li key={`${l.date}-${i}`}>{l.date} · {l.childName} · {l.title} · {l.description} · <strong>{formatPence(l.amountPence)}</strong></li>
                        ))}
                      </ul>
                    )}
                    <p>
                      Lessons {formatPence(s.lessonChargesPence)}
                      {s.missedLessonChargesPence > 0 ? ` · missed lessons ${formatPence(s.missedLessonChargesPence)}` : ""}
                      {s.siblingDiscountApplied ? ` · sibling discount -${formatPence(s.siblingDiscountPence)} (${s.siblingDiscountPercent}%)` : ""}
                      {` · total ${formatPence(s.totalChargesPence)}`}
                    </p>
                    <p>Balance brought forward {formatPence(s.openingBalancePence)} · payments received {formatPence(s.paymentsReceivedPence)} · balance now {formatPence(s.closingBalancePence)}</p>
                    <p className="muted">{s.company.name}, company number {s.company.companyNumber}, {s.company.registeredOffice}.</p>
                  </details>
                ))
              )}
            </CardBody>
          </Card>

          {account.payments.length > 0 && (
            <Card>
              <CardHeader title="Payments we have received" />
              <CardBody>
                <ul>{account.payments.map((p, i) => <li key={`${p.receivedOn}-${i}`}>{p.receivedOn} · <strong>{formatPence(p.amountPence)}</strong> · {p.method}</li>)}</ul>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </>
  );
}
