import { orderRail, type RailEntry } from './railOrder';

export type { RailEntry };

/**
 * The cameras beside the shared screen or the whiteboard: one column, every tile the same size, students on top and the tutor below. It is the
 * same in both modes so the room does not rearrange itself when the stage changes. With many people the column scrolls.
 */
export function StageRail({ entries }: { entries: RailEntry[] }) {
  return (
    <div className="stage-rail" role="group" aria-label="Participants">
      {orderRail(entries).map((entry) => <div key={entry.key} className="stage-rail__item">{entry.tile}</div>)}
    </div>
  );
}
