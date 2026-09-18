import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";
import { createClientAction, createStudentAction, createTutorAction } from "@/lib/actions/people";

export const metadata: Metadata = createMetadata({
  title: "People",
  description: "Tutors, Clients and Students.",
  path: "/dashboard/admin/people",
});

export default async function PeoplePage() {
  await requireRole(["ADMIN"]);
  const data = getDataProvider();
  const [tutors, clients, students] = await Promise.all([
    data.tutors.list(), data.clients.list(), data.students.list(),
  ]);

  return (
    <div className="dashboard-page">
      <h1>People</h1>
      <p>Tutors, Clients (parents/guardians) and Students. See docs/ROLE_PERMISSIONS.md for who can see what.</p>

      <section className="people-section">
        <h2>Tutors ({tutors.length})</h2>
        <ul className="people-list">
          {tutors.length === 0 && <li className="people-list__empty">No Tutors yet.</li>}
          {tutors.map((tutor) => (
            <li key={tutor.id}>
              <Link href={`/dashboard/admin/tutors/${tutor.id}`}>{tutor.name}</Link>
              <span className="people-list__meta">{tutor.email} · {tutor.subjects.join(", ") || "no subjects listed"} · {tutor.active ? "Active" : "Inactive"}</span>
            </li>
          ))}
        </ul>
        <details className="people-add">
          <summary>Add Tutor</summary>
          <form action={createTutorAction} className="login-form">
            <div className="form-field"><label htmlFor="tutor-name">Name</label><input id="tutor-name" name="name" required /></div>
            <div className="form-field"><label htmlFor="tutor-email">Email</label><input id="tutor-email" name="email" type="email" required /></div>
            <div className="form-field"><label htmlFor="tutor-subjects">Subjects (comma-separated)</label><input id="tutor-subjects" name="subjects" placeholder="Mathematics, Science" /></div>
            <div className="form-actions"><button type="submit" className="button button--primary"><span>Add Tutor</span></button></div>
          </form>
        </details>
      </section>

      <section className="people-section">
        <h2>Clients ({clients.length})</h2>
        <ul className="people-list">
          {clients.length === 0 && <li className="people-list__empty">No Clients yet.</li>}
          {clients.map((client) => (
            <li key={client.id}>
              <Link href={`/dashboard/admin/clients/${client.id}`}>{client.name}</Link>
              <span className="people-list__meta">{client.email} · {client.active ? "Active" : "Inactive"}</span>
            </li>
          ))}
        </ul>
        <details className="people-add">
          <summary>Add Client</summary>
          <form action={createClientAction} className="login-form">
            <div className="form-field"><label htmlFor="client-name">Name</label><input id="client-name" name="name" required /></div>
            <div className="form-field"><label htmlFor="client-email">Email</label><input id="client-email" name="email" type="email" required /></div>
            <div className="form-field"><label htmlFor="client-phone">Phone (optional)</label><input id="client-phone" name="phone" /></div>
            <div className="form-actions"><button type="submit" className="button button--primary"><span>Add Client</span></button></div>
          </form>
        </details>
      </section>

      <section className="people-section">
        <h2>Students ({students.length})</h2>
        <ul className="people-list">
          {students.length === 0 && <li className="people-list__empty">No Students yet.</li>}
          {students.map((student) => (
            <li key={student.id}>
              <Link href={`/dashboard/admin/students/${student.id}`}>{student.name}</Link>
              <span className="people-list__meta">{student.yearGroup ?? "Year group not set"} · {student.active ? "Active" : "Inactive"}</span>
            </li>
          ))}
        </ul>
        <details className="people-add">
          <summary>Add Student</summary>
          <form action={createStudentAction} className="login-form">
            <div className="form-field"><label htmlFor="student-name">Name</label><input id="student-name" name="name" required /></div>
            <div className="form-field"><label htmlFor="student-year">Year group (optional)</label><input id="student-year" name="yearGroup" placeholder="Year 8" /></div>
            <div className="form-field">
              <label htmlFor="student-client">Associated Client (optional)</label>
              <select id="student-client" name="clientId" defaultValue="">
                <option value="">None yet</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </div>
            <div className="form-actions"><button type="submit" className="button button--primary"><span>Add Student</span></button></div>
          </form>
        </details>
      </section>
    </div>
  );
}
