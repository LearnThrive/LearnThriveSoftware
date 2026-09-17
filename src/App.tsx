import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { MAX_NAME_LENGTH, MAX_PARTICIPANTS, ROOM_PATTERN, type ReactionEmoji } from '../shared/protocol';
import { useMeeting } from './useMeeting';
import type { RemotePeer } from './meeting';
import { canShareScreen } from './screenShare';
import { qualityLabel } from './stats';
import type { DirectionDiagnostics, TrackSnapshot } from './peer';
import { Icon } from './components/Icon';
import { MediaControls } from './components/MediaControls';
import { ParticipantTile } from './components/ParticipantTile';
import { ChatPanel } from './components/ChatPanel';
import { DeviceMenu } from './components/DeviceMenu';
import { ParticipantPanel } from './components/ParticipantPanel';
import { WaitingRoomPanel } from './components/WaitingRoomPanel';
import { ReactionPicker } from './components/ReactionPicker';
import { ReactionsLayer } from './components/ReactionsLayer';
import { LeaveConfirm } from './components/LeaveConfirm';
import { MeetingTimer } from './components/Timer';
import { MicLevelMeter } from './components/MicLevelMeter';

type FocusTarget = 'local' | string; // string = a peer's participant id
type LayoutMode = 'focus' | 'sideBySide' | 'gallery';

function Brand() {
  return <div className="brand" aria-label="LearnThrive Tuition"><img src="/brand/learnthrive-mark.png" alt="" /><div className="wordmark">Learn<span>Thrive</span><small>TUITION</small></div></div>;
}

function candidatePathLabel(local: string | null, remote: string | null) {
  if (!local && !remote) return 'Unknown';
  if (local === 'relay' || remote === 'relay') return 'Relay (TURN)';
  if (local === 'host' && remote === 'host') return 'Direct';
  return 'Reflexive (STUN)';
}

function trackLabel(track: TrackSnapshot | null) {
  if (!track) return 'none';
  return `${track.id.slice(0, 8)} · ${track.enabled ? 'enabled' : 'disabled'} · ${track.muted ? 'muted' : 'unmuted'} · ${track.readyState}`;
}

