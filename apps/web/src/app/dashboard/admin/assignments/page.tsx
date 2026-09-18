import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { createAssignmentAction } from "@/lib/actions/people";

export const metadata: Metadata = createMetadata({
  title: "Tuition Assignments",
  description: "Ongoing Tutor-Student-subject relationships.",
  path: "/dashboard/admin/assignments",
});

export default async function AssignmentsPage() {
  await requireRole(["ADMIN"]);
  const data = getDataProvider();
  const [assignments, tutors, students] = await Promise.all([
    data.assignments.list(), data.tutors.list(), data.students.list(),
  ]);
  const tutorById = new Map(tutors.map((t) => [t.id, t]));

  return (
    <div className="dashboard-page">
      <h1>Tuition Assignments</h1>
      <p>The ongoing relationship between a Tutor, one or more Students, and a subject — see docs/ARCHITECTURE.md for why this isn&apos;t called &quot;Job&quot;.</p>

      <ul className="people-list">
        {assignments.length === 0 && <li className="people-list__empty">No Tuition Assignments yet.</li>}
        {assignments.map((assignment) => (
          <li key={assignment.id}>
            {assignment.title}
            <span className="people-list__meta">
              {tutorById.get(assignment.tutorId)?.name ?? "Unknown tutor"} · {assignment.status}
              {assignment.level ? ` · ${assignment.level}` : ""}
            </span>
          </li>
        ))}
      </ul>

      <details className="people-add" open={assignments.length === 0}>
        <summary>Create Tuition Assignment</summary>
        <form action={createAssignmentAction} className="login-form">
          <div className="form-field"><label htmlFor="assignment-title">Title</label><input id="assignment-title" name="title" placeholder="GCSE Mathematics — Ayaan" required /></div>
          <div className="form-field"><label htmlFor="assignment-subject">Subject</label><input id="assignment-subject" name="subject" placeholder="Mathematics" required /></div>
          <div className="form-field"><label htmlFor="assignment-level">Level (optional)</label><input id="assignment-level" name="level" placeholder="GCSE" /></div>
          <div className="form-field">
            <label htmlFor="assignment-tutor">Tutor</label>
            <select id="assignment-tutor" name="tutorId" required defaultValue="">
              <option value="" disabled>Choose a Tutor</option>
              {tutors.map((tutor) => <option key={tutor.id} value={tutor.id}>{tutor.name}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="assignment-students">Student(s)</label>
            <select id="assignment-students" name="studentIds" multiple required size={Math.min(6, Math.max(3, students.length))}>
              {students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
            </select>
          </div>
          <div className="form-actions"><button type="submit" className="button button--primary"><span>Create Assignment</span></button></div>
        </form>
      </details>
    </div>
  );
}
