"use client";

import { useState } from "react";
import { Field } from "@/components/ui/Field";
import { TEACHING_SUBJECTS, tutorTeaches } from "@/lib/subjects";

/**
 * The subject and the tutor on the "Create a tuition assignment" form. The subject is one of ours, and the tutor list follows it: only
 * tutors who teach that subject are offered. The server action checks the same rule (createAssignmentAction), so this is a convenience,
 * not the guard.
 */
export function AssignmentSubjectTutorFields({ tutors }: { tutors: ReadonlyArray<{ id: string; name: string; subjects: string[] }> }) {
  const [subject, setSubject] = useState("");
  const offered = subject ? tutors.filter((tutor) => tutorTeaches(tutor.subjects, subject)) : tutors;

  return (
    <>
      <Field label="Subject" htmlFor="assignment-subject" required>
        <select id="assignment-subject" name="subject" required value={subject} onChange={(event) => setSubject(event.target.value)}>
          <option value="" disabled>Choose a subject</option>
          {TEACHING_SUBJECTS.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </Field>
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
