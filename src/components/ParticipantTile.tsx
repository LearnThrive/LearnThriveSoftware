import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

interface ParticipantTileProps {
  stream: MediaStream | null;
  name: string;
  audio: boolean;
  video: boolean;
  local?: boolean;
  compact?: boolean;
  preview?: boolean;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'Y';
}

export function ParticipantTile({ stream, name, audio, video, local = false, compact = false, preview = false }: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsPlayback, setNeedsPlayback] = useState(false);
  const hasVideo = video && Boolean(stream?.getVideoTracks().some(track => track.readyState === 'live'));

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.srcObject = stream;
    if (stream) {
      void element.play().then(() => setNeedsPlayback(false)).catch(() => {
        if (!local) setNeedsPlayback(true);
      });
    }
    return () => { element.srcObject = null; };
  }, [stream, local]);

  const enablePlayback = () => {
    void videoRef.current?.play().then(() => setNeedsPlayback(false)).catch(() => setNeedsPlayback(true));
  };

  return (
    <section className={`participant-tile ${local ? 'local-tile' : 'remote-tile'} ${compact ? 'compact-tile' : ''} ${preview ? 'preview-tile' : ''}`} aria-label={local ? 'Your camera preview' : `${name}'s video`}>
      <video ref={videoRef} className={`${local ? 'mirrored' : ''} ${hasVideo ? '' : 'video-hidden'}`} autoPlay playsInline muted={local} aria-label={local ? 'Your video' : `${name}'s video stream`} />
      {!hasVideo && <div className="camera-placeholder">
        <div className="avatar">{initials(name)}</div>
        {!compact && <><h2>{preview ? 'Your space to get ready' : name}</h2><p>{local ? 'Your camera is off' : 'Camera is off'}</p></>}
      </div>}
      {preview && <div className="preview-tag"><span /> Camera preview</div>}
      <div className="participant-caption">
        <span className="participant-name">{name || 'You'}{local && name !== 'You' ? ' (You)' : ''}</span>
        <span className="participant-media" aria-label={audio ? 'Microphone on' : 'Microphone off'} title={audio ? 'Microphone on' : 'Microphone off'}><Icon name={audio ? 'microphone' : 'microphone-off'} size={16} /></span>
        {!video && <span className="participant-camera-state sr-only">Camera off</span>}
      </div>
      {needsPlayback && !local && <button type="button" className="button playback-button" onClick={enablePlayback}><Icon name="volume" />Enable participant audio</button>}
    </section>
  );
}
