"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventDropArg } from "@fullcalendar/core";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { rescheduleLessonAction } from "@/lib/actions/lessons";

export interface CalendarLesson {
  id: string;
  title: string;
  startAt: string; // UTC ISO instant
  durationMinutes: number;
  status: string;
  recurring: boolean;
}

// Plan section 63: a configurable visible-hours window (morning through evening) rather than
// hiding legitimate out-of-hours lessons entirely — 07:00-21:00 covers ordinary tutoring hours
// without being so wide the week/day views are mostly empty space.
const SLOT_MIN_TIME = "07:00:00";
const SLOT_MAX_TIME = "21:00:00";

type RescheduleScope = "THIS_ONLY" | "THIS_AND_FUTURE" | "ENTIRE_SERIES";

export function CalendarView({ lessons, canDragReschedule }: { lessons: CalendarLesson[]; canDragReschedule: boolean }) {
  const router = useRouter();
  const [pendingDrop, setPendingDrop] = useState<EventDropArg | null>(null);

  const events = lessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.status === "CANCELLED" ? `Cancelled: ${lesson.title}` : lesson.title,
    start: lesson.startAt,
    end: new Date(new Date(lesson.startAt).getTime() + lesson.durationMinutes * 60_000).toISOString(),
    classNames: [`lesson-status-${lesson.status.toLowerCase()}`],
    editable: canDragReschedule && lesson.status === "PLANNED",
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

  return (
    <div className="calendar-wrap">
      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek" }}
        events={events}
        editable={canDragReschedule}
        eventStartEditable={canDragReschedule}
        eventDurationEditable={false}
        slotMinTime={SLOT_MIN_TIME}
        slotMaxTime={SLOT_MAX_TIME}
        timeZone="Europe/London"
        firstDay={1}
        height="auto"
        eventClick={(info) => router.push(`/dashboard/lessons/${info.event.id}`)}
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
            {(pendingDrop.event.start ?? new Date()).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })}?
          </p>
          <p>This lesson is part of a recurring series. Apply this change to:</p>
          <div className="calendar-reschedule-confirm__actions">
            <button type="button" className="button-secondary" onClick={() => { const info = pendingDrop; setPendingDrop(null); void performReschedule(info, "THIS_ONLY"); }}>This lesson only</button>
            <button type="button" className="button-secondary" onClick={() => { const info = pendingDrop; setPendingDrop(null); void performReschedule(info, "THIS_AND_FUTURE"); }}>This and future lessons</button>
            <button type="button" className="button-secondary" onClick={() => { const info = pendingDrop; setPendingDrop(null); void performReschedule(info, "ENTIRE_SERIES"); }}>Entire series</button>
            <button type="button" className="button-text" onClick={cancelDrop}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
