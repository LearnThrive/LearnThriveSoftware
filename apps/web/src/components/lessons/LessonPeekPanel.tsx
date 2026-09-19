"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, Lock, Video, X } from "lucide-react";
import { StatusBadge } from "@/components/ui/Badge";
import { formatLongDate, formatRelative, formatTimeRange } from "@/lib/format";
import { rescheduleLessonAction, cancelLessonAction } from "@/lib/actions/lessons";
import { LEARNTHRIVE_DEFAULT_TIMEZONE, utcToZonedWallClock, zonedTimeToUtc } from "@/lib/scheduling/timezone";

export interface PeekLesson {
  id: string;
  title: string;
  subject: string;
  startAt: string;
  durationMinutes: number;
  status: string;
  locationType: "ONLINE" | "IN_PERSON";
  location?: string;
  tutorName: string;
  studentNames: string[];
  recurring: boolean;
  /** Only true for the viewer's own role being able to join (Tutor/Student) — Admin never joins. */
  canJoin: boolean;
  joinWindowOpen: boolean;
  joinOpensAt: string;
  /** Admin-only actions (matches the calendar's own drag-reschedule restriction). */
  canManage: boolean;
}

type RescheduleScope = "THIS_ONLY" | "THIS_AND_FUTURE" | "ENTIRE_SERIES";

/**
 * The calendar's side panel (plan6 section 56): clicking a lesson used to navigate straight to
 * the full detail page, losing whatever month/week the person was looking at. This shows the
 * fields that answer "what is this, can I join it, does it need to move" without leaving the
 * calendar — "View full details" is still one click away for attendance/reports/activity.
 */
