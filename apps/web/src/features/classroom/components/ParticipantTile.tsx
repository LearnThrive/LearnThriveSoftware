import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ParticipantRole, StaffTitle } from '@learnthrive/shared/protocol';
import { qualityLabel, type ConnectionQuality } from '../stats';
import { Icon } from './Icon';
import { RoleBadge } from './RoleBadge';

interface ParticipantTileProps {
  stream: MediaStream | null;
  name: string;
  audio: boolean;
  video: boolean;
  screenSharing?: boolean;
  local?: boolean;
  compact?: boolean;
  preview?: boolean;
  focused?: boolean;
  onFocus?: () => void;
  role?: ParticipantRole | null;
  /** A staff meeting: the person's real title, shown instead of Tutor/Student. */
  title?: StaffTitle;
  // Only ever passed for remote peers — a local tile has no connection to rate.
  quality?: ConnectionQuality;
  // Whether to play this person is no longer decided here: a tile only shows the picture (its <video> is always muted). Their sound, including
  // the tutor's lock on it (forceMuted), is played by components/RemoteAudio.tsx, which stays mounted when the stage changes.
  forceMuted?: boolean;
  /** This person's hand is up: the tile gets a coloured outline so the tutor sees who it is without opening the People list. */
  handRaised?: boolean;
  /** Given only to the tutor, for someone with a hand up: lowers it ("Lower hand", for when they have been helped). */
  onLowerHand?: () => void;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'Y';
}

export function ParticipantTile({
  stream, name, audio, video, screenSharing = false, local = false, compact = false, preview = false, focused, onFocus, role = null, title,
  quality, handRaised = false, onLowerHand,
}: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsPlayback, setNeedsPlayback] = useState(false);
  // A track can be live but "muted" (WebRTC's term for "not currently delivering data", e.g.
  // mid-negotiation or a transient network gap) — that shows nothing, so it must not be treated
  // as displayable video, or the tile would look broken instead of falling back to the placeholder.
  const [videoTrackMuted, setVideoTrackMuted] = useState(false);
  // A shared screen travels on its own track and is shown by the stage (components/ScreenStage.tsx), so this tile is always the camera.
  const liveVideoTrack = stream?.getVideoTracks().find(track => track.readyState === 'live');
  const hasVideo = video && Boolean(liveVideoTrack) && !videoTrackMuted;

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.srcObject = stream;
    const track = stream?.getVideoTracks()[0];
    setVideoTrackMuted(track?.muted ?? false);
    const onMuteChange = () => setVideoTrackMuted(track?.muted ?? false);
    track?.addEventListener('mute', onMuteChange);
    track?.addEventListener('unmute', onMuteChange);
    if (stream) {
      void element.play().then(() => setNeedsPlayback(false)).catch(() => {
        if (!local) setNeedsPlayback(true);
      });
    }
    return () => {
      element.srcObject = null;
      track?.removeEventListener('mute', onMuteChange);
      track?.removeEventListener('unmute', onMuteChange);
    };
  }, [stream, local]);

  const enablePlayback = () => {
    void videoRef.current?.play().then(() => setNeedsPlayback(false)).catch(() => setNeedsPlayback(true));
  };

  const clickable = Boolean(onFocus);
  const onKeyDown = clickable ? (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onFocus?.(); }
  } : undefined;

  return (
    <section
      className={`participant-tile ${local ? 'local-tile' : 'remote-tile'} ${compact ? 'compact-tile' : ''} ${preview ? 'preview-tile' : ''} ${screenSharing ? 'screen-share-tile' : ''} ${clickable ? 'focusable-tile' : ''} ${focused ? 'is-focused' : ''} ${handRaised ? 'hand-raised' : ''}`}
      aria-label={clickable ? `Make ${local ? 'your' : `${name}'s`} view the main view` : local ? 'Your camera preview' : `${name}'s video`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onFocus}
      onKeyDown={onKeyDown}
    >
      <video
        ref={videoRef} className={`${local ? 'mirrored' : ''} ${hasVideo ? '' : 'video-hidden'}`}
        autoPlay playsInline muted aria-label={local ? 'Your video' : `${name}'s video stream`}
      />
      {!hasVideo && <div className="camera-placeholder">
        <div className="avatar">{initials(name)}</div>
        {!compact && <><h2>{preview ? 'Your space to get ready' : name}{!preview && <RoleBadge role={role} title={title} />}</h2><p>{local ? 'Your camera is off' : videoTrackMuted && video ? 'Video is paused' : 'Camera is off'}</p></>}
      </div>}
      {preview && <div className="preview-tag"><span /> Camera preview</div>}
      {handRaised && (
        <div className="hand-badge">
          <span className="hand-badge__label"><Icon name="hand" size={13} />{local ? 'Your hand is up' : 'Hand raised'}</span>
          {onLowerHand && <button type="button" className="hand-badge__lower" onClick={(event) => { event.stopPropagation(); onLowerHand(); }}>Lower hand</button>}
        </div>
      )}
      {screenSharing && <div className="screen-share-badge"><Icon name="screen" size={14} />{local ? 'You are presenting' : `${name} is presenting`}</div>}
      {(quality === 'poor' || quality === 'fair') && (
        <div className={`connection-quality-badge connection-quality-${quality}`} role="status">
          <Icon name="info" size={13} />{qualityLabel(quality)} connection
        </div>
      )}
      {clickable && <span className="focus-affordance"><Icon name="expand" size={14} />Make main view</span>}
      <div className="participant-caption">
        <span className="participant-name">{name || 'You'}{local && name !== 'You' ? ' (You)' : ''}</span>
        <span className="participant-media" role="img" aria-label={audio ? 'Microphone on' : 'Microphone off'} title={audio ? 'Microphone on' : 'Microphone off'}><Icon name={audio ? 'microphone' : 'microphone-off'} size={16} /></span>
        {!video && <span className="participant-camera-state sr-only">Camera off</span>}
      </div>
      {needsPlayback && !local && <button type="button" className="button playback-button" onClick={(event) => { event.stopPropagation(); enablePlayback(); }}><Icon name="volume" />Click to enable audio</button>}
    </section>
  );
}
