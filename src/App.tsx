import { useState, type FormEvent } from 'react';
import { MAX_NAME_LENGTH, ROOM_PATTERN } from '../shared/protocol';
import { useMeeting } from './useMeeting';
import { Icon } from './components/Icon';
import { MediaControls } from './components/MediaControls';
import { ParticipantTile } from './components/ParticipantTile';

function Brand() {
  return <div className="brand" aria-label="LearnThrive Tuition"><img src="/brand/learnthrive-mark.png" alt="" /><div className="wordmark">Learn<span>Thrive</span><small>TUITION</small></div></div>;
}

function App() {
  const { snapshot, prepareMedia, toggleAudio, toggleVideo, join, leave, reset, copyInvite, retryConnection } = useMeeting();
  const [name, setName] = useState('');
  const [room, setRoom] = useState(() => new URLSearchParams(window.location.search).get('room')?.trim().toLowerCase() || '');
  const [created, setCreated] = useState(false);
  const inCall = snapshot.phase === 'meeting';
  const ended = snapshot.phase === 'ended';
  const joining = snapshot.phase === 'joining';
  const roomValid = ROOM_PATTERN.test(room.trim());
  const nameValid = name.trim().length > 0 && name.trim().length <= MAX_NAME_LENGTH;
  const debug = import.meta.env.DEV && new URLSearchParams(window.location.search).get('debug') === '1';

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

  const tracks = (stream: MediaStream | null) => stream?.getTracks().map(track => `${track.kind}: ${track.enabled ? 'enabled' : 'disabled'} / ${track.readyState}`).join(', ') || 'None';

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
          <div><div className="meeting-title-line"><h1>Your meeting</h1><span className="participant-count"><Icon name="people" size={15} />{snapshot.peer ? '2' : '1'} / 2</span></div><p className="room-display">Room <span>{snapshot.roomId}</span></p></div>
          <div className={`connection-pill ${snapshot.connection === 'connected' ? 'connected' : ''}`} role="status"><span className="status-dot" />{snapshot.status}</div>
        </div>
        <div className="meeting-stage">
          {snapshot.peer ? <ParticipantTile stream={snapshot.remoteStream} name={snapshot.peer.name} audio={snapshot.peer.media.audio} video={snapshot.peer.media.video} /> : <section className="waiting-tile" aria-label="Waiting for another participant">
            <div className="waiting-orbit"><div className="waiting-icon"><Icon name="people" size={34} /></div></div>
            <p className="eyebrow">YOUR CLASSROOM IS READY</p><h2>A little company,<br />a lot of possibility.</h2>
            <p className="waiting-description">Share your invite link to bring the<br className="desktop-break" /> other participant into the meeting.</p>
            <button className="button button-mint" type="button" onClick={() => void copyInvite()} aria-label="Copy invite link"><Icon name={snapshot.copied ? 'check' : 'link'} />{snapshot.copied ? 'Invite link copied' : 'Copy invite link'}</button>
          </section>}
          <div className="self-preview"><ParticipantTile stream={snapshot.localStream} name={snapshot.name || name || 'You'} audio={snapshot.audio} video={snapshot.video} local compact /></div>
          <span className="stage-caption"><span /> Learn together. Thrive together.</span>
        </div>
        {(snapshot.error || snapshot.mediaError) && <div className="notice notice-error" role="alert"><Icon name="info" /><span>{snapshot.error || snapshot.mediaError}</span>{snapshot.connection === 'failed' && <button className="inline-action" type="button" onClick={retryConnection}>Try again</button>}</div>}
        <div className="call-bottom">
          <p className="call-note"><Icon name="shield" size={17} />This session is not recorded.</p>
          <div className="call-controls" aria-label="Meeting controls">
            <MediaControls audio={snapshot.audio} video={snapshot.video} onAudio={() => void toggleAudio()} onVideo={() => void toggleVideo()} disabled={snapshot.preparing} inCall />
            <span className="controls-divider" />
            <div className="control-item"><button type="button" className="media-button invite-control" onClick={() => void copyInvite()} aria-label="Copy invite link"><Icon name={snapshot.copied ? 'check' : 'link'} size={22} /></button><span>{snapshot.copied ? 'Copied' : 'Invite'}</span></div>
            <div className="control-item"><button type="button" className="media-button leave-control" onClick={leave} aria-label="Leave meeting"><Icon name="leave" size={23} /></button><span>Leave</span></div>
          </div>
          <div className="call-bottom-spacer" />
        </div>
      </> : <>
        <div className="welcome-heading"><p className="eyebrow"><span /> YOUR LEARNING SPACE</p><h1>Ready when you are.</h1><p>A familiar face. A fresh perspective. Let’s connect.</p></div>
        <div className="prejoin-grid">
          <section className="preview-panel" aria-label="Camera and microphone setup">
            <ParticipantTile stream={snapshot.localStream} name={name.trim() || 'You'} audio={snapshot.audio} video={snapshot.video} local preview />
            <div className="preview-controls"><div className="device-status"><span className={`device-dot ${snapshot.localStream ? 'ready' : ''}`} /><span>{snapshot.preparing ? 'Preparing camera…' : snapshot.localStream ? 'You’re in control' : 'Camera & mic are off'}</span></div><div className="preview-buttons"><MediaControls audio={snapshot.audio} video={snapshot.video} disabled={snapshot.preparing || joining} onAudio={() => void toggleAudio()} onVideo={() => void toggleVideo()} /></div></div>
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
      {debug && <details className="diagnostics"><summary>Development diagnostics</summary><dl><dt>Room</dt><dd>{snapshot.roomId || room || 'Not joined'}</dd><dt>Signalling server</dt><dd>{snapshot.signalling}</dd><dt>WebRTC connection</dt><dd>{snapshot.connection}</dd><dt>ICE connection</dt><dd>{snapshot.ice}</dd><dt>RTC signalling</dt><dd>{snapshot.rtcSignalling}</dd><dt>Local tracks</dt><dd>{tracks(snapshot.localStream)}</dd><dt>Remote tracks</dt><dd>{tracks(snapshot.remoteStream)}</dd></dl></details>}
    </main>

    {!inCall && <footer className="site-footer"><p>Learn together. <span>Thrive together.</span></p><div><span>1-to-1 meetings</span><span className="footer-dot">·</span><span>No recordings</span></div></footer>}
  </div>;
}

export default App;
