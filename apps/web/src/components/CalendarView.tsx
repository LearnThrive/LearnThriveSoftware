"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventDropArg } from "@fullcalendar/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { rescheduleLessonAction } from "@/lib/actions/lessons";
import { LessonPeekPanel, type PeekLesson } from "@/components/lessons/LessonPeekPanel";
import { formatLongDate } from "@/lib/format";

export interface CalendarLesson {
  id: string;
  title: string;
  subject: string;
  startAt: string; // UTC ISO instant
  durationMinutes: number;
  status: string;
  recurring: boolean;
  locationType: "ONLINE" | "IN_PERSON";
  location?: string;
  tutorName: string;
  studentNames: string[];
  canJoin: boolean;
  joinWindowOpen: boolean;
  joinOpensAt: string;
}

// Plan section 63: a configurable visible-hours window (morning through evening) rather than
// hiding legitimate out-of-hours lessons entirely — 07:00-21:00 covers ordinary tutoring hours
// without being so wide the week/day views are mostly empty space.
const SLOT_MIN_TIME = "07:00:00";
const SLOT_MAX_TIME = "21:00:00";

type RescheduleScope = "THIS_ONLY" | "THIS_AND_FUTURE" | "ENTIRE_SERIES";

/** Section 55: FullCalendar themed onto LearnThrive's own tokens via its CSS custom properties,
 * rather than left at its default appearance — see the `.calendar-wrap` rules in
 * app-dashboard.css for the actual colour/shape mapping. */
export function CalendarView({ lessons, canManage }: { lessons: CalendarLesson[]; canManage: boolean }) {
  const router = useRouter();
  const [pendingDrop, setPendingDrop] = useState<EventDropArg | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // FullCalendar's own prev/next buttons render their chevron as a bare <span role="img"> with
  // no accessible name of its own (the *button* has a real title, but axe correctly flags the
  // inner role="img" separately) — nothing in FullCalendar's public props controls this markup,
  // so it's corrected here instead of accepted as an unfixable third-party gap. The toolbar's
  // buttons are stable DOM nodes across date/view changes, so a mount-only pass is enough.
  useEffect(() => {
    const icons = wrapRef.current?.querySelectorAll('.fc-icon-chevron-left, .fc-icon-chevron-right') ?? [];
    icons.forEach((icon) => icon.setAttribute("aria-hidden", "true"));
  }, []);

  const events = lessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.status === "CANCELLED" ? `Cancelled: ${lesson.title}` : lesson.title,
    start: lesson.startAt,
    end: new Date(new Date(lesson.startAt).getTime() + lesson.durationMinutes * 60_000).toISOString(),
    classNames: [`lesson-status-${lesson.status.toLowerCase()}`, ...(lesson.id === peekId ? ["is-selected"] : [])],
    editable: canManage && lesson.status === "PLANNED",
  }));

  // Takes `info` directly rather than reading it back off state — calling this immediately
  // after setPendingDrop() for a non-recurring lesson would otherwise read a stale (pre-update)
  // state value, since React state updates aren't synchronous.
  async function performReschedule(info: EventDropArg, scope: RescheduleScope) {
    const formData = new FormData();
    formData.set("lessonId", info.event.id);
    formData.set("newStartAt", (info.event.start ?? new Date()).toISOString());
    formData.set("scope", scope);
    await rescheduleLessonAction(formData);
    router.refresh();
  }

  function cancelDrop() {
    pendingDrop?.revert();
    setPendingDrop(null);
  }

  const lessonById = new Map(lessons.map((l) => [l.id, l]));
  const peekLesson = peekId ? lessonById.get(peekId) : undefined;

  return (
    <div className="calendar-wrap" ref={wrapRef}>
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" }}
        events={events}
        editable={canManage}
        eventStartEditable={canManage}
        eventDurationEditable={false}
        slotMinTime={SLOT_MIN_TIME}
        slotMaxTime={SLOT_MAX_TIME}
        timeZone="Europe/London"
        firstDay={1}
        height="auto"
        eventClick={(info) => setPeekId(info.event.id)}
        eventDrop={(info) => {
          const lesson = lessonById.get(info.event.id);
          if (lesson?.recurring) {
            setPendingDrop(info); // ask which occurrences to apply this to
          } else {
            void performReschedule(info, "THIS_ONLY");
          }
        }}
      />

      {pendingDrop && (
        <div className="calendar-reschedule-confirm" role="alertdialog" aria-label="Confirm reschedule">
          <p>
            Reschedule <strong>{pendingDrop.event.title}</strong> to{" "}
            {formatLongDate((pendingDrop.event.start ?? new Date()).toISOString())}?
          </p>
          <p className="form-hint">This lesson is part of a recurring series. Apply this change to:</p>
          <div className="calendar-reschedule-confirm__actions">
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => { const info = pendingDrop; setPendingDrop(null); void performReschedule(info, "THIS_ONLY"); }}>This lesson only</button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => { const info = pendingDrop; setPendingDrop(null); void performReschedule(info, "THIS_AND_FUTURE"); }}>This and future lessons</button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => { const info = pendingDrop; setPendingDrop(null); void performReschedule(info, "ENTIRE_SERIES"); }}>Entire series</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={cancelDrop}>Cancel</button>
          </div>
        </div>
      )}

      {peekLesson && (
        <LessonPeekPanel
          lesson={{ ...toPeekLesson(peekLesson), canManage }}
          onClose={() => setPeekId(null)}
        />
      )}
    </div>
  );
}

function toPeekLesson(lesson: CalendarLesson): Omit<PeekLesson, "canManage"> {
  return {
    id: lesson.id, title: lesson.title, subject: lesson.subject, startAt: lesson.startAt,
    durationMinutes: lesson.durationMinutes, status: lesson.status, locationType: lesson.locationType,
    location: lesson.location, tutorName: lesson.tutorName, studentNames: lesson.studentNames,
    recurring: lesson.recurring, canJoin: lesson.canJoin, joinWindowOpen: lesson.joinWindowOpen,
    joinOpensAt: lesson.joinOpensAt,
  };
}
