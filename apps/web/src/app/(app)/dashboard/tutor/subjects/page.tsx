import type { Metadata } from "next";
import { requireTutor } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@/lib/data/provider";
import { updateOwnSubjectsAction } from "@/lib/actions/tutorSubjects";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormActions } from "@/components/ui/Field";
import { TEACHING_SUBJECTS, canonicalSubject } from "@/lib/subjects";

export const metadata: Metadata = createMetadata({
  title: "My subjects",
  description: "The subjects you teach.",
  path: "/dashboard/tutor/subjects",
});

export default async function TutorSubjectsPage() {
  const user = await requireTutor();
  const data = getDataProvider();
  const tutor = user.profileId ? await data.tutors.get(user.profileId) : null;

  if (!tutor) {
    return (
      <>
        <PageHeader eyebrow="You" title="My subjects" />
        <Card>
          <EmptyState
            title="Your account isn't linked to a tutor profile yet"
            description="Ask an admin to connect your login to your tutor record, then you can choose your subjects here."
          />
        </Card>
      </>
    );
  }

  const taught = new Set(tutor.subjects.map(canonicalSubject));
  const others = tutor.subjects.filter((subject) => canonicalSubject(subject) === null);

  return (
    <>
      <PageHeader
        eyebrow="You"
        title="My subjects"
        description="Tick every subject you teach. An administrator can only assign you students for these subjects, and parents see the subject next to your name."
      />
      <Card>
        <CardBody>
          <form action={updateOwnSubjectsAction} className="form">
            <fieldset className="field">
              <legend className="field__label">Subjects I teach</legend>
              {TEACHING_SUBJECTS.map((subject) => (
                <label key={subject} className="checkbox-row">
                  <input type="checkbox" name="subjects" value={subject} defaultChecked={taught.has(subject)} />
                  <span>{subject}</span>
                </label>
              ))}
              {others.length > 0 && <p className="field__hint">Also on your record, kept as they are: {others.join(", ")}.</p>}
            </fieldset>
            <FormActions>
              <button type="submit" className="btn btn--primary">Save subjects</button>
            </FormActions>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
