import { useRef, type RefObject } from 'react';
import type { WaitingParticipant } from '@learnthrive/shared/protocol';
import { usePopoverDismiss } from '../usePopoverDismiss';
import { Icon } from './Icon';

interface WaitingRoomPanelProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  waiting: WaitingParticipant[];
  onAdmit: (id: string) => void;
  onAdmitAll: () => void;
  onDeny: (id: string) => void;
}

// Tutor-only: capacity itself is enforced server-side, so this stays a thin trigger — the only
// client-side gate is "is there anyone waiting to admit at all."
export function WaitingRoomPanel({ open, onClose, triggerRef, waiting, onAdmit, onAdmitAll, onDeny }: WaitingRoomPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, onClose, panelRef, triggerRef);

  if (!open) return null;

  return (
    <div className="waiting-room-panel" ref={panelRef} role="menu" aria-label="Waiting room">
      <div className="waiting-room-header">
        <h2>Waiting room ({waiting.length})</h2>
        <button type="button" className="button-secondary" onClick={onAdmitAll} disabled={waiting.length === 0}>Admit all</button>
      </div>
      {waiting.length === 0 ? (
        <p className="participant-row-empty">No one is waiting right now.</p>
      ) : (
        <ul>
          {waiting.map((entry) => (
            <li key={entry.id}>
              <span className="participant-row-name">{entry.name}</span>
              <span className="waiting-room-actions">
                <button type="button" className="button-secondary" onClick={() => onAdmit(entry.id)} aria-label={`Admit ${entry.name}`}><Icon name="check" size={14} />Admit</button>
                <button type="button" className="button-secondary waiting-room-deny" onClick={() => onDeny(entry.id)} aria-label={`Deny ${entry.name}`}><Icon name="close" size={14} />Deny</button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
