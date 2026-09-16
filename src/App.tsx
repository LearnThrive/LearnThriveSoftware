import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_NAME_LENGTH, ROOM_PATTERN } from '../shared/protocol';
import { useMeeting } from './useMeeting';
import { canShareScreen } from './screenShare';
import { qualityLabel } from './stats';
import { Icon } from './components/Icon';
import { MediaControls } from './components/MediaControls';
import { ParticipantTile } from './components/ParticipantTile';
import { ChatPanel } from './components/ChatPanel';
import { DeviceMenu } from './components/DeviceMenu';
import { MeetingTimer } from './components/Timer';
import { MicLevelMeter } from './components/MicLevelMeter';

function Brand() {
  return <div className="brand" aria-label="LearnThrive Tuition"><img src="/brand/learnthrive-mark.png" alt="" /><div className="wordmark">Learn<span>Thrive</span><small>TUITION</small></div></div>;
}

function candidatePathLabel(local: string | null, remote: string | null) {
  if (!local && !remote) return 'Unknown';
  if (local === 'relay' || remote === 'relay') return 'Relay (TURN)';
  if (local === 'host' && remote === 'host') return 'Direct';
  return 'Reflexive (STUN)';
}

function App() {
  const {
    snapshot, prepareMedia, toggleAudio, toggleVideo, toggleScreenShare, toggleChat, sendChatMessage,
    switchCamera, switchMicrophone, flipCamera, join, leave, reset, copyInvite, retryConnection,
  } = useMeeting();
  const [name, setName] = useState('');
  const [room, setRoom] = useState(() => new URLSearchParams(window.location.search).get('room')?.trim().toLowerCase() || '');
  const [created, setCreated] = useState(false);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const inCall = snapshot.phase === 'meeting';
  const ended = snapshot.phase === 'ended';
  const joining = snapshot.phase === 'joining';
  const roomValid = ROOM_PATTERN.test(room.trim());
  const nameValid = name.trim().length > 0 && name.trim().length <= MAX_NAME_LENGTH;
  const debug = import.meta.env.DEV && new URLSearchParams(window.location.search).get('debug') === '1';
  const fullscreenSupported = typeof document !== 'undefined' && document.fullscreenEnabled;
  const screenShareSupported = canShareScreen();

  const createMeeting = () => {
    const generatedRoom = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('');
    setRoom(generatedRoom);
    setCreated(true);
    const url = new URL(window.location.href);
    url.searchParams.set('room', generatedRoom);
    window.history.replaceState(null, '', url);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (roomValid && nameValid && !joining) void join(name.trim(), room.trim());
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  };

  useEffect(() => {
    if (!fullscreenSupported) return;
    const onChange = () => setIsFullscreen(document.fullscreenElement != null && document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [fullscreenSupported]);

  useEffect(() => {
    if (!inCall) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key.toLowerCase()) {
        case 'm': toggleAudio(); break;
        case 'v': toggleVideo(); break;
        case 'c': toggleChat(); break;
        case 's': if (screenShareSupported) void toggleScreenShare(); break;
        default: return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inCall, screenShareSupported, toggleAudio, toggleVideo, toggleChat, toggleScreenShare]);

  const tracks = (stream: MediaStream | null) => stream?.getTracks().map(track => `${track.kind}: ${track.enabled ? 'enabled' : 'disabled'} / ${track.readyState}`).join(', ') || 'None';
  const lossPercent = snapshot.stats && snapshot.stats.packetsLost != null && snapshot.stats.packetsReceived != null && (snapshot.stats.packetsLost + snapshot.stats.packetsReceived) > 0
    ? `${((snapshot.stats.packetsLost / (snapshot.stats.packetsLost + snapshot.stats.packetsReceived)) * 100).toFixed(1)}%` : 'n/a';
  const activeCameraLabel = snapshot.cameras.find(c => c.deviceId === snapshot.selectedCamera)?.label ?? 'Default';
  const activeMicLabel = snapshot.microphones.find(m => m.deviceId === snapshot.selectedMicrophone)?.label ?? 'Default';

  return <div className={`app ${inCall ? 'call-app' : ''}`}>
    <a className="skip-link" href="#main-content">Skip to meeting</a>
    <header className="site-header">
      <Brand />
      <div className="header-context"><span className="header-divider" />{inCall ? 'Your classroom' : 'Online classroom'}<span className="prototype-badge">Preview</span></div>
      <div className="header-note"><Icon name="people" size={17} /><span>A space for two</span></div>
    </header>

    <main id="main-content" className={inCall ? 'call-main' : 'prejoin-main'}>
      {ended ? <section className="ended-panel">
        <div className="ended-icon"><Icon name="check" size={34} /></div>
        <p className="eyebrow">UNTIL NEXT TIME</p>
        <h1>You’ve left the meeting.</h1>
        <p>Your camera and microphone are off.<br />You can return whenever you’re ready.</p>
        <button className="button button-primary" type="button" onClick={reset}>Back to meeting setup<Icon name="arrow" /></button>
        <div className="ended-footer">A little learning. A little growing. LearnThrive.</div>
      </section> : inCall ? <>
        <div className="meeting-heading">
          <div>
            <div className="meeting-title-line">
              <h1>Your meeting</h1>
              <span className="participant-count"><Icon name="people" size={15} />{snapshot.peer ? '2' : '1'} / 2</span>
              <MeetingTimer connectedAt={snapshot.connection === 'connected' ? snapshot.connectedAt : null} />
            </div>
            <p className="room-display">Room <span>{snapshot.roomId}</span></p>
          </div>
          <div className="meeting-heading-status">
            {snapshot.connection === 'connected' && snapshot.quality !== 'unknown' && <span className={`quality-pill quality-${snapshot.quality}`}>Connection: {qualityLabel(snapshot.quality)}</span>}
            <div className={`connection-pill ${snapshot.connection === 'connected' ? 'connected' : ''}`} role="status"><span className="status-dot" />{snapshot.status}</div>
          </div>
        </div>
        {snapshot.peerReconnecting && <p className="peer-reconnecting" role="status"><span className="status-dot" />{snapshot.peer?.name ?? 'The other participant'} is reconnecting…</p>}
        {snapshot.notice && <div className="participant-toast" role="status" key={snapshot.notice.id}>{snapshot.notice.text}</div>}
        <div className="call-body">
          <div className="meeting-stage" ref={stageRef}>
            {snapshot.peer
              ? <ParticipantTile
                  stream={snapshot.remoteStream} name={snapshot.peer.name} audio={snapshot.peer.media.audio}
                  video={snapshot.peer.media.video} screenSharing={snapshot.peer.screenSharing}
                />
              : <section className="waiting-tile" aria-label="Waiting for another participant">
                <div className="waiting-orbit"><div className="waiting-icon"><Icon name="people" size={34} /></div></div>
                <p className="eyebrow">YOUR CLASSROOM IS READY</p><h2>A little company,<br />a lot of possibility.</h2>
                <p className="waiting-description">Share your invite link to bring the<br className="desktop-break" /> other participant into the meeting.</p>
                <button className="button button-mint" type="button" onClick={() => void copyInvite()} aria-label="Copy invite link"><Icon name={snapshot.copied ? 'check' : 'link'} />{snapshot.copied ? 'Invite link copied' : 'Copy invite link'}</button>
              </section>}
            <div className="self-preview"><ParticipantTile stream={snapshot.localStream} name={snapshot.name || name || 'You'} audio={snapshot.audio} video={snapshot.video} screenSharing={snapshot.screenSharing} local compact /></div>
            <span className="stage-caption"><span /> Learn together. Thrive together.</span>
            {fullscreenSupported && <button type="button" className="stage-fullscreen" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}><Icon name={isFullscreen ? 'collapse' : 'expand'} size={17} /></button>}
          </div>
          <ChatPanel messages={snapshot.messages} open={snapshot.chatOpen} onClose={toggleChat} onSend={sendChatMessage} />
        </div>
        {(snapshot.error || snapshot.mediaError) && <div className="notice notice-error" role="alert"><Icon name="info" /><span>{snapshot.error || snapshot.mediaError}</span>{(snapshot.connection === 'failed' || snapshot.reconnectFailed) && <button className="inline-action" type="button" onClick={retryConnection}>Reconnect</button>}</div>}
        <div className="call-bottom">
          <p className="call-note"><Icon name="shield" size={17} />This session is not recorded.</p>
          <div className="call-controls" aria-label="Meeting controls">
            <MediaControls audio={snapshot.audio} video={snapshot.video} onAudio={() => void toggleAudio()} onVideo={() => void toggleVideo()} disabled={snapshot.preparing} inCall />
            <div className="control-item device-menu-anchor">
              <button type="button" className="media-button" onClick={() => setDeviceMenuOpen(open => !open)} aria-label="Camera and microphone options" aria-haspopup="menu" aria-expanded={deviceMenuOpen}><Icon name="settings" size={20} /></button>
              <span>Devices</span>
              <DeviceMenu
                open={deviceMenuOpen} onClose={() => setDeviceMenuOpen(false)} cameras={snapshot.cameras} microphones={snapshot.microphones}
                selectedCamera={snapshot.selectedCamera} selectedMicrophone={snapshot.selectedMicrophone}
                onSelectCamera={(id) => void switchCamera(id)} onSelectMicrophone={(id) => void switchMicrophone(id)}
                canFlip={snapshot.cameras.length > 1} onFlip={() => void flipCamera()}
              />
            </div>
            <span className="controls-divider" />
            {screenShareSupported && <div className="control-item"><button type="button" className={`media-button ${snapshot.screenSharing ? 'is-on' : ''}`} onClick={() => void toggleScreenShare()} aria-pressed={snapshot.screenSharing} aria-label={snapshot.screenSharing ? 'Stop sharing your screen' : 'Share your screen'}><Icon name={snapshot.screenSharing ? 'screen-off' : 'screen'} size={21} /></button><span>{snapshot.screenSharing ? 'Stop sharing' : 'Share screen'}</span></div>}
            <div className="control-item"><button type="button" className={`media-button ${snapshot.chatOpen ? 'is-on' : ''}`} onClick={toggleChat} aria-pressed={snapshot.chatOpen} aria-label="Toggle chat">
              <Icon name="chat" size={21} />{snapshot.unreadCount > 0 && !snapshot.chatOpen && <span className="unread-badge">{snapshot.unreadCount > 9 ? '9+' : snapshot.unreadCount}</span>}
            </button><span>Chat</span></div>
            <span className="controls-divider" />
            {!snapshot.peer && <div className="control-item"><button type="button" className="media-button invite-control" onClick={() => void copyInvite()} aria-label="Copy invite link"><Icon name={snapshot.copied ? 'check' : 'link'} size={22} /></button><span>{snapshot.copied ? 'Copied' : 'Invite'}</span></div>}
            <div className="control-item"><button type="button" className="media-button leave-control" onClick={leave} aria-label="Leave meeting"><Icon name="leave" size={23} /></button><span>Leave</span></div>
          </div>
          <div className="call-bottom-spacer" />
        </div>
      </> : <>
        <div className="welcome-heading"><p className="eyebrow"><span /> YOUR LEARNING SPACE</p><h1>Ready when you are.</h1><p>A familiar face. A fresh perspective. Let’s connect.</p></div>
        <div className="prejoin-grid">
          <section className="preview-panel" aria-label="Camera and microphone setup">
            <ParticipantTile stream={snapshot.localStream} name={name.trim() || 'You'} audio={snapshot.audio} video={snapshot.video} local preview />
            <div className="preview-controls">
              <div className="device-status">
                <span className={`device-dot ${snapshot.localStream ? 'ready' : ''}`} /><span>{snapshot.preparing ? 'Preparing camera…' : snapshot.localStream ? 'You’re in control' : 'Camera & mic are off'}</span>
                <MicLevelMeter stream={snapshot.localStream} active={snapshot.audio} />
              </div>
              <div className="preview-buttons">
                <MediaControls audio={snapshot.audio} video={snapshot.video} disabled={snapshot.preparing || joining} onAudio={() => void toggleAudio()} onVideo={() => void toggleVideo()} />
                <div className="control-item device-menu-anchor">
                  <button type="button" className="media-button" onClick={() => setDeviceMenuOpen(open => !open)} aria-label="Camera and microphone options" aria-haspopup="menu" aria-expanded={deviceMenuOpen}><Icon name="settings" size={20} /></button>
                  <span>Devices</span>
                  <DeviceMenu
                    open={deviceMenuOpen} onClose={() => setDeviceMenuOpen(false)} cameras={snapshot.cameras} microphones={snapshot.microphones}
                    selectedCamera={snapshot.selectedCamera} selectedMicrophone={snapshot.selectedMicrophone}
                    onSelectCamera={(id) => void switchCamera(id)} onSelectMicrophone={(id) => void switchMicrophone(id)}
                    canFlip={snapshot.cameras.length > 1} onFlip={() => void flipCamera()}
                  />
                </div>
              </div>
            </div>
            <div className="permission-note"><Icon name="shield" size={19} /><p>Your preview is only visible to you.<br />Your camera and microphone stay off until you enable them.</p></div>
          </section>
          <section className="join-panel" aria-labelledby="join-heading">
            <div className="join-panel-top"><h2 id="join-heading">Make yourself at home.</h2><p>Check your details before stepping in.</p></div>
            <form onSubmit={submit}>
              <div className="field"><label htmlFor="display-name">Your name</label><input id="display-name" name="displayName" placeholder="e.g. Alex Taylor" value={name} onChange={event => setName(event.target.value)} maxLength={MAX_NAME_LENGTH} autoComplete="given-name" disabled={joining} required /><span className="field-hint">How you’ll appear in the meeting</span></div>
              <div className="field"><label htmlFor="room-code">Room code</label><input id="room-code" className="room-input" name="roomCode" placeholder="Enter a room code" value={room} onChange={event => { setRoom(event.target.value.toLowerCase()); setCreated(false); }} minLength={8} maxLength={48} pattern="[a-z0-9][a-z0-9\-]{7,47}" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={joining} aria-describedby="room-hint" required /><span className="field-hint" id="room-hint">{created ? 'Your room is ready. Copy the link to invite someone.' : room.length > 0 && !roomValid ? 'Use 8–48 lowercase letters, numbers or hyphens.' : 'Use a shared code, or create a new meeting below.'}</span></div>
              {(snapshot.error || snapshot.mediaError) && <div className="notice notice-error" role="alert"><Icon name="info" size={18} /><span>{snapshot.error || snapshot.mediaError}</span></div>}
              <button type="button" className="button button-permission" onClick={() => void prepareMedia()} disabled={snapshot.preparing || joining}><Icon name="camera" size={19} />{snapshot.preparing ? 'Preparing camera…' : snapshot.localStream ? 'Check camera & microphone' : 'Enable camera & microphone'}</button>
              <button type="submit" className="button button-primary join-button" disabled={!roomValid || !nameValid || joining}>{joining ? 'Joining meeting…' : 'Join meeting'}<Icon name="arrow" /></button>
              <p className="join-footnote">You can also join with your camera and mic off.</p>
            </form>
            <div className="new-meeting"><span>Starting something new?</span><button type="button" className="button button-secondary" onClick={createMeeting} disabled={joining}><Icon name="plus" size={18} />Create meeting</button></div>
            {roomValid && <button type="button" className="copy-room-link" aria-label="Copy invite link" onClick={() => void copyInvite(room.trim())}><Icon name={snapshot.copied ? 'check' : 'link'} size={16} />{snapshot.copied ? 'Invite link copied' : 'Copy invite link'}</button>}
          </section>
        </div>
        <div className="prejoin-status" role="status"><span className="status-dot" />{snapshot.status}</div>
      </>}

      {snapshot.copied && inCall && <div className="toast" role="status"><Icon name="check" size={18} />Invite link copied</div>}
      {debug && <details className="diagnostics"><summary>Development diagnostics</summary><dl>
        <dt>Room</dt><dd>{snapshot.roomId || room || 'Not joined'}</dd>
        <dt>Participants</dt><dd>{snapshot.peer ? 2 : 1} / 2</dd>
        <dt>Signalling server</dt><dd>{snapshot.signalling}</dd>
        <dt>Reconnect state</dt><dd>{snapshot.peerReconnecting ? 'peer reconnecting' : snapshot.reconnectFailed ? 'unable to reconnect' : 'stable'}</dd>
        <dt>WebRTC connection</dt><dd>{snapshot.connection}</dd>
        <dt>ICE connection</dt><dd>{snapshot.ice}</dd>
        <dt>RTC signalling</dt><dd>{snapshot.rtcSignalling}</dd>
        <dt>Candidate path</dt><dd>{candidatePathLabel(snapshot.stats?.localCandidateType ?? null, snapshot.stats?.remoteCandidateType ?? null)} (local {snapshot.stats?.localCandidateType ?? 'n/a'}, remote {snapshot.stats?.remoteCandidateType ?? 'n/a'})</dd>
        <dt>RTT</dt><dd>{snapshot.stats?.rtt != null ? `${snapshot.stats.rtt} ms` : 'n/a'}</dd>
        <dt>Jitter</dt><dd>{snapshot.stats?.jitter != null ? `${snapshot.stats.jitter} ms` : 'n/a'}</dd>
        <dt>Packet loss</dt><dd>{lossPercent}</dd>
        <dt>Bitrate</dt><dd>in {snapshot.stats?.inboundBitrateKbps ?? 'n/a'} kbps / out {snapshot.stats?.outboundBitrateKbps ?? 'n/a'} kbps</dd>
        <dt>Frame rate / resolution</dt><dd>{snapshot.stats?.frameRate ?? 'n/a'} fps / {snapshot.stats?.resolution ?? 'n/a'}</dd>
        <dt>Quality</dt><dd>{qualityLabel(snapshot.quality)}</dd>
        <dt>Active camera</dt><dd>{activeCameraLabel}</dd>
        <dt>Active microphone</dt><dd>{activeMicLabel}</dd>
        <dt>Screen sharing</dt><dd>{snapshot.screenSharing ? 'you' : snapshot.peer?.screenSharing ? 'peer' : 'no'}</dd>
        <dt>Local tracks</dt><dd>{tracks(snapshot.localStream)}</dd>
        <dt>Remote tracks</dt><dd>{tracks(snapshot.remoteStream)}</dd>
      </dl></details>}
    </main>

    {!inCall && <footer className="site-footer"><p>Learn together. <span>Thrive together.</span></p><div><span>1-to-1 meetings</span><span className="footer-dot">·</span><span>No recordings</span></div></footer>}
  </div>;
}

export default App;
