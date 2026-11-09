import { VETTING_KINDS, VETTING_LABELS, type VettingLine, type VettingState } from "@learnthrive/data/safeguarding";
import { recordVettingCheckAction, voidVettingCheckAction } from "@/lib/actions/safeguarding";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormActions } from "@/components/ui/Field";

const STATE: Record<VettingState, { label: string; tone: BadgeTone }> = {
  VALID: { label: "Seen", tone: "positive" },
  DUE_SOON: { label: "Runs out soon", tone: "warning" },
  EXPIRED: { label: "Expired", tone: "critical" },
  MISSING: { label: "Not recorded", tone: "muted" },
};

/** The badge for one check. A required check that is missing is as serious as an expired one, and says so in words, not only colour. */
export function VettingBadge({ line }: { line: VettingLine }) {
  if (line.state === "MISSING" && line.required) return <Badge tone="critical">Required, not recorded</Badge>;
  const { label, tone } = STATE[line.state];
  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * A tutor's vetting record on their admin page (docs/SAFEGUARDING_RECORDS.md). Administrators only: the page it sits on is. It records
 * that a check was SEEN, how and when: never a certificate number or a copy. It flags; it does not stop a tutor being given lessons
 * (whether it should is the owners' decision).
 */
export function VettingCard({ tutorId, lines, today }: { tutorId: string; lines: VettingLine[]; today: string }) {
  return (
    <Card>
      <CardHeader
        title="Checks"
        description="What an administrator has seen for this tutor, and when it runs out. Record that a check was seen; never a certificate number."
        action={
          <Dialog trigger="Record a check" title="Record a check" description="Record what you saw, how and when. Do not enter a certificate number.">
            <form action={recordVettingCheckAction} className="form">
              <input type="hidden" name="tutorId" value={tutorId} />
              <Field label="Check" htmlFor="vetting-kind" required>
                <select id="vetting-kind" name="kind" required defaultValue="">
                  <option value="" disabled>Choose</option>
                  {VETTING_KINDS.map((kind) => <option key={kind} value={kind}>{VETTING_LABELS[kind]}</option>)}
                </select>
              </Field>
              <Field label="Date seen" htmlFor="vetting-checked" required>
                <input id="vetting-checked" name="checkedOn" type="date" required max={today} defaultValue={today} />
              </Field>
              <Field label="Runs out on" htmlFor="vetting-expires" hint="Leave empty if it does not run out.">
                <input id="vetting-expires" name="expiresOn" type="date" min={today} />
              </Field>
              <Field label="How it was seen" htmlFor="vetting-how" required hint="For example: Update Service, or certificate seen in person.">
                <input id="vetting-how" name="how" required minLength={2} maxLength={80} autoComplete="off" />
              </Field>
              <Field label="Note" htmlFor="vetting-note">
                <input id="vetting-note" name="note" maxLength={500} autoComplete="off" />
              </Field>
              <FormActions><button className="button" type="submit">Record check</button></FormActions>
            </form>
          </Dialog>
        }
      />
      <CardBody className="card__body--flush">
        <ul className="record-list">
          {lines.map((line) => (
            <li key={line.kind} className="record-list__item">
              <div className="record-list__link">
                <span className="record-list__body">
                  <span className="record-list__title">{VETTING_LABELS[line.kind]}</span>
                  <span className="record-list__meta">
                    {line.check
                      ? `Seen ${line.check.checkedOn} (${line.check.how})${line.check.expiresOn ? `, runs out ${line.check.expiresOn}` : ""}${line.check.note ? `. ${line.check.note}` : ""}`
                      : "Nothing recorded"}
                  </span>
                </span>
                <span className="record-list__aside">
                  <VettingBadge line={line} />
                  {line.check && (
                    <Dialog trigger="Remove" title={`Remove this ${VETTING_LABELS[line.kind].toLowerCase()} record`} description="Use this for a mistake. The record is kept with your reason; it stops counting.">
                      <form action={voidVettingCheckAction} className="form">
                        <input type="hidden" name="tutorId" value={tutorId} />
                        <input type="hidden" name="checkId" value={line.check.id} />
                        <Field label="Reason" htmlFor={`void-${line.check.id}`} required>
                          <input id={`void-${line.check.id}`} name="reason" required minLength={3} maxLength={500} autoComplete="off" />
                        </Field>
                        <FormActions><button className="button" type="submit">Remove record</button></FormActions>
                      </form>
                    </Dialog>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
