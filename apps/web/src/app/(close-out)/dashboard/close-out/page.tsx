import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, CheckCircle2, ShieldAlert, Video } from "lucide-react";
import type { AttendanceStatus, ReportAssessmentLevel } from "@learnthrive/data/domain";
import { requirePermission } from "@/lib/auth/guard";
import { can, holds, recordFor } from "@/lib/auth/scope";
import { teachingTutorId } from "@/lib/auth/teaching";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@/lib/data/provider";
import { formatLongDate, formatTime, formatTimeRange } from "@/lib/format";
import { noShowAllowedFrom } from "@/lib/attendance/attendanceService";
import { lessonsToCloseOut, mayCloseOut } from "@/lib/lessons/closeOut";
import { isOpen } from "@/lib/lessons/timing";
import { isWithinJoinWindow } from "@/lib/scheduling/joinWindow";
import { finishLessonAction } from "@/lib/actions/closeOut";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, FormActions } from "@/components/ui/Field";
import { SignOutButton } from "./SignOutButton";
import styles from "./closeOut.module.css";

export const metadata: Metadata = createMetadata({
  title: "Finish your lesson",
  description: "Mark attendance and write the report to close a lesson out.",
  path: "/dashboard/close-out",
});

const STATUSES: AttendanceStatus[] = ["ATTENDED", "LATE", "ABSENT", "EXCUSED"];
const LEVELS: ReportAssessmentLevel[] = ["LOW", "MEDIUM", "HIGH"];
const sentence = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

/**
 * Where a tutor finishes a lesson: attendance, report and completion in one form. While a lesson that is over waits here, every other
 * dashboard page sends the tutor back (lib/lessons/closeOutGate.ts); the classroom and safeguarding concerns stay open.
 */
