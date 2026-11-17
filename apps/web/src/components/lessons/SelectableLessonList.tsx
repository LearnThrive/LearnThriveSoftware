"use client";

import { useEffect, useRef, useState } from "react";
import { XCircle } from "lucide-react";
import type { Lesson } from "@learnthrive/data/domain";
import { LessonList, LessonRow } from "@/components/lessons/LessonRow";

/**
 * The administrator's Lessons list with tick boxes: tick some lessons, or "Select all", and cancel them together. Only planned lessons can be
 * cancelled, so only those have a box, and "Select all" means every planned lesson under the current filter. Cancelling asks first and takes an
 * optional reason; each lesson stays on record as cancelled (nothing is deleted). The action itself re-checks the administrator role.
 */
export function SelectableLessonList({ rows, showRelative, filter, action }: {
  rows: ReadonlyArray<{ lesson: Lesson; subtitle: string }>;
  showRelative: boolean;
  filter: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const selectable = rows.filter((row) => row.lesson.status === "PLANNED").map((row) => row.lesson.id);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const allBox = useRef<HTMLInputElement>(null);

  const count = selected.size;
  const allSelected = selectable.length > 0 && count === selectable.length;
  useEffect(() => {
    // "Some but not all": the box shows a dash.
    if (allBox.current) allBox.current.indeterminate = count > 0 && !allSelected;
  }, [count, allSelected]);

  function toggle(id: string, on: boolean) {
    setConfirming(false);
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  return (
    <form action={action}>
      <input type="hidden" name="filter" value={filter} />
      {selectable.length > 0 && (
        <div className="lesson-bulk">
          <label className="lesson-bulk__all">
            <input
              ref={allBox}
              type="checkbox"
              checked={allSelected}
              onChange={(event) => { setConfirming(false); setSelected(event.target.checked ? new Set(selectable) : new Set()); }}
            />
            Select all ({selectable.length})
          </label>
          <p className="lesson-bulk__count" aria-live="polite">{count === 0 ? "None selected" : `${count} selected`}</p>
          <span className="lesson-bulk__spacer" />
          {count > 0 && !confirming && (
            <>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelected(new Set())}>Clear</button>
              <button type="button" className="btn btn--danger btn--sm" onClick={() => setConfirming(true)}>
                <XCircle size={15} aria-hidden="true" />Cancel {count === 1 ? "1 lesson" : `${count} lessons`}
              </button>
            </>
          )}
          {count > 0 && confirming && (
            <div className="lesson-bulk__confirm" role="group" aria-label="Confirm cancelling the selected lessons">
              <div className="field">
                <label className="field__label" htmlFor="bulk-cancel-reason">
                  Reason for cancelling {count === 1 ? "this lesson" : `these ${count} lessons`}<span className="field__optional">Optional</span>
                </label>
                <input id="bulk-cancel-reason" name="reason" placeholder="Tutor unavailable" autoComplete="off" />
              </div>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirming(false)}>Keep them</button>
              <button type="submit" className="btn btn--danger btn--sm">Yes, cancel {count === 1 ? "1 lesson" : `${count} lessons`}</button>
            </div>
          )}
        </div>
      )}
      <LessonList>
        {rows.map(({ lesson, subtitle }) => (
          <LessonRow
            key={lesson.id}
            lesson={lesson}
            subtitle={subtitle}
            showRelative={showRelative}
            leading={lesson.status === "PLANNED" ? (
              <span className="lesson-row__select">
                <input
                  type="checkbox"
                  name="lessonId"
                  value={lesson.id}
                  checked={selected.has(lesson.id)}
                  onChange={(event) => toggle(lesson.id, event.target.checked)}
                  aria-label={`Select ${lesson.title}`}
                />
              </span>
            ) : (
              <span className="lesson-row__select" aria-hidden="true"><span style={{ width: "1.1rem" }} /></span>
            )}
          />
        ))}
      </LessonList>
    </form>
  );
}
