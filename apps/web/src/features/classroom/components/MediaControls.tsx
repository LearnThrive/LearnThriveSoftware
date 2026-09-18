import { Icon } from './Icon';

interface MediaControlsProps {
  audio: boolean;
  video: boolean;
  disabled?: boolean;
  onAudio: () => void;
  onVideo: () => void;
  inCall?: boolean;
  forceMuted?: boolean;
}

export function MediaControls({ audio, video, disabled = false, onAudio, onVideo, inCall = false, forceMuted = false }: MediaControlsProps) {
  return <>
    <div className="control-item"><button type="button" className={`media-button ${audio ? 'is-on' : 'is-off'} ${forceMuted ? 'is-force-muted' : ''}`} aria-label={forceMuted ? 'Muted by the tutor' : `Turn microphone ${audio ? 'off' : 'on'}`} aria-pressed={audio} disabled={disabled} onClick={onAudio}><Icon name={audio ? 'microphone' : 'microphone-off'} size={22} /></button><span>{forceMuted ? 'Muted by tutor' : inCall ? (audio ? 'Mute' : 'Unmute') : (audio ? 'Mic on' : 'Mic off')}</span></div>
    <div className="control-item"><button type="button" className={`media-button ${video ? 'is-on' : 'is-off'}`} aria-label={`Turn camera ${video ? 'off' : 'on'}`} aria-pressed={video} disabled={disabled} onClick={onVideo}><Icon name={video ? 'camera' : 'camera-off'} size={22} /></button><span>{inCall ? (video ? 'Stop video' : 'Start video') : (video ? 'Camera on' : 'Camera off')}</span></div>
  </>;
}
