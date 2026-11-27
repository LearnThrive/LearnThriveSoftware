import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertCircle, CheckCircle2, Lock, Video, CalendarPlus, Download } from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { holds, rolesOf, scopes } from "@/lib/auth/scope";
import type { AuthenticatedUser } from "@/lib/auth/types";
import { teachesLesson } from "@/lib/auth/teaching";
import { lessonJoinRole } from "@/lib/classroom/lessonEntry";
import { createMetadata } from "@/lib/metadata";
import { getDataProvider } from "@/lib/data/provider";
import { cancelLessonAction, editLessonAction } from "@/lib/actions/lessons";
import { LEARNTHRIVE_DEFAULT_TIMEZONE, utcToZonedWallClock } from "@/lib/scheduling/timezone";
import { splitDuration } from "@/lib/scheduling/duration";
import { markAttendanceAction, completeLessonAction } from "@/lib/actions/attendance";
import { mayCloseOut } from "@/lib/lessons/closeOut";
import { CLOSE_OUT_PATH } from "@/lib/lessons/closeOutGate";
import { approveReportAction, returnReportAction, saveReportDraftAction, submitReportAction } from "@/lib/actions/reports";
import { visibleReportFor } from "@/lib/reports/reportService";
import { isWithinJoinWindow, joinOpensAt } from "@/lib/scheduling/joinWindow";
import { formatLongDate, formatRelative, formatTime, formatTimeRange } from "@/lib/format";
import { noShowAllowedFrom } from "@/lib/attendance/attendanceService";
import { LessonChatPanel } from "@/components/lessons/LessonChatPanel";
import { PageHeader } from "@/components/shell/PageHeader";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FormActions } from "@/components/ui/Field";
import type { AttendanceStatus, Lesson, ReportAssessmentLevel } from "@learnthrive/data/domain";

const ATTENDANCE_STATUSES: AttendanceStatus[] = ["ATTENDED", "LATE", "ABSENT", "EXCUSED"];
const ASSESSMENT_LEVELS: ReportAssessmentLevel[] = ["LOW", "MEDIUM", "HIGH"];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const lesson = await getDataProvider().lessons.get(id);
  return createMetadata({ title: lesson?.title ?? "Lesson", description: "Lesson detail.", path: `/dashboard/lessons/${id}` });
}

// IDOR boundary (plan5 section 85: "Tutor edits someone else's Lesson", "Student joins unrelated
// classroom") — every non-Admin role must be explicitly connected to *this specific* lesson, not
// just authenticated. See tests-e2e/lessons.spec.ts for the adversarial proof of this.
// A person with several roles may open a lesson if ANY ONE of their roles is connected to it through that role's OWN record (a student who
// is also a junior tutor opens the lessons they attend and the lessons they teach, and no other).
function canViewAs(user: { role: string; profileId?: string }, lesson: { tutorId: string; studentIds: string[]; clientIds: string[] }): boolean {
  if (user.role === "ADMIN") return true;
  if (!user.profileId) return false;
  if (user.role === "TUTOR" || user.role === "JUNIOR_TUTOR") return lesson.tutorId === user.profileId;
  if (user.role === "CLIENT") return lesson.clientIds.includes(user.profileId);
  if (user.role === "STUDENT") return lesson.studentIds.includes(user.profileId);
  return false;
}

function canView(user: AuthenticatedUser, lesson: { tutorId: string; studentIds: string[]; clientIds: string[] }): boolean {
  return scopes(user).some((scoped) => canViewAs(scoped, lesson));
}

