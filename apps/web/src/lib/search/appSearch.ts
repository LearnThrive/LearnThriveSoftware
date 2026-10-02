import type { DataProvider } from "@learnthrive/data/repositories";
import type { Lesson } from "@learnthrive/data/domain";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { visibleStudentsFor } from "@/lib/dashboard/queries";
import { formatDateOnly } from "@/lib/format";
import { rankCommands } from "@/lib/palette/score";
import { visibleReportFor } from "@/lib/reports/reportService";
import { visibleLessonsFor } from "@/lib/scheduling/visibleLessons";
import { groupLabelFor, type AppSearchKind, type AppSearchResult } from "@/lib/search/appSearchTypes";

/**
 * Role-scoped search for the signed-in app's command palette (plan15 Wave 11 section 15.2).
 *
 * THE RULE: this function never decides who may see what. It starts from the same three readers every
 * page uses (`visibleLessonsFor`, `visibleStudentsFor`, `visibleReportFor`, see docs/ROLE_PERMISSIONS.md)
 * and only ever searches inside what they return. So a person can find exactly what they could open by
 * navigating, and a record they cannot see is not "filtered out of the results", it is never a candidate.
 *
 *  - People: Admin searches students, clients and tutors (the three People pages are Admin-only). A Tutor
 *    finds the students on their own assignments, a Parent their own children, and a Student gets no people
 *    results at all (the only student they may see is themselves).
 *  - Lessons: whatever `visibleLessonsFor` returns. Names are searchable only if the person would see them
 *    on the lesson: a Tutor/Admin the students; a Parent only their own children; a Student none.
 *  - Reports: through `visibleReportFor`, the one function that withholds drafts and submitted reports from
 *    a Parent/Student. Only the report fields that function returns are searched (the public summary,
 *    progress, areas for improvement and next steps); `internalTutorNotes` and `confidence` are NEVER
 *    searched, for anyone, so a search cannot even confirm a private note exists by matching it.
 *
 * What comes back is a handful of display strings and a route. It never contains a report's text, a
 * note, an email address of anyone but a record an Admin is searching, or an id the person could not
 * already navigate to. The caller (a server action) supplies the user from the server-validated session;
 * nothing here trusts a role or id from the browser, and the query is the only client input.
 */
export type { AppSearchKind, AppSearchResult } from "@/lib/search/appSearchTypes";

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 80;
export const MAX_RESULTS = 12;
const PER_KIND = 5;

type Candidate = AppSearchResult & { keywords: string[] };

const REPORT_STATUS_LABEL = { DRAFT: "Draft", SUBMITTED: "Awaiting approval", APPROVED: "Approved" } as const;

function rank(query: string, candidates: Candidate[]): AppSearchResult[] {
  return rankCommands(query, candidates.map((c) => ({ ...c, group: groupLabelFor(c.kind) })))
    .slice(0, PER_KIND)
    .map(({ id, kind, title, subtitle, href }) => ({ id, kind, title, subtitle, href }));
}

export async function searchApp(data: DataProvider, user: AuthenticatedUser, rawQuery: unknown): Promise<AppSearchResult[]> {
  if (typeof rawQuery !== "string") return [];
  const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
  if (query.length < MIN_QUERY_LENGTH) return [];

  const lessons = await visibleLessonsFor(data, user);
  const students = user.role === "STUDENT" ? [] : await visibleStudentsFor(data, user);
  const studentNameById = new Map(students.map((s) => [s.id, s.name]));
  const tutorNameById = new Map((await data.tutors.list()).map((t) => [t.id, t.name]));

  const results: AppSearchResult[] = [];

  // Lessons.
  results.push(
    ...rank(
      query,
      lessons.map((lesson: Lesson) => ({
        id: lesson.id,
        kind: "lesson" as const,
        title: lesson.title,
        subtitle: formatDateOnly(lesson.startAt),
        href: `/dashboard/lessons/${lesson.id}`,
        // Names only of people this person may see: students visible to them, and the tutor's name (the
        // lessons list already shows "with <tutor>" to every role).
        keywords: [
          lesson.subject,
          tutorNameById.get(lesson.tutorId) ?? "",
          ...lesson.studentIds.map((id) => studentNameById.get(id) ?? ""),
        ].filter(Boolean),
      })),
    ),
  );

  // People.
  if (user.role === "ADMIN") {
    results.push(
      ...rank(query, students.map((s) => ({ id: s.id, kind: "student" as const, title: s.name, subtitle: s.yearGroup, href: `/dashboard/admin/students/${s.id}`, keywords: s.yearGroup ? [s.yearGroup] : [] }))),
      ...rank(query, (await data.clients.list()).map((c) => ({ id: c.id, kind: "client" as const, title: c.name, subtitle: c.email, href: `/dashboard/admin/clients/${c.id}`, keywords: [c.email] }))),
      ...rank(query, (await data.tutors.list()).map((t) => ({ id: t.id, kind: "tutor" as const, title: t.name, subtitle: t.subjects.join(", "), href: `/dashboard/admin/tutors/${t.id}`, keywords: [t.email, ...t.subjects] }))),
    );
  } else if (user.role === "TUTOR" || user.role === "CLIENT") {
    const listPage = user.role === "TUTOR" ? "/dashboard/students" : "/dashboard/children";
    results.push(...rank(query, students.map((s) => ({ id: s.id, kind: "student" as const, title: s.name, subtitle: s.yearGroup, href: listPage, keywords: s.yearGroup ? [s.yearGroup] : [] }))));
  }

  // Reports, through the one visibility gate.
  const reportCandidates: Candidate[] = [];
  for (const lesson of lessons) {
    const report = await data.reports.forLesson(lesson.id);
    if (!report) continue;
    const visible = visibleReportFor(user, report);
    if (!visible) continue;
    reportCandidates.push({
      id: visible.id,
      kind: "report",
      title: `Report: ${lesson.title}`,
      subtitle: `${REPORT_STATUS_LABEL[visible.status]} · ${formatDateOnly(lesson.startAt)}`,
      href: `/dashboard/lessons/${lesson.id}`,
      // Only fields visibleReportFor returned. Never internalTutorNotes or confidence.
      keywords: [visible.publicSummary, visible.progress ?? "", visible.areasForImprovement ?? "", visible.nextSteps ?? ""].filter(Boolean),
    });
  }
  results.push(...rank(query, reportCandidates));

  return results.slice(0, MAX_RESULTS);
}
