"use client";

import Link from "next/link";
import { Lock, Video, X } from "lucide-react";
import { joinMeetingAction } from "@/lib/actions/meetings";
import { formatLongDate, formatRelative, formatTimeRange } from "@/lib/format";

export interface PeekMeeting {
  id: string;
  title: string;
  startsAt: string;
  durationMinutes: number;
  hostName: string;
  people: string[];
  youHost: boolean;
  /** The same rule as the Meetings page: a host may join 30 minutes before, an invitee 10. */
  joinOpen: boolean;
  joinOpensAt: string;
}

/** The calendar's side panel for a staff meeting (docs/STAFF_MEETINGS.md): what it is, who is in it, and a Join button when it is open. */
export function MeetingPeekPanel({ meeting, onClose }: { meeting: PeekMeeting; onClose: () => void }) {
  return (
    <div className="lesson-peek" role="dialog" aria-modal="true" aria-labelledby="meeting-peek-title">
      <button type="button" className="lesson-peek__scrim" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div className="lesson-peek__panel">
        <header className="lesson-peek__header">
          <div>
            <p className="lesson-peek__eyebrow">Staff meeting</p>
            <h2 className="lesson-peek__title" id="meeting-peek-title">{meeting.title}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close panel"><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="lesson-peek__meta">
          <span className="badge badge--info">Meeting</span>
          {meeting.youHost && <span className="badge badge--muted">You host</span>}
        </div>
        <dl className="detail-list">
          <div><dt>Host</dt><dd>{meeting.hostName}</dd></div>
          <div><dt>With</dt><dd>{meeting.people.join(", ") || "Nobody else"}</dd></div>
          <div><dt>Date</dt><dd>{formatLongDate(meeting.startsAt)}</dd></div>
          <div><dt>Time</dt><dd>{formatTimeRange(meeting.startsAt, meeting.durationMinutes)}</dd></div>
          <div><dt>Where</dt><dd>Online meeting room</dd></div>
        </dl>
        <div className="lesson-peek__actions">
          {meeting.joinOpen ? (
            <form action={joinMeetingAction}>
              <input type="hidden" name="meetingId" value={meeting.id} />
              <button type="submit" className="btn btn--primary btn--block"><Video size={16} aria-hidden="true" />Join meeting</button>
            </form>
          ) : (
            <span className="btn btn--secondary btn--block" aria-disabled="true"><Lock size={15} aria-hidden="true" />Opens {formatRelative(meeting.joinOpensAt)}</span>
          )}
          <Link href="/dashboard/meetings" className="btn btn--secondary btn--block">All meetings</Link>
        </div>
      </div>
    </div>
  );
}