export default async function LessonDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ joinError?: string; postClass?: string }>;
}) {
  const user = await requireSession();
  const { id } = await params;
  const { joinError, postClass } = await searchParams;
  const data = getDataProvider();
  const lesson = await data.lessons.get(id);
  if (!lesson) notFound();
  if (!canView(user, lesson)) redirect("/403");
  // The tutor has just ended the class: straight to closing it out, even if the scheduled time is not quite up.
  if (postClass === "1" && mayCloseOut(user, lesson)) redirect(`${CLOSE_OUT_PATH}?lesson=${encodeURIComponent(lesson.id)}`);

  const [tutor, students, attendanceRecords, activityEvents, report] = await Promise.all([
    data.tutors.get(lesson.tutorId),
    Promise.all(lesson.studentIds.map((sid) => data.students.get(sid))),
    data.attendance.forLesson(lesson.id),
    data.activity.forLesson(lesson.id),
    data.reports.forLesson(lesson.id),
  ]);
  const attendanceByStudent = new Map(attendanceRecords.map((record) => [record.studentId, record]));
  const namedStudents = students.filter((student): student is NonNullable<typeof student> => student !== null);

  const isAdmin = holds(user, "ADMIN");
  const isOwningTutor = teachesLesson(user, lesson);
  const canManage = isAdmin || isOwningTutor;
  const canCancel = isAdmin && lesson.status === "PLANNED";
  // Its tutor, a student on it, or any other administrator, who joins to supervise (lib/classroom/lessonEntry.ts decides, here and on entry).
  const entryRole = lessonJoinRole(user, lesson);
  const joinRole = entryRole === "student" ? "STUDENT" : "TUTOR";
  const canJoin = lesson.locationType === "ONLINE" && lesson.status !== "CANCELLED" && entryRole !== null;
  const joinWindowOpen = canJoin && isWithinJoinWindow(lesson, joinRole);
  // A student can be marked absent only 15 minutes after the scheduled start (the server enforces it; this explains it).
  const noShowFrom = noShowAllowedFrom(lesson.startAt);
  const absentAllowed = new Date() >= noShowFrom;
  const allAttendanceMarked = lesson.studentIds.every((studentId) => attendanceByStudent.has(studentId));
  const reportBlocksCompletion = lesson.reportRequired && (!report || report.status === "DRAFT");
  const canComplete = canManage && lesson.status !== "CANCELLED" && lesson.status !== "COMPLETED";
  const completionBlockedReason = !allAttendanceMarked
    ? "Mark attendance for every student first"
    : reportBlocksCompletion ? "Submit the lesson report first" : null;
  const visibleReport = report ? visibleReportFor(user, report) : null;

  // When the join window hasn't opened yet, say how long the wait is rather than just hiding the
  // button (plan6 section 59).
  const opensAt = joinOpensAt(lesson, joinRole);

  return (
    <>
      <PageHeader
        backTo={{ href: "/dashboard/lessons", label: "Back to lessons" }}
        breadcrumbs={[
          { label: "Lessons", href: "/dashboard/lessons" },
          { label: lesson.title },
        ]}
        eyebrow={lesson.subject}
        title={lesson.title}
        description={namedStudents.map((student) => student.name).join(", ") || undefined}
        meta={
          <span className="lesson-detail__summary">
            <span>{formatLongDate(lesson.startAt)}</span>
            <span>·</span>
            <span>{formatTimeRange(lesson.startAt, lesson.durationMinutes)}</span>
            <span>·</span>
            <span>{lesson.locationType === "ONLINE" ? "Online classroom" : `In person${lesson.location ? ` — ${lesson.location}` : ""}`}</span>
            <StatusBadge status={lesson.status} />
            {lesson.recurrenceId && <span className="badge badge--muted">Part of a series</span>}
          </span>
        }
        actions={
          <>
            {lesson.status !== "CANCELLED" && (
              // A plain link to an authenticated download (app/api/lessons/[id]/ics/route.ts): the file holds
              // only what this person may already see on this page.
              <a href={`/api/lessons/${lesson.id}/ics`} className="btn btn--secondary" download>
                <CalendarPlus size={16} aria-hidden="true" />Add to calendar
              </a>
            )}
            {isAdmin && (
              // Administrators only: a plain link to the billing screen where this lesson's family price and tutor pay are set. Nothing about
              // money is read or shown on this page, which tutors also see (B17).
              <Link
                href={`/dashboard/admin/billing/lessons?period=${new Date(lesson.startAt).toLocaleDateString("en-CA", { timeZone: "Europe/London" }).slice(0, 7)}#lesson-${lesson.id}`}
                className="btn btn--ghost"
              >
                Price and tutor pay
              </Link>
            )}
            {lesson.recurrenceId && lesson.status !== "CANCELLED" && (
              <a href={`/api/lessons/${lesson.id}/ics?series=1`} className="btn btn--ghost" download>
                Add the whole series
              </a>
            )}
            {canJoin && joinWindowOpen && (
              <Link href={`/dashboard/lessons/${lesson.id}/classroom`} className="btn btn--primary">
                <Video size={16} aria-hidden="true" />{entryRole === "supervisor" ? "Join to supervise" : "Join classroom"}
              </Link>
            )}
            {canJoin && !joinWindowOpen && lesson.status === "PLANNED" && new Date() < opensAt && (
              <span className="btn btn--secondary" aria-disabled="true">
                <Lock size={15} aria-hidden="true" />Classroom opens {formatRelative(opensAt)}
              </span>
            )}
            {isAdmin && lesson.status !== "CANCELLED" && <EditLessonDialog lesson={lesson} />}
            {canCancel && (
              <Dialog
                trigger="Cancel lesson"
                tone="danger"
                title="Cancel this lesson?"
                description="The lesson stays on record as cancelled — nothing is deleted."
              >
                <form action={cancelLessonAction} className="form">
                  <input type="hidden" name="lessonId" value={lesson.id} />
                  <Field label="Reason" htmlFor="cancel-reason" hint="Shown on the lesson's activity timeline.">
                    <input id="cancel-reason" name="reason" placeholder="Tutor unavailable" />
                  </Field>
                  <FormActions>
                    <button type="submit" className="btn btn--danger">Cancel this lesson</button>
                  </FormActions>
                </form>
              </Dialog>
            )}
          </>
        }
      />

      {joinError && (
        <div className="alert alert--error" role="alert">
          <AlertCircle size={17} aria-hidden="true" />
          <p>{joinError}</p>
        </div>
      )}

      {postClass === "1" && canManage && (
        <div className="alert alert--info">
          <CheckCircle2 size={17} aria-hidden="true" />
          <p>Class ended. Mark attendance and write the report below to close this lesson out.</p>
        </div>
      )}

      {lesson.status === "CANCELLED" && (
        <div className="alert alert--warning">
          <AlertCircle size={17} aria-hidden="true" />
          <p>
            This lesson was cancelled
            {lesson.cancelledAt ? ` ${formatRelative(lesson.cancelledAt)}` : ""}
            {lesson.cancellationReason ? ` — ${lesson.cancellationReason}` : "."}
          </p>
        </div>
      )}

      <div className="profile-grid">
        <div className="stack">
          {/* The ONLY place a tutor and a student exchange messages and files: the lesson's own chat (docs/LESSON_CHAT.md). Who may do what is the server's. */}
          {lesson.status !== "CANCELLED" && (
            <Card>
              <CardHeader title="Lesson chat" description={isAdmin && !isOwningTutor
                ? "Message the tutor and students at any time, without joining the classroom. Your messages show as from an administrator."
                : canManage || entryRole === "student"
                  ? "Running late, can't make it, or something to share? Message about this lesson at any time. Parents and administrators can read it."
                  : "Messages about this lesson, which you can read once it has finished."} />
              <CardBody><LessonChatPanel lessonId={lesson.id} isAdmin={isAdmin} sendsAsAdmin={isAdmin && !isOwningTutor} /></CardBody>
            </Card>
          )}
          {canManage && (
            <Card>
              <CardHeader
                title="Attendance"
                description="Record what happened for each student before completing the lesson."
              />
              <CardBody className="card__body--flush">
                {namedStudents.length === 0 ? (
                  <EmptyState title="No students on this lesson" />
                ) : (
                  <ul className="attendance-list">
                    {namedStudents.map((student) => {
                      const record = attendanceByStudent.get(student.id);
                      return (
                        <li className="attendance-row" key={student.id}>
                          <span className="attendance-row__person">
                            <Avatar name={student.name} size="sm" />
                            <span>
                              <span className="attendance-row__name">{student.name}</span>
                              {record && <StatusBadge status={record.status} />}
                            </span>
                          </span>
                          <form action={markAttendanceAction} className="attendance-row__form">
                            <input type="hidden" name="lessonId" value={lesson.id} />
                            <input type="hidden" name="studentId" value={student.id} />
                            <select name="status" defaultValue={record?.status ?? "ATTENDED"} aria-label={`Attendance status for ${student.name}`}>
                              {ATTENDANCE_STATUSES.map((status) => (
                                <option key={status} value={status} disabled={status === "ABSENT" && !absentAllowed && record?.status !== "ABSENT"}>
                                  {status.charAt(0) + status.slice(1).toLowerCase()}{status === "ABSENT" && !absentAllowed && record?.status !== "ABSENT" ? ` (from ${formatTime(noShowFrom)})` : ""}
                                </option>
                              ))}
                            </select>
                            <button type="submit" className="btn btn--secondary btn--sm">{record ? "Update" : "Mark"}</button>
                          </form>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}

          {canManage && lesson.status !== "CANCELLED" && (
            <Card>
              <CardHeader
                title="Lesson report"
                description={report
                  ? "What the family will see, plus your own private notes."
                  : "Write up how the lesson went once attendance is marked."}
                action={report ? <StatusBadge status={report.status} /> : undefined}
              />
              <CardBody>
                {!report && (
                  <form action={saveReportDraftAction}>
                    <input type="hidden" name="lessonId" value={lesson.id} />
                    <input type="hidden" name="publicSummary" value="" />
                    <EmptyState
                      title="No report yet"
                      description={lesson.reportRequired
                        ? "This lesson needs a report before it can be completed."
                        : "A report is optional for this lesson."}
                      action={<button type="submit" className="btn btn--primary">Start a report</button>}
                    />
                  </form>
                )}

                {report?.status === "DRAFT" && (
                  <form action={saveReportDraftAction} className="form">
                    <input type="hidden" name="lessonId" value={lesson.id} />
                    <Field label="Lesson summary" htmlFor="report-summary" required hint="What you covered. Shared with the family.">
                      <textarea id="report-summary" name="publicSummary" defaultValue={report.publicSummary} required />
                    </Field>
                    <Field label="Progress" htmlFor="report-progress" hint="What went well.">
                      <textarea id="report-progress" name="progress" defaultValue={report.progress ?? ""} />
                    </Field>
                    <Field label="Areas to improve" htmlFor="report-areas">
                      <textarea id="report-areas" name="areasForImprovement" defaultValue={report.areasForImprovement ?? ""} />
                    </Field>
                    <Field label="Homework or next steps" htmlFor="report-next-steps">
                      <textarea id="report-next-steps" name="nextSteps" defaultValue={report.nextSteps ?? ""} />
                    </Field>
                    <div className="grid-2">
                      <Field label="Engagement" htmlFor="report-engagement" hint="Shared with the family.">
                        <select id="report-engagement" name="engagement" defaultValue={report.engagement ?? ""}>
                          <option value="">Not assessed</option>
                          {ASSESSMENT_LEVELS.map((level) => <option key={level} value={level}>{level.charAt(0) + level.slice(1).toLowerCase()}</option>)}
                        </select>
                      </Field>
                      <Field label="Confidence" htmlFor="report-confidence" hint="Your own assessment. Never shared.">
                        <select id="report-confidence" name="confidence" defaultValue={report.confidence ?? ""}>
                          <option value="">Not assessed</option>
                          {ASSESSMENT_LEVELS.map((level) => <option key={level} value={level}>{level.charAt(0) + level.slice(1).toLowerCase()}</option>)}
                        </select>
                      </Field>
                    </div>
                    <Field label="Private notes" htmlFor="report-private-notes" hint="Only you and admins can ever see this. Never shown to the family.">
                      <textarea id="report-private-notes" name="internalTutorNotes" defaultValue={report.internalTutorNotes ?? ""} />
                    </Field>
                    <FormActions>
                      <button type="submit" formAction={saveReportDraftAction} className="btn btn--secondary">Save draft</button>
                      <button type="submit" formAction={submitReportAction} className="btn btn--primary">Submit report</button>
                    </FormActions>
                  </form>
                )}

                {report && report.status !== "DRAFT" && (
                  <ReportReadOnly
                    summary={report.publicSummary}
                    progress={report.progress}
                    areas={report.areasForImprovement}
                    nextSteps={report.nextSteps}
                    engagement={report.engagement}
                    confidence={report.confidence}
                    privateNotes={report.internalTutorNotes}
                    pdfHref={report.status === "APPROVED" ? `/api/reports/pdf?report=${report.id}` : undefined}
                  />
                )}

                {isAdmin && report?.status === "SUBMITTED" && (
                  <div className="form-actions">
                    <form action={approveReportAction}>
                      <input type="hidden" name="lessonId" value={lesson.id} />
                      <button type="submit" className="btn btn--primary">Approve report</button>
                    </form>
                    <Dialog trigger="Send back for changes" tone="secondary" title="Send this report back" description="The tutor is told why and can edit and submit it again. The family has not seen it.">
                      <form action={returnReportAction} className="form">
                        <input type="hidden" name="lessonId" value={lesson.id} />
                        <Field label="What needs changing" htmlFor="return-reason" required hint="The tutor sees this.">
                          <textarea id="return-reason" name="reason" required minLength={3} maxLength={500} rows={3} />
                        </Field>
                        <FormActions><button type="submit" className="btn btn--primary">Send back</button></FormActions>
                      </form>
                    </Dialog>
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* The family's view: only ever an approved report, only its public fields. */}
          {!canManage && (
            <Card>
              <CardHeader title={rolesOf(user).every((r) => r === "STUDENT") ? "Your feedback" : "Lesson report"} />
              <CardBody>
                {visibleReport ? (
                  <ReportReadOnly
                    summary={visibleReport.publicSummary}
                    progress={visibleReport.progress}
                    areas={visibleReport.areasForImprovement}
                    nextSteps={visibleReport.nextSteps}
                    engagement={visibleReport.engagement}
                    pdfHref={`/api/reports/pdf?report=${visibleReport.id}`}
                  />
                ) : (
                  <EmptyState
                    title="No report available yet"
                    description="Once your tutor writes the report and it's approved, it will appear here."
                  />
                )}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="stack">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="detail-list">
                <div><dt>Tutor</dt><dd>{tutor?.name ?? "Unassigned"}</dd></div>
                <div><dt>{namedStudents.length === 1 ? "Student" : "Students"}</dt><dd>{namedStudents.map((student) => student.name).join(", ") || "None"}</dd></div>
                <div><dt>Subject</dt><dd>{lesson.subject}</dd></div>
                <div><dt>Duration</dt><dd>{lesson.durationMinutes} minutes</dd></div>
                <div><dt>Report</dt><dd>{lesson.reportRequired ? "Required" : "Optional"}</dd></div>
                {lesson.notes && <div><dt>Notes</dt><dd>{lesson.notes}</dd></div>}
              </dl>
            </CardBody>
          </Card>

          {canComplete && (
            <Card>
              <CardBody>
                <form action={completeLessonAction}>
                  <input type="hidden" name="lessonId" value={lesson.id} />
                  <button
                    type="submit"
                    className={`btn ${completionBlockedReason == null ? "btn--primary" : "btn--secondary"} btn--block`}
                    disabled={completionBlockedReason != null}
                    aria-describedby={completionBlockedReason ? "complete-lesson-hint" : undefined}
                  >
                    <CheckCircle2 size={16} aria-hidden="true" />Complete lesson
                  </button>
                </form>
                {/* aria-describedby above ties this to the button so a screen reader announces
                    *why* it's disabled, not just that it is (plan6 section 88). */}
                {completionBlockedReason && <p className="form-hint" id="complete-lesson-hint">{completionBlockedReason}.</p>}
              </CardBody>
            </Card>
          )}

          {canManage && (
            <Card>
              <CardHeader title="Activity" />
              <CardBody className="card__body--flush">
                {activityEvents.length === 0 ? (
                  <EmptyState title="Nothing recorded yet" />
                ) : (
                  <ol className="timeline">
                    {activityEvents.slice().reverse().map((event) => (
                      <li className="timeline__item" key={event.id}>
                        <span className="timeline__marker" aria-hidden="true" />
                        <div className="timeline__body">
                          <p className="timeline__message">{event.message}</p>
                          <p className="timeline__meta">{formatRelative(event.createdAt)}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/** Changing a lesson's details, before, during or after it. The tutor and students stay in the same classroom room. */
function EditLessonDialog({ lesson }: { lesson: Lesson }) {
  const wall = utcToZonedWallClock(new Date(lesson.startAt), LEARNTHRIVE_DEFAULT_TIMEZONE);
  const two = (n: number) => String(n).padStart(2, "0");
  const length = splitDuration(lesson.durationMinutes);
  return (
    <Dialog
      trigger="Edit details"
      tone="secondary"
      title="Edit this lesson"
      description="Changes apply straight away, even while the lesson is on. The classroom stays open to whoever is in it; the joining and chat times follow the new start and length."
    >
      <form action={editLessonAction} className="form">
        <input type="hidden" name="lessonId" value={lesson.id} />
        <Field label="Title" htmlFor="edit-title" required>
          <input id="edit-title" name="title" defaultValue={lesson.title} required maxLength={120} />
        </Field>
        <Field label="Subject" htmlFor="edit-subject" required>
          <input id="edit-subject" name="subject" defaultValue={lesson.subject} required maxLength={80} />
        </Field>
        <div className="grid-2">
          <Field label="Date" htmlFor="edit-date" required>
            <input id="edit-date" name="date" type="date" defaultValue={`${wall.year}-${two(wall.month)}-${two(wall.day)}`} required />
          </Field>
          <Field label="Start time" htmlFor="edit-time" required>
            <input id="edit-time" name="time" type="time" defaultValue={`${two(wall.hour)}:${two(wall.minute)}`} required />
          </Field>
          <Field label="Length: hours" htmlFor="edit-hours">
            <input id="edit-hours" name="durationHours" type="number" min={0} max={8} step={1} inputMode="numeric" defaultValue={length.hours} />
          </Field>
          <Field label="Length: minutes" htmlFor="edit-minutes">
            <input id="edit-minutes" name="durationExtra" type="number" min={0} max={59} step={1} inputMode="numeric" defaultValue={length.minutes} />
          </Field>
        </div>
        {lesson.locationType === "IN_PERSON" && (
          <Field label="Location" htmlFor="edit-location" required>
            <input id="edit-location" name="location" defaultValue={lesson.location ?? ""} required maxLength={200} />
          </Field>
        )}
        <Field label="Notes" htmlFor="edit-notes">
          <textarea id="edit-notes" name="notes" rows={3} defaultValue={lesson.notes ?? ""} maxLength={2000} />
        </Field>
        <label className="checkbox-field">
          <input type="checkbox" name="reportRequired" defaultChecked={lesson.reportRequired} />
          <span><span className="checkbox-field__label">Require a lesson report</span></span>
        </label>
        <FormActions>
          <button type="submit" className="btn btn--primary">Save changes</button>
        </FormActions>
      </form>
    </Dialog>
  );
}

/** Read-only report display. Private notes are rendered in a visually distinct, clearly labelled
 * block so they can never be mistaken for the family-visible content (plan6 section 64). */
function ReportReadOnly({ summary, progress, areas, nextSteps, engagement, confidence, privateNotes, pdfHref }: {
  summary: string;
  progress?: string;
  areas?: string;
  nextSteps?: string;
  engagement?: string;
  confidence?: string;
  privateNotes?: string;
  /** An approved report can be downloaded; the file holds the family-visible fields only. */
  pdfHref?: string;
}) {
  return (
    <>
      <div className="report-block">
        <p className="report-block__label">Lesson summary</p>
        <p className="report-block__body">{summary || "Not written."}</p>
      </div>
      {progress && <div className="report-block"><p className="report-block__label">Progress</p><p className="report-block__body">{progress}</p></div>}
      {areas && <div className="report-block"><p className="report-block__label">Areas to improve</p><p className="report-block__body">{areas}</p></div>}
      {nextSteps && <div className="report-block"><p className="report-block__label">Homework / next steps</p><p className="report-block__body">{nextSteps}</p></div>}
      {engagement && <div className="report-block"><p className="report-block__label">Engagement</p><p className="report-block__body">{engagement.charAt(0) + engagement.slice(1).toLowerCase()}</p></div>}

      {pdfHref && (
        <p>
          <a href={pdfHref} className="btn btn--secondary" download><Download size={16} aria-hidden="true" />Download as PDF</a>
        </p>
      )}

      {(privateNotes || confidence) && (
        <div className="report-private">
          <p className="report-private__heading"><Lock size={14} aria-hidden="true" />Private — never shown to the family</p>
          {confidence && <div className="report-block"><p className="report-block__label">Confidence</p><p className="report-block__body">{confidence.charAt(0) + confidence.slice(1).toLowerCase()}</p></div>}
          {privateNotes && <div className="report-block"><p className="report-block__label">Tutor notes</p><p className="report-block__body">{privateNotes}</p></div>}
        </div>
      )}
    </>
  );
}
