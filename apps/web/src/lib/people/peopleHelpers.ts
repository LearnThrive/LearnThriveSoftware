import type { DataProvider } from "@learnthrive/data/repositories";

/** Case-insensitive "does any of these fields contain the query" match, for the people lists'
 * search (plan6 section 41). An empty query matches everything. */
export function matchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field?.toLowerCase().includes(needle));
}

/** Tab counts shown across all three people lists, so each tab knows the others' totals. */
export async function peopleCounts(data: DataProvider): Promise<{ students: number; clients: number; tutors: number }> {
  const [students, clients, tutors] = await Promise.all([
    data.students.list(), data.clients.list(), data.tutors.list(),
  ]);
  return { students: students.length, clients: clients.length, tutors: tutors.length };
}
