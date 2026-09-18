import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/guard";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@learnthrive/data/inMemoryProvider";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const tutor = await getDataProvider().tutors.get(id);
  return createMetadata({ title: tutor?.name ?? "Tutor", description: "Tutor profile.", path: `/dashboard/admin/tutors/${id}` });
}

export default async function TutorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["ADMIN"]);
  const { id } = await params;
  const data = getDataProvider();
  const tutor = await data.tutors.get(id);
  if (!tutor) notFound();
  const assignments = await data.assignments.forTutor(id);

  return (
    <div className="dashboard-page">
      <p className="eyebrow">Tutor</p>
      <h1>{tutor.name}</h1>
      <p>{tutor.email} · {tutor.active ? "Active" : "Inactive"}</p>
      <p>Subjects: {tutor.subjects.join(", ") || "none listed"}</p>

      <h2>Tuition Assignments ({assignments.length})</h2>
      {assignments.length === 0 ? (
        <p>No Tuition Assignments yet.</p>
      ) : (
        <ul className="people-list">
          {assignments.map((assignment) => (
            <li key={assignment.id}>
              {assignment.title} <span className="people-list__meta">{assignment.status}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="dashboard-page__note">
        Availability, upcoming/completed lessons, and submitted reports arrive with later phases of this platform.
      </p>
    </div>
  );
}