export function LessonPeekPanel({ lesson, onClose }: { lesson: PeekLesson; onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "reschedule" | "cancel">("view");
  const [pending, startTransition] = useTransition();
  const [scope, setScope] = useState<RescheduleScope>("THIS_ONLY");
  const [error, setError] = useState<string | null>(null);

  const startLocal = toLocalInputParts(lesson.startAt);

  function submitReschedule(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await rescheduleLessonAction(formData);
        router.refresh();
        setMode("view");
        onClose();
      } catch {
        setError("Couldn't reschedule this lesson — it may have changed. Try again.");
      }
    });
  }

  return (
    <div className="lesson-peek" role="dialog" aria-modal="true" aria-labelledby="lesson-peek-title">
      <button type="button" className="lesson-peek__scrim" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div className="lesson-peek__panel">
        <header className="lesson-peek__header">
          <div>
            <p className="lesson-peek__eyebrow">{lesson.subject}</p>
            <h2 className="lesson-peek__title" id="lesson-peek-title">{lesson.title}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close panel">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {mode === "view" && (
          <>
            <div className="lesson-peek__meta">
              <StatusBadge status={lesson.status} />
              {lesson.recurring && <span className="badge badge--muted">Part of a series</span>}
            </div>

            <dl className="detail-list">
              <div><dt>Tutor</dt><dd>{lesson.tutorName}</dd></div>
              <div><dt>{lesson.studentNames.length === 1 ? "Student" : "Students"}</dt><dd>{lesson.studentNames.join(", ") || "None"}</dd></div>
              <div><dt>Date</dt><dd>{formatLongDate(lesson.startAt)}</dd></div>
              <div><dt>Time</dt><dd>{formatTimeRange(lesson.startAt, lesson.durationMinutes)}</dd></div>
              <div>
                <dt>Where</dt>
                <dd>{lesson.locationType === "ONLINE" ? "Online classroom" : `In person${lesson.location ? ` — ${lesson.location}` : ""}`}</dd>
              </div>
            </dl>

            <div className="lesson-peek__actions">
              {lesson.canJoin && lesson.joinWindowOpen && (
                <Link href={`/dashboard/lessons/${lesson.id}/classroom`} className="btn btn--primary btn--block">
                  <Video size={16} aria-hidden="true" />Join classroom
                </Link>
              )}
              {lesson.canJoin && !lesson.joinWindowOpen && lesson.status === "PLANNED" && (
                <span className="btn btn--secondary btn--block" aria-disabled="true">
                  <Lock size={15} aria-hidden="true" />Opens {formatRelative(lesson.joinOpensAt)}
                </span>
              )}

              <Link href={`/dashboard/lessons/${lesson.id}`} className="btn btn--secondary btn--block">
                View full details
              </Link>

              {lesson.canManage && lesson.status === "PLANNED" && (
                <div className="lesson-peek__manage">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setMode("reschedule")}>
                    <CalendarClock size={15} aria-hidden="true" />Reschedule
                  </button>
                  <button type="button" className="btn btn--danger btn--sm" onClick={() => setMode("cancel")}>
                    Cancel lesson
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {mode === "reschedule" && (
          <form action={submitReschedule} className="form">
            <input type="hidden" name="lessonId" value={lesson.id} />
            <input type="hidden" name="scope" value={scope} readOnly />
            {error && <div className="form-message form-message--error" role="alert"><p>{error}</p></div>}
            <div className="field-row">
              <div className="field">
                <label className="field__label" htmlFor="peek-date">Date</label>
                <input id="peek-date" name="date" type="date" defaultValue={startLocal.date} required onChange={() => setError(null)} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="peek-time">Time</label>
                <input id="peek-time" name="time" type="time" defaultValue={startLocal.time} required onChange={() => setError(null)} />
              </div>
            </div>
            {/* rescheduleLessonAction takes a single UTC instant, not separate date/time fields —
                computed from the two inputs and written into this uncontrolled field right
                before submit (see the submit button's onClick). Uncontrolled (defaultValue, not
                value) deliberately — nothing here should fight the imperative write at submit
                time the way a controlled value would on the next render. */}
            <input type="hidden" name="newStartAt" defaultValue="" ref={(el) => syncHiddenInstant(el)} />

            {lesson.recurring && (
              <div className="field">
                <span className="field__label">This lesson is part of a series — apply to</span>
                <div className="radio-group">
                  {([
                    ["THIS_ONLY", "This lesson only"],
                    ["THIS_AND_FUTURE", "This and future lessons"],
                    ["ENTIRE_SERIES", "The entire series"],
                  ] as const).map(([value, label]) => (
                    <label className="radio-option" key={value}>
                      <input type="radio" name="scopeChoice" checked={scope === value} onChange={() => setScope(value)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="form-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setMode("view")}>Back</button>
              <button type="submit" className="btn btn--primary" disabled={pending}
                onClick={(e) => {
                  // Build the UTC instant from the two local fields right before submit — see the
                  // hidden input above for why this can't just be a plain defaultValue.
                  const form = e.currentTarget.form;
                  if (!form) return;
                  const date = (form.elements.namedItem("date") as HTMLInputElement)?.value;
                  const time = (form.elements.namedItem("time") as HTMLInputElement)?.value;
                  const hidden = form.elements.namedItem("newStartAt") as HTMLInputElement;
                  if (date && time && hidden) hidden.value = localLondonToUtcIso(date, time);
                }}
              >
                {pending ? "Saving…" : "Save new time"}
              </button>
            </div>
          </form>
        )}

        {mode === "cancel" && (
          <form action={cancelLessonAction} className="form">
            <input type="hidden" name="lessonId" value={lesson.id} />
            <p>This lesson stays on record as cancelled — nothing is deleted.</p>
            <div className="field">
              <label className="field__label" htmlFor="peek-cancel-reason">Reason<span className="field__optional">Optional</span></label>
              <input id="peek-cancel-reason" name="reason" placeholder="Tutor unavailable" />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn--ghost" onClick={() => setMode("view")}>Back</button>
              <button type="submit" className="btn btn--danger">Cancel this lesson</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// A ref callback rather than an effect: this only ever needs to run once, at mount, to give the
// hidden field a sane default (now) before the person touches anything — see the button's own
// onClick for the value actually submitted.
function syncHiddenInstant(el: HTMLInputElement | null) {
  if (el && !el.value) el.value = new Date().toISOString();
}

/** Europe/London wall-clock parts for seeding the two <input type="date"/"time"> defaults —
 * built on the same zone-aware helper the rest of scheduling uses (timezone.ts), not a
 * hand-rolled offset calculation. */
function toLocalInputParts(iso: string): { date: string; time: string } {
  const wall = utcToZonedWallClock(new Date(iso), LEARNTHRIVE_DEFAULT_TIMEZONE);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`, time: `${pad(wall.hour)}:${pad(wall.minute)}` };
}

/** Inverse of toLocalInputParts, via zonedTimeToUtc (DST-correct for the specific date given). */
function localLondonToUtcIso(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return zonedTimeToUtc({ year, month, day, hour, minute }, LEARNTHRIVE_DEFAULT_TIMEZONE).toISOString();
}
