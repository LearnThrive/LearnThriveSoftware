import { useRef, type RefObject } from 'react';
import { MAX_PARTICIPANTS, type ParticipantRole } from '../../shared/protocol';
import type { RemotePeer } from '../meeting';
import { usePopoverDismiss } from '../usePopoverDismiss';
import { Icon } from './Icon';

interface ParticipantPanelProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  selfName: string;
  selfRole: ParticipantRole | null;
  selfAudio: boolean;
  selfVideo: boolean;
  selfHandRaised: boolean;
  peers: RemotePeer[];
}

function RoleBadge({ role }: { role: ParticipantRole | null }) {
  if (!role) return null;
  return <span className={`role-badge role-badge-${role}`}>{role === 'tutor' ? 'Tutor' : 'Student'}</span>;
}

export function ParticipantPanel({
  open, onClose, triggerRef, selfName, selfRole, selfAudio, selfVideo, selfHandRaised, peers,
}: ParticipantPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, onClose, panelRef, triggerRef);

  if (!open) return null;

  return (
    <div className="participant-panel" ref={panelRef} role="menu" aria-label="Participants">
      <h2>People ({1 + peers.length}/{MAX_PARTICIPANTS})</h2>
      <ul>
        <li>
          <span className="participant-row-name">{selfName || 'You'} (You)<RoleBadge role={selfRole} /></span>
          <span className="participant-row-state">
            {selfHandRaised && <span aria-label="Hand raised" title="Hand raised"><Icon name="hand" size={14} /></span>}
            <Icon name={selfAudio ? 'microphone' : 'microphone-off'} size={14} />
            <Icon name={selfVideo ? 'camera' : 'camera-off'} size={14} />
          </span>
        </li>
        {peers.length === 0 && <li className="participant-row-empty">Waiting for participants…</li>}
        {peers.map(({ participant, reconnecting }) => (
          <li key={participant.id}>
            <span className="participant-row-name">{participant.name}{reconnecting ? ' — reconnecting…' : ''}<RoleBadge role={participant.role} /></span>
            <span className="participant-row-state">
              {participant.handRaised && <span aria-label="Hand raised" title="Hand raised"><Icon name="hand" size={14} /></span>}
              <Icon name={participant.media.audio ? 'microphone' : 'microphone-off'} size={14} />
              <Icon name={participant.media.video ? 'camera' : 'camera-off'} size={14} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
