import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const client = await getDataProvider().clients.get(id);
  return createMetadata({ title: client?.name ?? "Client", description: "Client profile.", path: `/dashboard/admin/clients/${id}` });
}

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["ADMIN"]);
  const { id } = await params;
  const data = getDataProvider();
  const client = await data.clients.get(id);
  if (!client) notFound();
  const [students, assignments] = await Promise.all([
    data.students.studentsFor(id),
    data.assignments.forClient(id),
  ]);

  return (
    <div className="dashboard-page">
      <p className="eyebrow">Client</p>
      <h1>{client.name}</h1>
      <p>{client.email}{client.phone ? ` · ${client.phone}` : ""} · {client.active ? "Active" : "Inactive"}</p>

      <h2>Students ({students.length})</h2>
      {students.length === 0 ? (
        <p>No associated Students yet.</p>
      ) : (
        <ul className="people-list">
          {students.map((student) => <li key={student.id}>{student.name} <span className="people-list__meta">{student.yearGroup ?? ""}</span></li>)}
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
        Upcoming lessons, reports, and account activity arrive with later phases of this platform.
      </p>
    </div>
  );
}
