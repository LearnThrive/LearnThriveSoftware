import { useRef, type RefObject } from 'react';
import type { Participant } from '../../shared/protocol';
import { usePopoverDismiss } from '../usePopoverDismiss';
import { Icon } from './Icon';

interface ParticipantPanelProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  selfName: string;
  selfAudio: boolean;
  selfVideo: boolean;
  selfHandRaised: boolean;
  peer: Participant | null;
  peerReconnecting: boolean;
}

export function ParticipantPanel({
  open, onClose, triggerRef, selfName, selfAudio, selfVideo, selfHandRaised, peer, peerReconnecting,
}: ParticipantPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, onClose, panelRef, triggerRef);

  if (!open) return null;

  return (
    <div className="participant-panel" ref={panelRef} role="menu" aria-label="Participants">
      <h2>People ({peer ? 2 : 1}/2)</h2>
      <ul>
        <li>
          <span className="participant-row-name">{selfName || 'You'} (You)</span>
          <span className="participant-row-state">
            {selfHandRaised && <Icon name="hand" size={14} />}
            <Icon name={selfAudio ? 'microphone' : 'microphone-off'} size={14} />
            <Icon name={selfVideo ? 'camera' : 'camera-off'} size={14} />
          </span>
        </li>
        {peer ? (
          <li>
            <span className="participant-row-name">{peer.name}{peerReconnecting ? ' — reconnecting…' : ''}</span>
            <span className="participant-row-state">
              {peer.handRaised && <Icon name="hand" size={14} />}
              <Icon name={peer.media.audio ? 'microphone' : 'microphone-off'} size={14} />
              <Icon name={peer.media.video ? 'camera' : 'camera-off'} size={14} />
            </span>
          </li>
        ) : (
          <li className="participant-row-empty">Waiting for another participant…</li>
        )}
      </ul>
    </div>
  );
}
