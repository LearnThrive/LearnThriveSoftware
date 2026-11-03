import type { DataProvider } from "@learnthrive/data/repositories";
import type { AccountRuntime } from "@/lib/account/runtime";

/**
 * DEVELOPMENT ONLY. On the database the accounts and the tuition records are one set of tables. On a local server they are two stores, so an
 * administrator's work on the tuition side is copied across here, or a family made on a local server would never count as enrolled. Does
 * nothing on the database, where `rt.memory` is null.
 */
export async function mirrorStudent(rt: AccountRuntime | null, data: DataProvider, studentId: string): Promise<void> {
  if (!rt?.memory) return;
  const [student, families, assignments] = await Promise.all([data.students.get(studentId), data.students.clientsFor(studentId), data.assignments.forStudent(studentId)]);
  const owner = families[0]?.userId;
  if (!student || !owner) return;
  if (!rt.memory.hasStudent(studentId)) rt.memory.seedStudent(owner, { id: studentId, displayName: student.name, yearGroup: student.yearGroup ?? null });
  for (const assignment of assignments) if (assignment.status === "ACTIVE") rt.memory.seedAssignment(studentId, "ACTIVE");
}
