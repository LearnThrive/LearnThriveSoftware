"use client";

import { useActionState, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Field, FieldSet, FormActions } from "@/components/ui/Field";
import { formatLessonDateTime } from "@/lib/format";
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
    <form action={formAction} className="form form--stacked" key={remountKey}>
      {state.error && (
        <div className="form-message form-message--error" role="alert"><p>{state.error}</p></div>
      )}
      {state.conflicts && state.conflicts.length > 0 && (
        <div className="form-message form-message--warning" role="alert">
          <p className="form-message__title">
            <AlertTriangle size={16} aria-hidden="true" />
            Scheduling clash
          </p>
          <p>This doesn&apos;t block scheduling — check it&apos;s intentional before you continue.</p>
          <ul>
            {state.conflicts.map((c, i) => (
              <li key={i}>
                {c.kind === "TUTOR" ? "Tutor" : "Student"} already has &ldquo;{c.lessonTitle}&rdquo; at{" "}
                {formatLessonDateTime(c.startAt)}
              </li>
            ))}
          </ul>
          <input type="hidden" name="confirmOverride" value="1" />
        </div>
      )}

      <FieldSet legend="What and who" description="Pick the assignment first — the subject fills itself in.">
        <Field label="Tuition Assignment" htmlFor="lesson-assignment" required>
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
        </Field>
        <Field label="Title / topic" htmlFor="lesson-title" required hint="What the student will see in their timetable.">
          <input id="lesson-title" name="title" required defaultValue={v?.title ?? ""} />
        </Field>
        <Field label="Subject" htmlFor="lesson-subject" required>
          <input id="lesson-subject" name="subject" required defaultValue={v?.subject ?? ""} />
        </Field>
      </FieldSet>

      <FieldSet legend="When" description="All times are Europe/London.">
        <div className="field-row">
          <Field label="Date" htmlFor="lesson-date" required>
            <input id="lesson-date" name="date" type="date" required defaultValue={v?.date ?? ""} />
          </Field>
          <Field label="Start time" htmlFor="lesson-time" required>
            <input id="lesson-time" name="time" type="time" required defaultValue={v?.time ?? ""} />
          </Field>
          <Field label="Duration (minutes)" htmlFor="lesson-duration" required>
            <input id="lesson-duration" name="durationMinutes" type="number" min={15} step={15} defaultValue={v?.durationMinutes ?? "60"} required />
          </Field>
        </div>

        <Field label="Repeats" htmlFor="lesson-frequency" required>
          <select id="lesson-frequency" name="frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)}>
            <option value="NONE">Does not repeat</option>
            <option value="WEEKLY">Weekly</option>
            <option value="BIWEEKLY">Every two weeks</option>
          </select>
        </Field>
        {frequency !== "NONE" && (
          <div className="field-row">
            <Field label="End after N occurrences" htmlFor="lesson-end-after" hint="Leave both blank for an open-ended series.">
              <input id="lesson-end-after" name="endAfterOccurrences" type="number" min={1} max={104} placeholder="e.g. 10" defaultValue={v?.endAfterOccurrences ?? ""} />
            </Field>
            <Field label="Or end on date" htmlFor="lesson-end-date">
              <input id="lesson-end-date" name="endDate" type="date" defaultValue={v?.endDate ?? ""} />
            </Field>
          </div>
        )}
      </FieldSet>

      <FieldSet legend="Where and how">
        <Field label="Online or in-person" htmlFor="lesson-location-type" required>
          <select id="lesson-location-type" name="locationType" value={locationType} onChange={(e) => setLocationType(e.target.value as "ONLINE" | "IN_PERSON")}>
            <option value="ONLINE">Online</option>
            <option value="IN_PERSON">In-person</option>
          </select>
        </Field>
        {locationType === "IN_PERSON" && (
          <Field label="Location" htmlFor="lesson-location" hint="Address or meeting point.">
            <input id="lesson-location" name="location" defaultValue={v?.location ?? ""} />
          </Field>
        )}
        <Field label="Notes" htmlFor="lesson-notes" hint="Visible to the tutor and the family.">
          <textarea id="lesson-notes" name="notes" rows={3} defaultValue={v?.notes ?? ""} />
        </Field>
        <label className="checkbox-field">
          <input type="checkbox" name="reportRequired" defaultChecked={v ? v.reportRequired : true} />
          <span>
            <span className="checkbox-field__label">Require a lesson report</span>
            <span className="checkbox-field__hint">The tutor is prompted to write one after the lesson.</span>
          </span>
        </label>
      </FieldSet>

      <FormActions>
        <button type="submit" className="btn btn--primary" disabled={pending}>
          <span>{pending ? "Scheduling…" : state.conflicts?.length ? "Schedule anyway" : "Schedule lesson"}</span>
        </button>
      </FormActions>
    </form>
  );
}