function App() {
  const {
    snapshot, prepareMedia, toggleAudio, toggleVideo, toggleScreenShare, toggleChat, sendChatMessage,
    switchCamera, switchMicrophone, flipCamera, toggleHand, sendReaction, admitOne, admitAll,
    join, leave, reset, rejoin, copyInvite, retryConnection,
  } = useMeeting();
  const [name, setName] = useState('');
  const [room, setRoom] = useState(() => new URLSearchParams(window.location.search).get('room')?.trim().toLowerCase() || '');
  const [created, setCreated] = useState(false);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [participantPanelOpen, setParticipantPanelOpen] = useState(false);
  const [waitingRoomPanelOpen, setWaitingRoomPanelOpen] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // null = no explicit choice yet — the render logic auto-picks the first peer as main.
  const [focusTarget, setFocusTargetState] = useState<FocusTarget | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('focus');
  const focusTargetRef = useRef<FocusTarget | null>(null);
  const preShareFocusRef = useRef<FocusTarget | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const deviceMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const chatTriggerRef = useRef<HTMLButtonElement>(null);
  const participantTriggerRef = useRef<HTMLButtonElement>(null);
  const waitingRoomTriggerRef = useRef<HTMLButtonElement>(null);
  const reactionTriggerRef = useRef<HTMLButtonElement>(null);
  const leaveTriggerRef = useRef<HTMLButtonElement>(null);
  const setFocusTarget = (target: FocusTarget) => setFocusTargetState(target);
  const inCall = snapshot.phase === 'meeting';
  const waitingForAdmission = snapshot.phase === 'waiting';
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
    if (roomValid && nameValid && !joining) void join(name.trim(), room.trim(), created ? 'tutor' : 'student');
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

  useEffect(() => { focusTargetRef.current = focusTarget; }, [focusTarget]);

  // If the currently-focused peer leaves, fall back to auto-pick rather than pointing at nobody.
  useEffect(() => {
    if (focusTarget && focusTarget !== 'local' && !snapshot.peers.some((peer) => peer.participant.id === focusTarget)) {
      setFocusTargetState(null);
    }
  }, [snapshot.peers, focusTarget]);

  // Whoever's sharing becomes visible automatically; the prior focus choice (main-view
  // preference, not what's transmitted) is restored once sharing ends. Only a peer's own share
  // triggers this — your own share doesn't need to redirect your own view.
  const sharingPeerId = snapshot.peers.find((peer) => peer.participant.screenSharing)?.participant.id ?? null;
  useEffect(() => {
    if (sharingPeerId) {
      if (preShareFocusRef.current === null) preShareFocusRef.current = focusTargetRef.current;
      setFocusTargetState(sharingPeerId);
    } else if (preShareFocusRef.current !== null) {
      setFocusTargetState(preShareFocusRef.current);
      preShareFocusRef.current = null;
    }
  }, [sharingPeerId]);

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
  const activeCameraLabel = snapshot.cameras.find(c => c.deviceId === snapshot.selectedCamera)?.label ?? 'Default';
  const activeMicLabel = snapshot.microphones.find(m => m.deviceId === snapshot.selectedMicrophone)?.label ?? 'Default';

  const canFocusToggle = layoutMode === 'focus' && snapshot.peers.length > 0;
  const effectiveFocus: FocusTarget = focusTarget ?? (snapshot.peers[0]?.participant.id ?? 'local');

  const peerTile = (peer: RemotePeer, compact: boolean) => <ParticipantTile
    key={peer.participant.id}
    stream={peer.stream} name={peer.participant.name} audio={peer.participant.media.audio}
    video={peer.participant.media.video} screenSharing={peer.participant.screenSharing} compact={compact}
    focused={canFocusToggle && effectiveFocus === peer.participant.id} onFocus={canFocusToggle ? () => setFocusTarget(peer.participant.id) : undefined}
  />;
  const selfTile = (compact: boolean) => <ParticipantTile
    key="local"
    stream={snapshot.localStream} name={snapshot.name || name || 'You'} audio={snapshot.audio} video={snapshot.video}
    screenSharing={snapshot.screenSharing} local compact={compact}
    focused={canFocusToggle && effectiveFocus === 'local'} onFocus={canFocusToggle ? () => setFocusTarget('local') : undefined}
  />;
  const waitingTile = <section className="waiting-tile" aria-label="Waiting for other participants">
    <div className="waiting-orbit"><div className="waiting-icon"><Icon name="people" size={34} /></div></div>
    <p className="eyebrow">YOUR CLASSROOM IS READY</p><h2>A little company,<br />a lot of possibility.</h2>
    <p className="waiting-description">Share your invite link to bring<br className="desktop-break" /> others into the meeting.</p>
    <button className="button button-mint" type="button" onClick={() => void copyInvite()} aria-label="Copy invite link"><Icon name={snapshot.copied ? 'check' : 'link'} />{snapshot.copied ? 'Invite link copied' : 'Copy invite link'}</button>
  </section>;

  const reconnectingPeers = snapshot.peers.filter((peer) => peer.reconnecting);
  const mainPeer = effectiveFocus !== 'local' ? snapshot.peers.find((peer) => peer.participant.id === effectiveFocus) : undefined;
  const otherTiles = () => {
    const tiles: ReactElement[] = [];
    if (effectiveFocus !== 'local') tiles.push(selfTile(true));
    for (const peer of snapshot.peers) if (peer.participant.id !== effectiveFocus) tiles.push(peerTile(peer, true));
    return tiles;
  };

  return <div className={`app ${inCall || waitingForAdmission ? 'call-app' : ''}`}>
    <a className="skip-link" href="#main-content">Skip to meeting</a>
    <header className="site-header">
      <Brand />
      <div className="header-context"><span className="header-divider" />{inCall ? 'Your classroom' : 'Online classroom'}<span className="prototype-badge">Preview</span></div>
      <div className="header-note"><Icon name="people" size={17} /><span>A classroom for up to 4</span></div>
    </header>

    <main id="main-content" className={inCall || waitingForAdmission ? 'call-main' : 'prejoin-main'}>
      {ended ? <section className="ended-panel">
        <div className="ended-icon"><Icon name="check" size={34} /></div>
        <p className="eyebrow">UNTIL NEXT TIME</p>
        <h1>You’ve left the meeting.</h1>
        <p>Your camera and microphone are off.<br />You can return whenever you’re ready.</p>
        <div className="ended-actions">
          <button className="button button-primary" type="button" onClick={rejoin}>Rejoin this meeting<Icon name="arrow" /></button>
          <button className="button button-secondary" type="button" onClick={reset}>Return to meeting setup</button>
          <button className="button button-secondary" type="button" onClick={() => void copyInvite()}><Icon name={snapshot.copied ? 'check' : 'link'} size={16} />{snapshot.copied ? 'Link copied' : 'Copy meeting link'}</button>
        </div>
        <div className="ended-footer">A little learning. A little growing. LearnThrive.</div>
      </section> : waitingForAdmission ? <section className="waiting-admission-panel">
        <ParticipantTile stream={snapshot.localStream} name={name.trim() || 'You'} audio={snapshot.audio} video={snapshot.video} local preview />
        <div className="waiting-admission-status" role="status">
          <div className="waiting-orbit"><div className="waiting-icon"><Icon name="people" size={30} /></div></div>
          <h2>Waiting for the tutor to let you in…</h2>
          <p>You’ll join automatically once they admit you.</p>
          <div className="preview-buttons"><MediaControls audio={snapshot.audio} video={snapshot.video} disabled={snapshot.preparing} onAudio={() => void toggleAudio()} onVideo={() => void toggleVideo()} /></div>
          <button className="button button-secondary" type="button" onClick={() => setLeaveConfirmOpen(true)}>Leave waiting room</button>
          <LeaveConfirm open={leaveConfirmOpen} onClose={() => setLeaveConfirmOpen(false)} onConfirm={() => { setLeaveConfirmOpen(false); leave(); }} triggerRef={leaveTriggerRef} />
        </div>
      </section> : inCall ? <>
        <div className="meeting-heading">
          <div>
            <div className="meeting-title-line">
              <h1>Your meeting</h1>
              <span className="participant-count"><Icon name="people" size={15} />{1 + snapshot.peers.length} / {MAX_PARTICIPANTS}</span>
              <MeetingTimer connectedAt={snapshot.peers.find((peer) => peer.connectedAt != null)?.connectedAt ?? null} />
            </div>
            <p className="room-display">Room <span>{snapshot.roomId}</span></p>
          </div>
          <div className="meeting-heading-status">
            <div className={`connection-pill ${snapshot.status === 'Connected' ? 'connected' : ''}`} role="status"><span className="status-dot" />{snapshot.status}</div>
          </div>
        </div>
        {reconnectingPeers.length > 0 && <p className="peer-reconnecting" role="status"><span className="status-dot" />{reconnectingPeers.map((peer) => peer.participant.name).join(', ')} {reconnectingPeers.length > 1 ? 'are' : 'is'} reconnecting…</p>}
        {snapshot.notice && <div className="participant-toast" role="status" key={snapshot.notice.id}>{snapshot.notice.text}</div>}
        <div className="call-body">
          <div className="meeting-stage" ref={stageRef}>
            {layoutMode === 'gallery' && snapshot.peers.length > 0 ? (
              <div className="stage-gallery">{selfTile(false)}{snapshot.peers.map((peer) => peerTile(peer, false))}</div>
            ) : layoutMode === 'sideBySide' && snapshot.peers.length === 1 ? (
              <div className="stage-side-by-side">{peerTile(snapshot.peers[0], false)}{selfTile(false)}</div>
            ) : snapshot.peers.length === 0 ? (
              <>{waitingTile}<div className="focus-strip">{selfTile(true)}</div></>
            ) : (
              <>{effectiveFocus === 'local' ? selfTile(false) : peerTile(mainPeer!, false)}<div className="focus-strip">{otherTiles()}</div></>
            )}
            <ReactionsLayer reactions={snapshot.reactions} />
            <span className="stage-caption"><span /> Learn together. Thrive together.</span>
            {fullscreenSupported && <button type="button" className="stage-fullscreen" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}><Icon name={isFullscreen ? 'collapse' : 'expand'} size={17} /></button>}
          </div>
          <ChatPanel messages={snapshot.messages} open={snapshot.chatOpen} onClose={toggleChat} onSend={sendChatMessage} triggerRef={chatTriggerRef} />
        </div>
        {(snapshot.error || snapshot.mediaError) && <div className="notice notice-error" role="alert"><Icon name="info" /><span>{snapshot.error || snapshot.mediaError}</span>{snapshot.reconnectFailed && <button className="inline-action" type="button" onClick={retryConnection}>Reconnect</button>}</div>}
        <div className="call-bottom">
          <p className="call-note"><Icon name="shield" size={17} />This session is not recorded.</p>
          <div className="call-controls" aria-label="Meeting controls">
            <MediaControls audio={snapshot.audio} video={snapshot.video} onAudio={() => void toggleAudio()} onVideo={() => void toggleVideo()} disabled={snapshot.preparing} inCall />
            <div className="control-item popover-anchor">
              <button ref={deviceMenuTriggerRef} type="button" className="media-button" onClick={() => setDeviceMenuOpen(open => !open)} aria-label="Meeting settings" aria-haspopup="menu" aria-expanded={deviceMenuOpen}><Icon name="settings" size={20} /></button>
              <span>Settings</span>
              <DeviceMenu
                open={deviceMenuOpen} onClose={() => setDeviceMenuOpen(false)} cameras={snapshot.cameras} microphones={snapshot.microphones}
                selectedCamera={snapshot.selectedCamera} selectedMicrophone={snapshot.selectedMicrophone}
                onSelectCamera={(id) => void switchCamera(id)} onSelectMicrophone={(id) => void switchMicrophone(id)}
                canFlip={snapshot.cameras.length > 1} onFlip={() => void flipCamera()} triggerRef={deviceMenuTriggerRef}
                layoutMode={layoutMode} onLayoutMode={setLayoutMode} sideBySideAvailable={snapshot.peers.length === 1}
              />
            </div>
            <span className="controls-divider" />
            {screenShareSupported && <div className="control-item"><button type="button" className={`media-button ${snapshot.screenSharing ? 'is-on' : ''}`} onClick={() => void toggleScreenShare()} aria-pressed={snapshot.screenSharing} aria-label={snapshot.screenSharing ? 'Stop sharing your screen' : 'Share your screen'}><Icon name={snapshot.screenSharing ? 'screen-off' : 'screen'} size={21} /></button><span>{snapshot.screenSharing ? 'Stop sharing' : 'Share screen'}</span></div>}
            <div className="control-item"><button ref={chatTriggerRef} type="button" className={`media-button ${snapshot.chatOpen ? 'is-on' : ''}`} onClick={toggleChat} aria-pressed={snapshot.chatOpen} aria-label="Toggle chat">
              <Icon name="chat" size={21} />{snapshot.unreadCount > 0 && !snapshot.chatOpen && <span className="unread-badge">{snapshot.unreadCount > 9 ? '9+' : snapshot.unreadCount}</span>}
            </button><span>Chat</span></div>
            <div className="control-item popover-anchor">
              <button ref={participantTriggerRef} type="button" className="media-button" onClick={() => setParticipantPanelOpen(open => !open)} aria-label="Participants" aria-haspopup="menu" aria-expanded={participantPanelOpen}><Icon name="people" size={20} /></button>
              <span>People</span>
              <ParticipantPanel
                open={participantPanelOpen} onClose={() => setParticipantPanelOpen(false)} triggerRef={participantTriggerRef}
                selfName={snapshot.name || name || 'You'} selfRole={snapshot.role} selfAudio={snapshot.audio} selfVideo={snapshot.video} selfHandRaised={snapshot.handRaised}
                peers={snapshot.peers}
              />
            </div>
            {snapshot.role === 'tutor' && <div className="control-item popover-anchor">
              <button ref={waitingRoomTriggerRef} type="button" className="media-button" onClick={() => setWaitingRoomPanelOpen(open => !open)} aria-label="Waiting room" aria-haspopup="menu" aria-expanded={waitingRoomPanelOpen}>
                <Icon name="people" size={20} />{snapshot.waiting.length > 0 && <span className="unread-badge">{snapshot.waiting.length > 9 ? '9+' : snapshot.waiting.length}</span>}
              </button>
              <span>Waiting room</span>
              <WaitingRoomPanel open={waitingRoomPanelOpen} onClose={() => setWaitingRoomPanelOpen(false)} triggerRef={waitingRoomTriggerRef} waiting={snapshot.waiting} onAdmit={admitOne} onAdmitAll={admitAll} />
            </div>}
            <div className="control-item popover-anchor">
              <button ref={reactionTriggerRef} type="button" className="media-button" onClick={() => setReactionPickerOpen(open => !open)} aria-label="Send a reaction" aria-haspopup="menu" aria-expanded={reactionPickerOpen}><Icon name="spark" size={20} /></button>
              <span>React</span>
              <ReactionPicker open={reactionPickerOpen} onClose={() => setReactionPickerOpen(false)} onSelect={(emoji: ReactionEmoji) => sendReaction(emoji)} triggerRef={reactionTriggerRef} />
            </div>
            <div className="control-item"><button type="button" className={`media-button ${snapshot.handRaised ? 'is-on' : ''}`} onClick={toggleHand} aria-pressed={snapshot.handRaised} aria-label={snapshot.handRaised ? 'Lower your hand' : 'Raise your hand'}><Icon name="hand" size={20} /></button><span>{snapshot.handRaised ? 'Lower hand' : 'Raise hand'}</span></div>
            <span className="controls-divider" />
            {snapshot.peers.length === 0 && <div className="control-item"><button type="button" className="media-button invite-control" onClick={() => void copyInvite()} aria-label="Copy invite link"><Icon name={snapshot.copied ? 'check' : 'link'} size={22} /></button><span>{snapshot.copied ? 'Copied' : 'Invite'}</span></div>}
            <div className="control-item popover-anchor">
              <button ref={leaveTriggerRef} type="button" className="media-button leave-control" onClick={() => setLeaveConfirmOpen(true)} aria-label="Leave meeting"><Icon name="leave" size={23} /></button><span>Leave</span>
              <LeaveConfirm open={leaveConfirmOpen} onClose={() => setLeaveConfirmOpen(false)} onConfirm={() => { setLeaveConfirmOpen(false); leave(); }} triggerRef={leaveTriggerRef} />
            </div>
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
                  <button ref={deviceMenuTriggerRef} type="button" className="media-button" onClick={() => setDeviceMenuOpen(open => !open)} aria-label="Camera and microphone options" aria-haspopup="menu" aria-expanded={deviceMenuOpen}><Icon name="settings" size={20} /></button>
                  <span>Devices</span>
                  <DeviceMenu
                    open={deviceMenuOpen} onClose={() => setDeviceMenuOpen(false)} cameras={snapshot.cameras} microphones={snapshot.microphones}
                    selectedCamera={snapshot.selectedCamera} selectedMicrophone={snapshot.selectedMicrophone}
                    onSelectCamera={(id) => void switchCamera(id)} onSelectMicrophone={(id) => void switchMicrophone(id)}
                    canFlip={snapshot.cameras.length > 1} onFlip={() => void flipCamera()} triggerRef={deviceMenuTriggerRef}
                  />
                </div>
              </div>
            </div>
            <div className="permission-note"><Icon name="shield" size={19} /><p>Your preview is only visible to you.<br />Your camera and microphone stay off until you enable them.</p></div>
            {import.meta.env.DEV && <p className="dev-feedback-note"><Icon name="info" size={15} />Testing nearby devices? Use headphones on one device to prevent audio feedback.</p>}
          </section>
          <section className="join-panel" aria-labelledby="join-heading">
            <div className="join-panel-top"><h2 id="join-heading">Make yourself at home.</h2><p>{created ? 'You’ll host this class as the tutor.' : 'Check your details before stepping in.'}</p></div>
            <form onSubmit={submit}>
              <div className="field"><label htmlFor="display-name">Your name</label><input id="display-name" name="displayName" placeholder="e.g. Alex Taylor" value={name} onChange={event => setName(event.target.value)} maxLength={MAX_NAME_LENGTH} autoComplete="given-name" disabled={joining} required /><span className="field-hint">How you’ll appear in the meeting</span></div>
              <div className="field"><label htmlFor="room-code">Room code</label><input id="room-code" className="room-input" name="roomCode" placeholder="Enter a room code" value={room} onChange={event => { setRoom(event.target.value.toLowerCase()); setCreated(false); }} minLength={8} maxLength={48} pattern="[a-z0-9][a-z0-9\-]{7,47}" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={joining} aria-describedby="room-hint" required /><span className="field-hint" id="room-hint">{created ? 'Your room is ready. Copy the link to invite students.' : room.length > 0 && !roomValid ? 'Use 8–48 lowercase letters, numbers or hyphens.' : 'Use a shared code to join as a student, or create a new class below.'}</span></div>
              {(snapshot.error || snapshot.mediaError) && <div className="notice notice-error" role="alert"><Icon name="info" size={18} /><span>{snapshot.error || snapshot.mediaError}</span></div>}
              <button type="button" className="button button-permission" onClick={() => void prepareMedia()} disabled={snapshot.preparing || joining}><Icon name="camera" size={19} />{snapshot.preparing ? 'Preparing camera…' : snapshot.localStream ? 'Check camera & microphone' : 'Enable camera & microphone'}</button>
              <button type="submit" className="button button-primary join-button" disabled={!roomValid || !nameValid || joining}>{joining ? 'Joining meeting…' : created ? 'Start class' : 'Join meeting'}<Icon name="arrow" /></button>
              <p className="join-footnote">{created ? 'You can also start with your camera and mic off.' : 'Joining with a shared code places you in the waiting room until the tutor lets you in.'}</p>
            </form>
            <div className="new-meeting"><span>Starting something new?</span><button type="button" className="button button-secondary" onClick={createMeeting} disabled={joining}><Icon name="plus" size={18} />Create meeting</button></div>
            {roomValid && <button type="button" className="copy-room-link" aria-label="Copy invite link" onClick={() => void copyInvite(room.trim())}><Icon name={snapshot.copied ? 'check' : 'link'} size={16} />{snapshot.copied ? 'Invite link copied' : 'Copy invite link'}</button>}
          </section>
        </div>
        <div className="prejoin-status" role="status"><span className="status-dot" />{snapshot.status}</div>
      </>}

      {snapshot.copied && (inCall || waitingForAdmission) && <div className="toast" role="status"><Icon name="check" size={18} />Invite link copied</div>}
      {debug && <details className="diagnostics"><summary>Development diagnostics</summary><dl>
        <dt>Room</dt><dd>{snapshot.roomId || room || 'Not joined'}</dd>
        <dt>Role</dt><dd>{snapshot.role ?? 'n/a'}</dd>
        <dt>Participants</dt><dd>{1 + snapshot.peers.length} / {MAX_PARTICIPANTS}</dd>
        <dt>Waiting</dt><dd>{snapshot.waiting.length}</dd>
        <dt>Signalling server</dt><dd>{snapshot.signalling}</dd>
        <dt>Headline status</dt><dd>{snapshot.status}</dd>
        <dt>Active camera</dt><dd>{activeCameraLabel}</dd>
        <dt>Active microphone</dt><dd>{activeMicLabel}</dd>
        <dt>Screen sharing</dt><dd>{snapshot.screenSharing ? 'you' : sharingPeerId ? 'a peer' : 'no'}</dd>
        <dt>Hand raised (you)</dt><dd>{snapshot.handRaised ? 'yes' : 'no'}</dd>
        <dt>Local tracks (stream)</dt><dd>{tracks(snapshot.localStream)}</dd>
        {snapshot.peers.map((peer) => {
          const direction: DirectionDiagnostics | null = peer.direction;
          return <div key={peer.participant.id} className="diagnostics-peer">
            <dt>— {peer.participant.name} —</dt><dd>{peer.participant.role}</dd>
            <dt>Connection / ICE / signalling</dt><dd>{peer.connection} / {peer.ice} / {peer.rtcSignalling}</dd>
            <dt>Candidate path</dt><dd>{candidatePathLabel(peer.stats?.localCandidateType ?? null, peer.stats?.remoteCandidateType ?? null)} (local {peer.stats?.localCandidateType ?? 'n/a'}, remote {peer.stats?.remoteCandidateType ?? 'n/a'})</dd>
            <dt>RTT / Jitter</dt><dd>{peer.stats?.rtt != null ? `${peer.stats.rtt} ms` : 'n/a'} / {peer.stats?.jitter != null ? `${peer.stats.jitter} ms` : 'n/a'}</dd>
            <dt>Bitrate</dt><dd>in {peer.stats?.inboundBitrateKbps ?? 'n/a'} kbps / out {peer.stats?.outboundBitrateKbps ?? 'n/a'} kbps</dd>
            <dt>Frames encoded / decoded</dt><dd>{peer.stats?.framesEncoded ?? 'n/a'} / {peer.stats?.framesDecoded ?? 'n/a'}</dd>
            <dt>Packets sent / received</dt><dd>{peer.stats?.packetsSent ?? 'n/a'} / {peer.stats?.packetsReceived ?? 'n/a'}</dd>
            <dt>Quality</dt><dd>{qualityLabel(peer.quality)}</dd>
            <dt>Local / Remote audio track</dt><dd>{trackLabel(direction?.localAudio ?? null)} / {trackLabel(direction?.remoteAudio ?? null)}</dd>
            <dt>Local / Remote video track</dt><dd>{trackLabel(direction?.localVideo ?? null)} / {trackLabel(direction?.remoteVideo ?? null)}</dd>
            <dt>Audio direction</dt><dd>{direction?.audioDirection ?? 'n/a'} (negotiated: {direction?.audioCurrentDirection ?? 'n/a'})</dd>
            <dt>Video direction</dt><dd>{direction?.videoDirection ?? 'n/a'} (negotiated: {direction?.videoCurrentDirection ?? 'n/a'})</dd>
            <dt>Remote tracks (stream)</dt><dd>{tracks(peer.stream)}</dd>
          </div>;
        })}
      </dl></details>}
    </main>

    {!inCall && !waitingForAdmission && <footer className="site-footer"><p>Learn together. <span>Thrive together.</span></p><div><span>Tutor-led classes</span><span className="footer-dot">·</span><span>No recordings</span></div></footer>}
  </div>;
}

export default App;
