import type { Metadata } from "next";
import { Video } from "lucide-react";
import { requireRole } from "@/lib/auth/guard";
import { holds } from "@/lib/auth/scope";
import { createMetadata } from "@/lib/metadata";
import { formatLessonDayTime } from "@/lib/format";
import { cancelMeetingAction, createMeetingAction, joinMeetingAction } from "@/lib/actions/meetings";
import { meetingOpenFor } from "@/lib/meetings/rules";
import { getMeetings, staffDirectory } from "@/lib/meetings/runtime";
import { meetingRoleFor } from "@learnthrive/data/meetings";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FormActions } from "@/components/ui/Field";

export const metadata: Metadata = createMetadata({
  title: "Meetings",
  description: "Meetings between administrators and tutors.",
  path: "/dashboard/meetings",
});

const LENGTHS = [15, 30, 45, 60, 90, 120, 180] as const;

/**
 * Staff meetings (docs/STAFF_MEETINGS.md): administrators and tutors meeting in the same video room a lesson uses. Everyone sees the meetings they host
 * or are invited to; only an administrator can set one up, so a tutor's page is the list and a Join button. No parent or learner is ever invited.
 */
export default async function MeetingsPage() {
  const user = await requireRole(["ADMIN", "TUTOR", "JUNIOR_TUTOR"]);
  const isAdmin = holds(user, "ADMIN");
  const now = new Date();
  // A meeting stays listed (and joinable) for half an hour after it should have ended, as a lesson's room does.
  const meetings = await getMeetings().forPerson(user.id, new Date(now.getTime() - 30 * 60_000).toISOString());
  const people = isAdmin ? (await staffDirectory()).filter((p) => p.id !== user.id) : [];

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Meetings"
        description={isAdmin ? "Meet with your administrators and tutors on video. Schedule one for later or start one now." : "Meetings you have been invited to."}
      />

      <div className="stack">
        {isAdmin && (
          <Card>
            <CardHeader title="New meeting" description="Only people you invite can join, and only once you let them in from the waiting room." />
            <CardBody>
              <form action={createMeetingAction} className="form">
                <Field label="Title" htmlFor="meeting-title" hint="Leave empty for a quick meeting you start now.">
                  <input id="meeting-title" name="title" maxLength={100} autoComplete="off" />
                </Field>
                <div className="field-row">
                  <Field label="Date" htmlFor="meeting-date" hint="Leave the date and time empty to start now.">
                    <input id="meeting-date" name="date" type="date" />
                  </Field>
                  <Field label="Time" htmlFor="meeting-time">
                    <input id="meeting-time" name="time" type="time" />
                  </Field>
                  <Field label="Length" htmlFor="meeting-length" required>
                    <select id="meeting-length" name="durationMinutes" defaultValue="60">
                      {LENGTHS.map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : m === 60 ? "1 hour" : m % 60 === 0 ? `${m / 60} hours` : `${Math.floor(m / 60)} h ${m % 60} min`}</option>)}
                    </select>
                  </Field>
                </div>
                <fieldset className="fieldset">
                  <legend className="fieldset__legend">Who to invite</legend>
                  {people.length === 0 ? (
                    <p className="muted">There is nobody else with an administrator or tutor login yet. Create a login for a tutor under People, Tutors.</p>
                  ) : (
                    <div className="meeting-people">
                      {people.map((p) => (
                        <label key={p.id} className="checkbox-row">
                          <input type="checkbox" name="invitee" value={p.id} />
                          <span>{p.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
                <FormActions>
                  <button type="submit" name="intent" value="schedule" className="btn btn--primary">Schedule meeting</button>
                  <button type="submit" name="intent" value="now" className="btn btn--secondary">Start now</button>
                </FormActions>
              </form>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Upcoming" />
          <CardBody className={meetings.length === 0 ? undefined : "card__body--flush"}>
            {meetings.length === 0 ? (
              <EmptyState title="No meetings" description={isAdmin ? "Schedule one above to get everyone in the same room." : "When an administrator invites you to a meeting it appears here."} />
            ) : (
              <ul className="meeting-list">
                {meetings.map((m) => {
                  const role = meetingRoleFor(m, user.id);
                  const open = role !== null && meetingOpenFor(m, role, now);
                  return (
                    <li key={m.id} className="meeting-row">
                      <div className="meeting-row__main">
                        <p className="meeting-row__title"><Video size={16} aria-hidden="true" /> {m.title} {role === "HOST" && <Badge tone="muted">You host</Badge>}</p>
                        <p className="meeting-row__meta">{formatLessonDayTime(m.startsAt)} · {m.durationMinutes} minutes · hosted by {m.hostName}</p>
                        <p className="meeting-row__meta">With {m.invitees.map((p) => p.name).join(", ")}</p>
                      </div>
                      <div className="meeting-row__actions">
                        {open ? (
                          <form action={joinMeetingAction}>
                            <input type="hidden" name="meetingId" value={m.id} />
                            <button type="submit" className="btn btn--primary">Join</button>
                          </form>
                        ) : (
                          <span className="muted">Opens {role === "HOST" ? 30 : 10} minutes before</span>
                        )}
                        {(role === "HOST" || isAdmin) && (
                          <form action={cancelMeetingAction}>
                            <input type="hidden" name="meetingId" value={m.id} />
                            <button type="submit" className="btn btn--secondary">Cancel</button>
                          </form>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
