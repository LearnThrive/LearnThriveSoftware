import type { Student, Tutor } from "@learnthrive/data/domain";
import { updateStudentAction, updateTutorAction } from "@/lib/actions/people";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormActions } from "@/components/ui/Field";

/**
 * Correcting a record that is wrong (docs/improvement/PLAN.md item 5). Administrators only: these sit on the admin profile pages and the
 * actions re-check. Each correction is audited by field name. A login's username and linked email are changed on the Login card, not here.
 */
export function EditStudentDialog({ student }: { student: Pick<Student, "id" | "name" | "yearGroup"> }) {
  return (
    <Dialog trigger="Edit details" tone="secondary" title="Correct this student's details" description="Use the first name or the name the family uses. The change is recorded.">
      <form action={updateStudentAction} className="form">
        <input type="hidden" name="studentId" value={student.id} />
        <Field label="Name" htmlFor="edit-student-name" required>
          <input id="edit-student-name" name="name" required maxLength={80} defaultValue={student.name} autoComplete="off" />
        </Field>
        <Field label="Year group" htmlFor="edit-student-year" hint="For example Year 10. Leave empty if not known.">
          <input id="edit-student-year" name="yearGroup" maxLength={40} defaultValue={student.yearGroup ?? ""} autoComplete="off" />
        </Field>
        <FormActions><button type="submit" className="btn btn--primary">Save changes</button></FormActions>
      </form>
    </Dialog>
  );
}

export function EditTutorDialog({ tutor }: { tutor: Pick<Tutor, "id" | "name" | "email" | "subjects"> }) {
  return (
    <Dialog trigger="Edit details" tone="secondary" title="Correct this tutor's details" description="The contact email here is how LearnThrive reaches the tutor. Their login is changed on the Login card. The change is recorded.">
      <form action={updateTutorAction} className="form">
        <input type="hidden" name="tutorId" value={tutor.id} />
        <Field label="Name" htmlFor="edit-tutor-name" required>
          <input id="edit-tutor-name" name="name" required maxLength={80} defaultValue={tutor.name} autoComplete="off" />
        </Field>
        <Field label="Contact email" htmlFor="edit-tutor-email" required>
          <input id="edit-tutor-email" name="email" type="email" required defaultValue={tutor.email} autoComplete="off" />
        </Field>
        <Field label="Subjects" htmlFor="edit-tutor-subjects" hint="Separated by commas.">
          <input id="edit-tutor-subjects" name="subjects" defaultValue={tutor.subjects.join(", ")} autoComplete="off" />
        </Field>
        <FormActions><button type="submit" className="btn btn--primary">Save changes</button></FormActions>
      </form>
    </Dialog>
  );
}
