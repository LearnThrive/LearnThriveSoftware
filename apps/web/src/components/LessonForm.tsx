"use client";

import { useActionState, useState } from "react";
import { createLessonAction, type CreateLessonState } from "@/lib/actions/lessons";

interface AssignmentOption {
  id: string;
  title: string;
  subject: string;
  defaultDurationMinutes?: number;
  defaultLocationType?: "ONLINE" | "IN_PERSON";
}

const initialState: CreateLessonState = {};

export function LessonForm({ assignments }: { assignments: AssignmentOption[] }) {
  const [state, formAction, pending] = useActionState(createLessonAction, initialState);
  const [frequency, setFrequency] = useState("NONE");
  const [locationType, setLocationType] = useState<"ONLINE" | "IN_PERSON">("ONLINE");

  // useActionState re-renders this component with new `state`, but does NOT itself repopulate
  // the <form>'s uncontrolled fields (their `defaultValue` only applies on the *first* mount of
  // each DOM node, not on later prop changes) — found the hard way: the conflict-confirmation
  // step silently wiped every required field, so "Schedule anyway" resubmitted an empty form and
  // got stuck re-triggering the same native browser validation instead of actually proceeding.
  // Forcing a fresh `key` whenever the server echoes back `state.values` remounts the form's
  // fields with that echoed data as their new (real) initial value. Adjusting state during
  // render (not in an effect) is the pattern React itself recommends for "derive state from a
  // prop/state change" — see https://react.dev/learn/you-might-not-need-an-effect.
  const [prevValues, setPrevValues] = useState(state.values);
  const [remountKey, setRemountKey] = useState(0);
  if (state.values !== prevValues) {
    setPrevValues(state.values);
    setRemountKey((k) => k + 1);
    if (state.values?.locationType) setLocationType(state.values.locationType as "ONLINE" | "IN_PERSON");
    if (state.values?.frequency) setFrequency(state.values.frequency);
  }

  const v = state.values;

  return (
    <form action={formAction} className="login-form" key={remountKey}>
      {state.error && (
        <div className="form-message form-message--error" role="alert"><p>{state.error}</p></div>
      )}
      {state.conflicts && state.conflicts.length > 0 && (
        <div className="form-message form-message--error" role="alert">
          <p><strong>Scheduling conflict detected</strong> — this doesn&apos;t block scheduling, but check before proceeding:</p>
          <ul>
            {state.conflicts.map((c, i) => (
              <li key={i}>{c.kind === "TUTOR" ? "Tutor" : "Student"} already has &quot;{c.lessonTitle}&quot; at {new Date(c.startAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}</li>
            ))}
          </ul>
          <input type="hidden" name="confirmOverride" value="1" />
        </div>
      )}

      <div className="form-field">
        <label htmlFor="lesson-assignment">Tuition Assignment</label>
        <select id="lesson-assignment" name="assignmentId" required defaultValue={v?.assignmentId ?? ""} onChange={(e) => {
          const assignment = assignments.find((a) => a.id === e.target.value);
          const titleInput = document.getElementById("lesson-title") as HTMLInputElement | null;
          const subjectInput = document.getElementById("lesson-subject") as HTMLInputElement | null;
          if (assignment && titleInput && !titleInput.value) titleInput.value = assignment.title;
          if (assignment && subjectInput) subjectInput.value = assignment.subject;
          if (assignment?.defaultLocationType) setLocationType(assignment.defaultLocationType);
        }}>
          <option value="" disabled>Choose a Tuition Assignment</option>
          {assignments.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
        </select>
      </div>
      <div className="form-field"><label htmlFor="lesson-title">Title / topic</label><input id="lesson-title" name="title" required defaultValue={v?.title ?? ""} /></div>
      <div className="form-field"><label htmlFor="lesson-subject">Subject</label><input id="lesson-subject" name="subject" required defaultValue={v?.subject ?? ""} /></div>
      <div className="form-field"><label htmlFor="lesson-date">Date</label><input id="lesson-date" name="date" type="date" required defaultValue={v?.date ?? ""} /></div>
      <div className="form-field"><label htmlFor="lesson-time">Start time</label><input id="lesson-time" name="time" type="time" required defaultValue={v?.time ?? ""} /></div>
      <div className="form-field"><label htmlFor="lesson-duration">Duration (minutes)</label><input id="lesson-duration" name="durationMinutes" type="number" min={15} step={15} defaultValue={v?.durationMinutes ?? "60"} required /></div>

      <div className="form-field">
        <label htmlFor="lesson-location-type">Online or in-person</label>
        <select id="lesson-location-type" name="locationType" value={locationType} onChange={(e) => setLocationType(e.target.value as "ONLINE" | "IN_PERSON")}>
          <option value="ONLINE">Online</option>
          <option value="IN_PERSON">In-person</option>
        </select>
      </div>
      {locationType === "IN_PERSON" && (
        <div className="form-field"><label htmlFor="lesson-location">Location</label><input id="lesson-location" name="location" defaultValue={v?.location ?? ""} /></div>
      )}
      <div className="form-field"><label htmlFor="lesson-notes">Notes (optional)</label><textarea id="lesson-notes" name="notes" rows={3} defaultValue={v?.notes ?? ""} /></div>
      <label className="login-remember"><input type="checkbox" name="reportRequired" defaultChecked={v ? v.reportRequired : true} /><span>Require a lesson report</span></label>

      <div className="form-field">
        <label htmlFor="lesson-frequency">Repeats</label>
        <select id="lesson-frequency" name="frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
          <option value="NONE">Does not repeat</option>
          <option value="WEEKLY">Weekly</option>
          <option value="BIWEEKLY">Every two weeks</option>
        </select>
      </div>
      {frequency !== "NONE" && (
        <>
          <div className="form-field"><label htmlFor="lesson-end-after">End after N occurrences (optional)</label><input id="lesson-end-after" name="endAfterOccurrences" type="number" min={1} max={104} placeholder="e.g. 10" defaultValue={v?.endAfterOccurrences ?? ""} /></div>
          <div className="form-field"><label htmlFor="lesson-end-date">Or end on date (optional)</label><input id="lesson-end-date" name="endDate" type="date" defaultValue={v?.endDate ?? ""} /></div>
        </>
      )}

      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={pending}>
          <span>{pending ? "Scheduling…" : state.conflicts?.length ? "Schedule anyway" : "Schedule lesson"}</span>
        </button>
      </div>
    </form>
  );
}
