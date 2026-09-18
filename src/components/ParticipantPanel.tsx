import { useRef, type RefObject } from 'react';
import { MAX_PARTICIPANTS, type ParticipantRole } from '../../shared/protocol';
import type { RemotePeer } from '../meeting';
import { usePopoverDismiss } from '../usePopoverDismiss';
import { Icon } from './Icon';
import { RoleBadge } from './RoleBadge';

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
  onMuteParticipant: (id: string) => void;
  onAllowUnmute: (id: string) => void;
  onRemoveParticipant: (id: string) => void;
  onLowerHand: (id: string) => void;
  onStopShare: (id: string) => void;
}

export function ParticipantPanel({
  open, onClose, triggerRef, selfName, selfRole, selfAudio, selfVideo, selfHandRaised, peers,
  onMuteParticipant, onAllowUnmute, onRemoveParticipant, onLowerHand, onStopShare,
}: ParticipantPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, onClose, panelRef, triggerRef);
  const isTutor = selfRole === 'tutor';

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
            {isTutor && participant.role === 'student' && (
              <span className="participant-row-actions">
                {participant.screenSharing && (
                  <button type="button" className="participant-row-action" onClick={() => onStopShare(participant.id)} aria-label={`Stop ${participant.name}'s screen share`} title="Stop share">
                    <Icon name="screen-off" size={13} />
                  </button>
                )}
                {participant.handRaised && (
                  <button type="button" className="participant-row-action" onClick={() => onLowerHand(participant.id)} aria-label={`Lower ${participant.name}'s hand`} title="Lower hand">
                    <Icon name="hand" size={13} />
                  </button>
                )}
                {participant.forceMuted ? (
                  <button type="button" className="participant-row-action" onClick={() => onAllowUnmute(participant.id)} aria-label={`Allow ${participant.name} to unmute`} title="Allow to unmute">
                    <Icon name="microphone" size={13} />
                  </button>
                ) : (
                  <button type="button" className="participant-row-action" onClick={() => onMuteParticipant(participant.id)} aria-label={`Mute ${participant.name}`} title="Mute">
                    <Icon name="microphone-off" size={13} />
                  </button>
                )}
                <button type="button" className="participant-row-action participant-row-action-danger" onClick={() => onRemoveParticipant(participant.id)} aria-label={`Remove ${participant.name} from class`} title="Remove">
                  <Icon name="user-x" size={13} />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
