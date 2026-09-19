import type { Metadata } from "next";
import { CalendarClock, Plus } from "lucide-react";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { addAvailabilityAction, removeAvailabilityAction } from "@/lib/actions/availability";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormActions } from "@/components/ui/Field";

export const metadata: Metadata = createMetadata({
  title: "My availability",
  description: "The hours you're available to teach.",
  path: "/dashboard/tutor/availability",
});

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function TutorAvailabilityPage() {
  const user = await requireRole(["TUTOR"]);
  if (!user.profileId) {
    return (
      <>
        <PageHeader eyebrow="You" title="My availability" />
        <Card>
          <EmptyState
            title="Your account isn't linked to a tutor profile yet"
            description="Ask an admin to connect your login to your tutor record, then your availability will appear here."
          />
        </Card>
      </>
    );
  }

  const data = getDataProvider();
  const blocks = await data.availability.forTutor(user.profileId);
  const sorted = [...blocks].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));

  return (
    <>
      <PageHeader
        eyebrow="You"
        title="My availability"
        description="The recurring hours you can teach. Admins see this when scheduling — it doesn't book anything on its own."
        actions={
          <Dialog
            trigger={<><Plus size={16} aria-hidden="true" />Add hours</>}
            title="Add availability"
            description="A recurring weekly window."
          >
            <form action={addAvailabilityAction} className="form">
              <Field label="Day of week" htmlFor="availability-weekday" required>
                <select id="availability-weekday" name="weekday" required defaultValue="">
                  <option value="" disabled>Choose a day</option>
                  {WEEKDAY_NAMES.map((name, index) => <option key={name} value={index}>{name}</option>)}
                </select>
              </Field>
              <div className="grid-2">
                <Field label="From" htmlFor="availability-start" required>
                  <input id="availability-start" name="startTime" type="time" required />
                </Field>
                <Field label="Until" htmlFor="availability-end" required>
                  <input id="availability-end" name="endTime" type="time" required />
                </Field>
              </div>
              <Field label="Type" htmlFor="availability-type" hint="Mark a break inside an otherwise available day as unavailable.">
                <select id="availability-type" name="type" defaultValue="AVAILABLE">
                  <option value="AVAILABLE">Available</option>
                  <option value="UNAVAILABLE">Unavailable</option>
                </select>
              </Field>
              <FormActions>
                <button type="submit" className="btn btn--primary">Add block</button>
              </FormActions>
            </form>
          </Dialog>
        }
      />

      <Card className={sorted.length === 0 ? "card--empty" : ""}>
        {sorted.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={22} />}
            title="No availability set"
            description="Add the hours you can teach so admins know when to schedule your lessons."
          />
        ) : (
          <ul className="availability-list">
            {sorted.map((block) => (
              <li className="availability-row" key={block.id}>
                <span className="availability-row__day">{WEEKDAY_NAMES[block.weekday]}</span>
                <span className="availability-row__time">{block.startTime} – {block.endTime}</span>
                <Badge tone={block.type === "AVAILABLE" ? "positive" : "muted"}>
                  {block.type === "AVAILABLE" ? "Available" : "Unavailable"}
                </Badge>
                <form action={removeAvailabilityAction} className="availability-row__action">
                  <input type="hidden" name="blockId" value={block.id} />
                  <button type="submit" className="btn btn--ghost btn--sm">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