export default async function CloseOutPage({ searchParams }: { searchParams: Promise<{ lesson?: string; error?: string }> }) {
  const user = await requirePermission("lesson.complete");
  const { lesson: wanted, error } = await searchParams;
  const data = getDataProvider();
  const now = new Date();
  const waiting = await lessonsToCloseOut(data, user, now);
  // The one asked for may have just been ended early; otherwise the oldest that is waiting.
  const asked = wanted ? await data.lessons.get(wanted) : null;
  const lesson = asked && mayCloseOut(user, asked, now) ? asked : waiting[0];
  if (!lesson) redirect("/dashboard?toast=Your+lessons+are+all+finished");

  const tutorId = teachingTutorId(user);
  const [students, records, report, mine] = await Promise.all([
    Promise.all(lesson.studentIds.map((id) => data.students.get(id))),
    data.attendance.forLesson(lesson.id),
    data.reports.forLesson(lesson.id),
    data.lessons.forTutor(tutorId!),
  ]);
  const writing = !report || report.status === "DRAFT";
  const required = lesson.reportRequired;
  const absentFrom = noShowAllowedFrom(lesson.startAt);
  const sends = can(user, "report.submit");
  // A tutor may also be somebody's student: a lesson they attend must never be shut off by one they still have to close out.
  const learnerId = holds(user, "STUDENT") ? recordFor(user, "STUDENT") : null;
  const attending = learnerId ? await data.lessons.forStudent(learnerId) : [];
  const joinable = [
    ...mine.filter((l) => isOpen(l) && isWithinJoinWindow(l, "TUTOR", now)),
    ...attending.filter((l) => l.status !== "CANCELLED" && isWithinJoinWindow(l, "STUDENT", now)),
  ].filter((l) => l.locationType === "ONLINE");
  const select = (name: string, label: string, hint: string, value: string | undefined) => (
    <Field label={label} htmlFor={name} required={required} hint={hint}>
      <select id={name} name={name} defaultValue={value ?? ""}>
        <option value="">Choose…</option>
        {LEVELS.map((level) => <option key={level} value={level}>{sentence(level)}</option>)}
      </select>
    </Field>
  );

  return (
    <>
      <header className={styles.header}>
        <p className="eyebrow">Finish your lesson{waiting.length > 1 ? ` · ${waiting.length} waiting` : ""}</p>
        <h1>{lesson.title}</h1>
        <p>{formatLongDate(lesson.startAt)} · {formatTimeRange(lesson.startAt, lesson.durationMinutes)}</p>
        {waiting.length > 0
          ? <p>The rest of your dashboard opens again once {waiting.length > 1 ? "these lessons are" : "this lesson is"} finished.</p>
          : <p><Link href={`/dashboard/lessons/${lesson.id}`}>Not over yet? Go back to the lesson</Link></p>}
      </header>

      {joinable.length > 0 && (
        <div className="alert alert--info">
          <Video size={17} aria-hidden="true" />
          <p>{joinable.map((l) => <Link key={l.id} className={styles.join} href={`/dashboard/lessons/${l.id}/classroom`}>Join the classroom: {l.title}, {formatTime(new Date(l.startAt))}</Link>)}</p>
        </div>
      )}

      {error && (
        <div className="alert alert--error" role="alert">
          <AlertCircle size={17} aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}

      {/* Keyed on what is saved, so the fields always show it after a refused attempt. */}
      <form key={`${lesson.id}:${report?.updatedAt ?? ""}:${error ?? ""}`} action={finishLessonAction} className="form">
        <input type="hidden" name="lessonId" value={lesson.id} />
        <Card>
          <CardHeader title="Attendance" description="Mark every student." />
          <CardBody>
            {students.map((student) => {
              if (!student) return null;
              const marked = records.find((r) => r.studentId === student.id)?.status;
              const name = `attendance:${student.id}`;
              const tooEarly = now < absentFrom && marked !== "ABSENT";
              return (
                <Field key={student.id} label={student.name} htmlFor={name} required>
                  <select id={name} name={name} required defaultValue={marked ?? ""}>
                    <option value="">Choose…</option>
                    {STATUSES.map((status) => (
                      <option key={status} value={status} disabled={status === "ABSENT" && tooEarly}>
                        {sentence(status)}{status === "ABSENT" && tooEarly ? ` (from ${formatTime(absentFrom)})` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            })}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Lesson report"
            description={!writing ? "Already submitted."
              : required ? "Every field except private notes is needed. If nobody attended, only the summary is."
              : "A report is optional for this lesson. Write a summary if you want one sent."}
          />
          {writing && (
            <CardBody>
              <Field label="Lesson summary" htmlFor="publicSummary" required={required} hint="What you covered. Shared with the family.">
                <textarea id="publicSummary" name="publicSummary" required={required} defaultValue={report?.publicSummary ?? ""} />
              </Field>
              <Field label="Progress" htmlFor="progress" required={required} hint="What went well.">
                <textarea id="progress" name="progress" defaultValue={report?.progress ?? ""} />
              </Field>
              <Field label="Areas to improve" htmlFor="areasForImprovement" required={required}>
                <textarea id="areasForImprovement" name="areasForImprovement" defaultValue={report?.areasForImprovement ?? ""} />
              </Field>
              <Field label="Homework or next steps" htmlFor="nextSteps" required={required}>
                <textarea id="nextSteps" name="nextSteps" defaultValue={report?.nextSteps ?? ""} />
              </Field>
              <div className="grid-2">
                {select("engagement", "Engagement", "Shared with the family.", report?.engagement)}
                {select("confidence", "Confidence", "Your own assessment. Never shared.", report?.confidence)}
              </div>
              <Field label="Private notes" htmlFor="internalTutorNotes" hint="Only you and admins can ever see this.">
                <textarea id="internalTutorNotes" name="internalTutorNotes" defaultValue={report?.internalTutorNotes ?? ""} />
              </Field>
            </CardBody>
          )}
        </Card>

        <FormActions>
          <button type="submit" className="btn btn--primary">
            <CheckCircle2 size={16} aria-hidden="true" />{sends ? "Finish lesson" : "Save for an administrator to send"}
          </button>
        </FormActions>
      </form>

      <footer className={styles.footer}>
        <p>Did the lesson not happen? Ask an administrator to cancel it.</p>
        <p className={styles.links}>
          <Link href="/dashboard/concerns" className="btn btn--ghost"><ShieldAlert size={16} aria-hidden="true" />Raise a safeguarding concern</Link>
          <SignOutButton />
        </p>
      </footer>
    </>
  );
}
