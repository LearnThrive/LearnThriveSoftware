import type { Metadata } from "next";
import { formatPence, TUTOR_RATE_MAX_PENCE, TUTOR_RATE_MIN_PENCE } from "@learnthrive/data/tuitionBilling";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { billingContext } from "@/lib/tuitionBilling/runtime";
import { setTutorRateAction } from "@/lib/actions/tuitionBilling";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, FormActions } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";

export const metadata: Metadata = createMetadata({
  title: "Tutor pay",
  description: "What LearnThrive pays each tutor per hour.",
  path: "/dashboard/admin/billing/tutor-rates",
});

/** A tutor's pay is a separate number from what a family pays (B2). Admin only; the tutor's own screens never show money (B17). */
export default async function TutorRatesPage() {
  await requireRole(["ADMIN"]);
  const ctx = billingContext();
  const [tutors, rates] = await Promise.all([ctx.data.tutors.list(), ctx.billing.tutorRates.list()]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        backTo={{ href: "/dashboard/admin/billing", label: "Back to billing" }}
        eyebrow="Tuition billing"
        title="Tutor pay"
        description={`Per hour, between ${formatPence(TUTOR_RATE_MIN_PENCE)} and ${formatPence(TUTOR_RATE_MAX_PENCE)}. Separate from what any family pays.`}
      />
      {tutors.length === 0 ? (
        <EmptyState title="No tutors yet" />
      ) : (
        tutors.map((t) => {
          const mine = rates.filter((r) => r.tutorId === t.id);
          const current = mine.filter((r) => r.effectiveFrom <= today).pop();
          return (
            <Card key={t.id}>
              <CardHeader title={t.name} description={current ? `Now ${formatPence(current.hourlyPence)} an hour, from ${current.effectiveFrom}` : "No pay rate set"} />
              <CardBody>
                {mine.length > 1 && <p>History: {mine.map((r) => `${formatPence(r.hourlyPence)} from ${r.effectiveFrom}`).join("; ")}</p>}
                <form action={setTutorRateAction} className="form">
                  <input type="hidden" name="tutorId" value={t.id} />
                  <input type="hidden" name="back" value="tutor-rates" />
                  <Field label="Pay per hour (£)" htmlFor={`pay-${t.id}`} required>
                    <input id={`pay-${t.id}`} name="hourly" inputMode="decimal" required autoComplete="off" />
                  </Field>
                  <Field label="From" htmlFor={`from-${t.id}`} required>
                    <input id={`from-${t.id}`} name="effectiveFrom" type="date" defaultValue={today} required />
                  </Field>
                  <FormActions><button className="button" type="submit">Set pay</button></FormActions>
                </form>
              </CardBody>
            </Card>
          );
        })
      )}
    </>
  );
}
