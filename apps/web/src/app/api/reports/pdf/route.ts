import { getDataProvider } from "@/lib/data/provider";
import { requireRoleForApi } from "@/lib/auth/guard";
import { visibleReportsFor, visibleStudentsFor } from "@/lib/dashboard/queries";
import { formatDateOnly, formatLongDate } from "@/lib/format";
import { buildReportsPdf, type PdfReport } from "@/lib/reports/reportPdf";
import { visibleReportFor } from "@/lib/reports/reportService";
import { siteConfig } from "@/lib/site";

/**
 * Approved lesson reports as a PDF (plan17 C19): one report with `?report=<id>`, or a student's reports with
 * `?student=<id>` and an optional `from` / `to` (YYYY-MM-DD, inclusive, by the lesson's UTC date) for a termly bundle.
 *
 * VISIBILITY: the reports come only from `visibleReportsFor` (the lessons this person can see) and each passes
 * `visibleReportFor`, the one gate every page uses; then only APPROVED ones are kept, for every role, so a
 * draft never leaves as a document. The builder copies the parent-visible fields by name, so a tutor's private
 * notes cannot reach the file. A report or student the person cannot see is the same 404 as one that does not
 * exist.
 */
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const NOT_FOUND = () => Response.json({ error: "Not found." }, { status: 404, headers });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const user = await requireRoleForApi(["ADMIN", "TUTOR", "CLIENT", "STUDENT"]);
  if (!user) return Response.json({ error: "Sign in to download reports." }, { status: 401, headers });

  const params = new URL(request.url).searchParams;
  const reportId = params.get("report");
  const studentId = params.get("student");
  const from = params.get("from");
  const to = params.get("to");
  if (!reportId === !studentId) return Response.json({ error: "Ask for one report or one student." }, { status: 400, headers });
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return Response.json({ error: "Dates are YYYY-MM-DD." }, { status: 400, headers });

  const data = getDataProvider();
  let heading = "Lesson report";
  let pairs = (await visibleReportsFor(data, user)).filter(({ report }) => report.status === "APPROVED" && visibleReportFor(user, report));
  const students = await data.students.list();
  const studentName = new Map(students.map((s) => [s.id, s.name]));

  if (reportId) {
    pairs = pairs.filter(({ report }) => report.id === reportId);
  } else {
    const student = (await visibleStudentsFor(data, user)).find((s) => s.id === studentId);
    if (!student) return NOT_FOUND();
    heading = `Lesson reports for ${student.name}`;
    // Oldest first, only this student's lessons, within the dates.
    pairs = pairs
      .filter(({ lesson }) => lesson.studentIds.includes(student.id))
      .filter(({ lesson }) => (!from || lesson.startAt >= `${from}T00:00:00`) && (!to || lesson.startAt <= `${to}T23:59:59`))
      .reverse();
    if (from || to) heading += ` (${from ?? "start"} to ${to ?? "now"})`;
  }
  if (pairs.length === 0) return NOT_FOUND();

  const tutors = new Map((await data.tutors.list()).map((t) => [t.id, t.name]));
  const reports: PdfReport[] = pairs.map(({ report, lesson }) => ({
    title: lesson.title,
    subject: lesson.subject,
    dateLabel: formatLongDate(lesson.startAt),
    tutorName: tutors.get(lesson.tutorId) ?? "Your tutor",
    studentNames: lesson.studentIds.map((id) => studentName.get(id)).filter(Boolean).join(", "),
    publicSummary: report.publicSummary,
    progress: report.progress,
    areasForImprovement: report.areasForImprovement,
    nextSteps: report.nextSteps,
    engagement: report.engagement && report.engagement.charAt(0) + report.engagement.slice(1).toLowerCase(),
  }));

  const pdf = buildReportsPdf(reports, { heading, brand: siteConfig.name, footer: `Created ${formatDateOnly(new Date())}` });
  const filename = reportId ? `learnthrive-report-${pairs[0].lesson.startAt.slice(0, 10)}.pdf` : `learnthrive-reports-${studentId}.pdf`;
  return new Response(pdf as BodyInit, {
    headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
