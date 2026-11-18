"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Field } from "@/components/ui/Field";
import { TEACHING_SUBJECTS, tutorTeaches } from "@/lib/subjects";

/** Common levels, offered as suggestions in the Level box (it still takes anything). */
const LEVELS = ["11+", "KS2", "KS3", "GCSE", "A-Level"] as const;

/**
 * The subject, level and tutor on the "Create a tuition assignment" form. The subject is one of ours, and the tutor list follows it: only
 * tutors who teach that subject are offered. The server action checks the same rule (createAssignmentAction), so this is a convenience,
 * not the guard.
 */
export function AssignmentSubjectTutorFields({ tutors }: { tutors: ReadonlyArray<{ id: string; name: string; subjects: string[] }> }) {
  const [subject, setSubject] = useState("");
  const offered = subject ? tutors.filter((tutor) => tutorTeaches(tutor.subjects, subject)) : tutors;
  const levelListId = useId();

  return (
    <>
      <div className="assignment-form__row">
        <Field label="Subject" htmlFor="assignment-subject" required>
          <select id="assignment-subject" name="subject" required value={subject} onChange={(event) => setSubject(event.target.value)}>
            <option value="" disabled>Choose a subject</option>
            {TEACHING_SUBJECTS.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </Field>
        <Field label="Level" htmlFor="assignment-level" hint="For example GCSE or A-Level.">
          <input id="assignment-level" name="level" autoComplete="off" list={levelListId} />
          <datalist id={levelListId}>{LEVELS.map((level) => <option key={level} value={level} />)}</datalist>
        </Field>
      </div>
      <Field
        label="Tutor"
        htmlFor="assignment-tutor"
        required
        hint={subject
          ? offered.length === 0
            ? `No tutor teaches ${subject} yet. A tutor ticks their subjects on their My subjects page, or an administrator can add one on the tutor's page.`
            : `Tutors who teach ${subject}. A tutor with no subjects listed yet is also offered.`
          : "Choose the subject first and only tutors who teach it are offered."}
      >
        <select key={subject} id="assignment-tutor" name="tutorId" required defaultValue="">
          <option value="" disabled>Choose a tutor</option>
          {offered.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.name}</option>)}
        </select>
      </Field>
    </>
  );
}

export interface PickableStudent {
  id: string;
  name: string;
  yearGroup?: string;
}

/**
 * Choosing the students: search the list, tick as many as needed, and see who is chosen as chips you can remove, instead of a list box that
 * needs Ctrl-click. Plain checkboxes under the hood, all named `studentIds`, so it submits with no script. Someone chosen and then filtered
 * out of view is still sent (a hidden field stands in for the row that is not on screen), and at least one is required by the browser itself
 * while none is chosen. The server action checks again (createAssignmentAction).
 */
export function AssignmentStudentPicker({ students }: { students: ReadonlyArray<PickableStudent> }) {
  const labelId = useId();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const byId = new Map(students.map((student) => [student.id, student]));
  const needle = query.trim().toLowerCase();
  const shown = needle ? students.filter((s) => `${s.name} ${s.yearGroup ?? ""}`.toLowerCase().includes(needle)) : students;
  const shownIds = new Set(shown.map((s) => s.id));
  const toggle = (id: string) => setChosen((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  const groupRef = useRef<HTMLDivElement>(null);
  // The browser's own message for an unticked required checkbox ("Please check this box…") is wrong for a list of students. It is set when
  // the form is refused and cleared as soon as someone is chosen, on every row, so no row stays invalid.
  useEffect(() => {
    groupRef.current?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((box) => box.setCustomValidity(""));
  }, [chosen, query]);

  return (
    <div className="field student-pick" role="group" aria-labelledby={labelId} ref={groupRef}>
      <span className="field__label" id={labelId}>
        Student(s)<span className="field__required" aria-hidden="true">*</span>
      </span>
      {chosen.length > 0 && (
        <ul className="student-pick__chips" aria-label="Chosen students">
          {chosen.map((id) => (
            <li key={id} className="student-pick__chip">
              {byId.get(id)?.name}
              <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${byId.get(id)?.name ?? "student"}`}>
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="student-pick__box">
        <div className="student-pick__search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search students…" aria-label="Search students" autoComplete="off" />
        </div>
        {students.length === 0 ? (
          <p className="student-pick__none">No students yet. Add one under People, Students first.</p>
        ) : shown.length === 0 ? (
          <p className="student-pick__none">No student matches “{query.trim()}”.</p>
        ) : (
          <ul className="student-pick__list">
            {shown.map((student) => (
              <li key={student.id}>
                <label className="student-pick__row">
                  <input type="checkbox" name="studentIds" value={student.id} checked={chosen.includes(student.id)} onChange={() => toggle(student.id)} required={chosen.length === 0}
                    onInvalid={(event) => event.currentTarget.setCustomValidity("Choose at least one student.")} />
                  <span>{student.name}</span>
                  {student.yearGroup && <span className="student-pick__sub">{student.yearGroup}</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      {chosen.filter((id) => !shownIds.has(id)).map((id) => <input key={id} type="hidden" name="studentIds" value={id} />)}
      <p className="field__hint">Tick one or more. A student&apos;s parent is attached to the assignment automatically.</p>
    </div>
  );
}
