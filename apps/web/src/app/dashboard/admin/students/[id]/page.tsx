import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const student = await getDataProvider().students.get(id);
  return createMetadata({ title: student?.name ?? "Student", description: "Student profile.", path: `/dashboard/admin/students/${id}` });
}

export default async function StudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["ADMIN"]);
  const { id } = await params;
  const data = getDataProvider();
  const student = await data.students.get(id);
  if (!student) notFound();
  const [clients, assignments] = await Promise.all([
    data.students.clientsFor(id),
    data.assignments.forStudent(id),
  ]);

  return (
    <div className="dashboard-page">
      <p className="eyebrow">Student</p>
      <h1>{student.name}</h1>
      <p>{student.yearGroup ?? "Year group not set"} · {student.active ? "Active" : "Inactive"}</p>

      <h2>Client/Parent relationships ({clients.length})</h2>
      {clients.length === 0 ? (
        <p>No associated Clients yet.</p>
      ) : (
        <ul className="people-list">
          {clients.map((client) => <li key={client.id}>{client.name} <span className="people-list__meta">{client.email}</span></li>)}
        </ul>
      )}

      <h2>Tuition Assignments ({assignments.length})</h2>
      {assignments.length === 0 ? (
        <p>No Tuition Assignments yet.</p>
      ) : (
        <ul className="people-list">
          {assignments.map((assignment) => <li key={assignment.id}>{assignment.title} <span className="people-list__meta">{assignment.status}</span></li>)}
        </ul>
      )}
      <p className="dashboard-page__note">
        Upcoming lessons, attendance, and reports arrive with later phases of this platform.
      </p>
    </div>
  );
}
