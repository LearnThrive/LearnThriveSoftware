import { useEffect, useReducer } from 'react';
import { Icon } from './Icon';

export interface HelpQueueEntry { id: string; name: string; handRaisedAt: number }

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// Tutor-only, auto-surfacing whenever at least one hand is raised (same pattern as the poll and
// understanding-check banners) — builds on the existing raise-hand feature rather than adding a
// separate signal, ordered by time raised so the longest-waiting student is always first.
export function HelpQueuePanel({ entries, onMarkHelped }: { entries: HelpQueueEntry[]; onMarkHelped: (id: string) => void }) {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (entries.length === 0) return;
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [entries.length]);

  if (entries.length === 0) return null;
  const sorted = [...entries].sort((a, b) => a.handRaisedAt - b.handRaisedAt);

  return (
    <section className="help-queue-panel" aria-label="Help queue">
      <div className="poll-panel-header">
        <span className="poll-panel-label"><Icon name="hand" size={14} />Help queue ({sorted.length})</span>
      </div>
      <ul>
        {sorted.map((entry, index) => (
          <li key={entry.id}>
            <span className="help-queue-position">{index + 1}. {entry.name}</span>
            <span className="help-queue-elapsed">{formatElapsed(Date.now() - entry.handRaisedAt)}</span>
            <button type="button" className="inline-action" onClick={() => onMarkHelped(entry.id)}>Mark as helped</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
