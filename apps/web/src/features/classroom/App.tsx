"use client";

import './styles.css';
import Image from 'next/image';
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { MAX_NAME_LENGTH, MAX_PARTICIPANTS, ROOM_PATTERN, type ReactionEmoji } from '@learnthrive/shared/protocol';
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
import { ClassControlsMenu } from './components/ClassControlsMenu';
import { PollPanel } from './components/PollPanel';
import { UnderstandingCheckPanel } from './components/UnderstandingCheckPanel';
import { ClassTimer } from './components/ClassTimer';
// Excalidraw pulls in a large dependency tree (diagram/math-rendering support this app never
// uses); lazy-loading it means opening the ordinary Call workspace never pays that cost —
// see PRODUCTION_GAPS.md's bundle-size note and the before/after sizes recorded there.
const Whiteboard = lazy(() => import('./components/Whiteboard').then((module) => ({ default: module.Whiteboard })));
import { AnnouncementBanner } from './components/AnnouncementBanner';
import { HelpQueuePanel } from './components/HelpQueuePanel';

type FocusTarget = 'local' | string; // string = a peer's participant id
type LayoutMode = 'focus' | 'sideBySide' | 'gallery';
type WorkspaceMode = 'call' | 'board' | 'present';

function Brand() {
  // Sized here at the largest the stylesheet ever renders it (47×42); the media queries scale it
  // down from there, and `next/image` serves an appropriately sized file either way.
  return <div className="brand" aria-label="LearnThrive Tuition"><Image src="/brand/learnthrive-mark.png" alt="" width={47} height={42} priority /><div className="wordmark">Learn<span>Thrive</span><small>TUITION</small></div></div>;
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

export interface ClassroomAppProps {
  lessonId?: string;
  initialToken?: string;
  isDevRoute?: boolean;
}

export function App({ lessonId, initialToken, isDevRoute }: ClassroomAppProps = {}) {
  const {
    snapshot, prepareMedia, toggleAudio, toggleVideo, toggleScreenShare, toggleChat, sendChatMessage,
    switchCamera, switchMicrophone, flipCamera, toggleHand, sendReaction, admitOne, admitAll, denyOne,
    setRoomLocked, setStudentsCanShareScreen, setStudentsCanChat, muteParticipant, muteAll, allowUnmute,
    removeParticipant, stopShare, lowerHand, deleteChatMessage, clearChat, createPoll, closePoll, clearPoll,
    votePoll, startUnderstandingCheck, endUnderstandingCheck, respondUnderstanding, startTimer, pauseTimer,
    resumeTimer, stopTimer, sendBoardUpdate, sendBoardCursor, sendBoardLaser, createBoardPage, renameBoardPage,
    deleteBoardPage, reorderBoardPages, switchBoardPage, setBoardBackground, setStudentsCanDraw, clearBoardPage,
    followMe, importBoard, duplicateBoardPage, commitLocalPageElements, sendAnnouncement, setDataSaver, allowRejoin,
    join, leave, reset, rejoin, copyInvite, retryConnection, subscribeBoardPointers, getBoardPointersSnapshot,
  } = useMeeting();
  const [name, setName] = useState('');
  const [room, setRoom] = useState(() => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('room')?.trim().toLowerCase() || '' : ''));
  const [created, setCreated] = useState(false);
  // A platform-issued classroom link (LearnThrive Tuition's dashboard → "Join Classroom") carries
  // a signed one-time token instead of a manually-typed name/room code — see meeting.ts's join()
  // and docs/CLASSROOM_INTEGRATION.md. Read once: the token is stripped from the URL as soon as
  // join() uses it, so a later re-render must not pick a fresh (now-absent) value back up.
  const [autoJoinToken] = useState(() => initialToken || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') : null));
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const [participantPanelOpen, setParticipantPanelOpen] = useState(false);
  const [waitingRoomPanelOpen, setWaitingRoomPanelOpen] = useState(false);
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [classControlsOpen, setClassControlsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // null = no explicit choice yet — the render logic auto-picks the first peer as main.
  const [focusTarget, setFocusTargetState] = useState<FocusTarget | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('focus');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('call');
  const focusTargetRef = useRef<FocusTarget | null>(null);
  const preShareFocusRef = useRef<FocusTarget | null>(null);
  const preShareWorkspaceRef = useRef<WorkspaceMode | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const deviceMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const chatTriggerRef = useRef<HTMLButtonElement>(null);
  const participantTriggerRef = useRef<HTMLButtonElement>(null);
  const waitingRoomTriggerRef = useRef<HTMLButtonElement>(null);
  const reactionTriggerRef = useRef<HTMLButtonElement>(null);
  const leaveTriggerRef = useRef<HTMLButtonElement>(null);
  const classControlsTriggerRef = useRef<HTMLButtonElement>(null);
  const setFocusTarget = (target: FocusTarget) => setFocusTargetState(target);
  const inCall = snapshot.phase === 'meeting';
  const waitingForAdmission = snapshot.phase === 'waiting';
  const ended = snapshot.phase === 'ended';
  const joining = snapshot.phase === 'joining';
  const roomValid = ROOM_PATTERN.test(room.trim());
  const nameValid = name.trim().length > 0 && name.trim().length <= MAX_NAME_LENGTH;
  const debug = process.env.NODE_ENV !== 'production' && new URLSearchParams(window.location.search).get('debug') === '1';
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

  // Deliberately no extra "already started" ref guard here — join() already refuses to run
  // twice concurrently via its own `if (this.active) return` check, and that's the guard that
  // actually needs to survive React StrictMode's dev-only double-invoke (mount -> cleanup ->
  // mount, synchronously): useMeeting's cleanup calls controller.dispose() on every pass,
  // including the StrictMode rehearsal's, which resets `active` back to false. A ref guard that
  // "remembers" the first (rehearsal) call was made would block the second, real mount's retry
  // from ever running — leaving a disposed socket and a permanently stuck "joining" screen. join()
  // itself staying the single source of truth for "is a join already in flight" is what lets the
  // rehearsal's aborted attempt get cleanly retried by the mount that actually sticks.
  useEffect(() => {
    if (!autoJoinToken) return;
    void join('', '', 'student', autoJoinToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoJoinToken]);

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
  const someoneIsSharing = sharingPeerId != null || snapshot.screenSharing;
  useEffect(() => {
    if (sharingPeerId) {
      if (preShareFocusRef.current === null) preShareFocusRef.current = focusTargetRef.current;
      setFocusTargetState(sharingPeerId);
    } else if (preShareFocusRef.current !== null) {
      setFocusTargetState(preShareFocusRef.current);
      preShareFocusRef.current = null;
    }
  }, [sharingPeerId]);

  // A share starting automatically surfaces Present mode; the workspace mode chosen before it
  // started (Call or Board) is restored once sharing ends — the same restore-on-end pattern the
  // pre-existing focus-target effect above already uses for the video tile focus.
  useEffect(() => {
    if (someoneIsSharing) {
      if (preShareWorkspaceRef.current === null) preShareWorkspaceRef.current = workspaceMode;
      setWorkspaceMode('present');
    } else if (preShareWorkspaceRef.current !== null) {
      setWorkspaceMode(preShareWorkspaceRef.current);
      preShareWorkspaceRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- workspaceMode is read only to capture it once when sharing starts
  }, [someoneIsSharing]);

  useEffect(() => {
    if (!inCall || workspaceMode === 'board') return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key.toLowerCase()) {
        case 'm': toggleAudio(); break;
        case 'v': toggleVideo(); break;
        case 'c': toggleChat(); break;
        case 's': if (screenShareSupported) void toggleScreenShare(); break;
        case 'h': toggleHand(); break;
        case 'w': setWorkspaceMode((mode) => (mode === 'board' ? 'call' : 'board')); break;
        default: return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inCall, workspaceMode, screenShareSupported, toggleAudio, toggleVideo, toggleChat, toggleScreenShare, toggleHand]);

  const tracks = (stream: MediaStream | null) => stream?.getTracks().map(track => `${track.kind}: ${track.enabled ? 'enabled' : 'disabled'} / ${track.readyState}`).join(', ') || 'None';
  const activeCameraLabel = snapshot.cameras.find(c => c.deviceId === snapshot.selectedCamera)?.label ?? 'Default';
  const activeMicLabel = snapshot.microphones.find(m => m.deviceId === snapshot.selectedMicrophone)?.label ?? 'Default';

  const canFocusToggle = layoutMode === 'focus' && snapshot.peers.length > 0;
  const effectiveFocus: FocusTarget = focusTarget ?? (snapshot.peers[0]?.participant.id ?? 'local');

  const peerTile = (peer: RemotePeer, compact: boolean) => <ParticipantTile
    key={peer.participant.id}
    stream={peer.stream} name={peer.participant.name} audio={peer.participant.media.audio}
    video={peer.participant.media.video} screenSharing={peer.participant.screenSharing} compact={compact} role={peer.participant.role}
    focused={canFocusToggle && effectiveFocus === peer.participant.id} onFocus={canFocusToggle ? () => setFocusTarget(peer.participant.id) : undefined}
    quality={peer.quality} forceMuted={peer.participant.forceMuted}
  />;
  const selfTile = (compact: boolean) => <ParticipantTile
    key="local"
    stream={snapshot.localStream} name={snapshot.name || name || 'You'} audio={snapshot.audio} video={snapshot.video}
    screenSharing={snapshot.screenSharing} local compact={compact} role={snapshot.role}
    focused={canFocusToggle && effectiveFocus === 'local'} onFocus={canFocusToggle ? () => setFocusTarget('local') : undefined}
  />;
  const waitingTile = <section className="waiting-tile" aria-label="Waiting for other participants">
    <div className="waiting-orbit"><div className="waiting-icon"><Icon name="people" size={34} /></div></div>
    <p className="eyebrow">YOUR CLASSROOM IS READY</p><h2>A little company,<br />a lot of possibility.</h2>
    <p className="waiting-description">Share your invite link to bring<br className="desktop-break" /> others into the meeting.</p>
    <button className="button button-mint" type="button" onClick={() => void copyInvite()} aria-label="Copy invite link"><Icon name={snapshot.copied ? 'check' : 'link'} />{snapshot.copied ? 'Invite link copied' : 'Copy invite link'}</button>
  </section>;

  const reconnectingPeers = snapshot.peers.filter((peer) => peer.reconnecting);
  const helpQueueEntries = snapshot.peers
    .filter((peer) => peer.participant.role === 'student' && peer.participant.handRaised && peer.participant.handRaisedAt != null)
    .map((peer) => ({ id: peer.participant.id, name: peer.participant.name, handRaisedAt: peer.participant.handRaisedAt! }));
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
      {autoJoinToken && snapshot.phase === 'joining' && !snapshot.error ? <section className="waiting-admission-panel">
        <div className="waiting-admission-status" role="status">
          <div className="waiting-orbit"><div className="waiting-icon"><Icon name="people" size={30} /></div></div>
          <h2>Joining your classroom…</h2>
          <p>You were sent here from your LearnThrive Tuition dashboard — no need to enter a name or room code.</p>
        </div>
      </section> : ended ? <section className="ended-panel">
        <div className="ended-icon"><Icon name={snapshot.endedReason === 'removed' ? 'info' : 'check'} size={34} /></div>
        <p className="eyebrow">{snapshot.endedReason === 'classEnded' ? 'CLASS ENDED' : snapshot.endedReason === 'removed' ? 'REMOVED' : 'UNTIL NEXT TIME'}</p>
        <h1>{snapshot.endedReason === 'classEnded' ? 'The tutor ended the class.' : snapshot.endedReason === 'removed' ? 'You were removed from the class.' : 'You’ve left the meeting.'}</h1>
        <p>Your camera and microphone are off.<br />{snapshot.endedReason === 'left' ? 'You can return whenever you’re ready.' : 'Contact your tutor if you think this was a mistake.'}</p>
        <div className="ended-actions">
          {lessonId ? (
            <a
              href={`/dashboard/lessons/${lessonId}${snapshot.role === 'tutor' ? '?postClass=1' : ''}`}
              className="button button-primary"
              style={{ textDecoration: 'none' }}
            >
              Return to Lesson {snapshot.role === 'tutor' ? '(mark attendance & report)' : ''}
            </a>
          ) : null}
          {snapshot.endedReason === 'left' && <button className="button button-primary" type="button" onClick={rejoin}>Rejoin this meeting<Icon name="arrow" /></button>}
          <button className="button button-secondary" type="button" onClick={reset}>{lessonId ? 'Classroom setup' : 'Return to meeting setup'}</button>
          {snapshot.endedReason === 'left' && <button className="button button-secondary" type="button" onClick={() => void copyInvite()}><Icon name={snapshot.copied ? 'check' : 'link'} size={16} />{snapshot.copied ? 'Link copied' : 'Copy meeting link'}</button>}
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
              {snapshot.timer && <ClassTimer timer={snapshot.timer} isTutor={snapshot.role === 'tutor'} onPause={pauseTimer} onResume={resumeTimer} onStop={stopTimer} />}
            </div>
            <p className="room-display">Room <span>{snapshot.roomId}</span></p>
          </div>
          <div className="meeting-heading-status">
            <div className="workspace-mode-tabs" role="tablist" aria-label="Workspace mode">
              <button type="button" role="tab" aria-selected={workspaceMode === 'call'} onClick={() => setWorkspaceMode('call')}><Icon name="camera" size={14} />Call</button>
              <button type="button" role="tab" aria-selected={workspaceMode === 'board'} onClick={() => setWorkspaceMode('board')}><Icon name="poll" size={14} />Board</button>
              {someoneIsSharing && <button type="button" role="tab" aria-selected={workspaceMode === 'present'} onClick={() => setWorkspaceMode('present')}><Icon name="screen" size={14} />Present</button>}
            </div>
            <div className={`connection-pill ${snapshot.status === 'Connected' ? 'connected' : ''}`} role="status"><span className="status-dot" />{snapshot.status}</div>
          </div>
        </div>
        {reconnectingPeers.length > 0 && <p className="peer-reconnecting" role="status"><span className="status-dot" />{reconnectingPeers.map((peer) => peer.participant.name).join(', ')} {reconnectingPeers.length > 1 ? 'are' : 'is'} reconnecting…</p>}
        {snapshot.notice && <div className="participant-toast" role="status" key={snapshot.notice.id}>{snapshot.notice.text}</div>}
        {snapshot.announcement && <AnnouncementBanner announcement={snapshot.announcement} />}
        {snapshot.poll && <PollPanel poll={snapshot.poll} isTutor={snapshot.role === 'tutor'} onVote={votePoll} onClose={closePoll} onClear={clearPoll} />}
        {snapshot.understandingCheck && <UnderstandingCheckPanel check={snapshot.understandingCheck} isTutor={snapshot.role === 'tutor'} onRespond={respondUnderstanding} onEnd={endUnderstandingCheck} />}
        {snapshot.role === 'tutor' && helpQueueEntries.length > 0 && <HelpQueuePanel entries={helpQueueEntries} onMarkHelped={lowerHand} />}
        <div className="call-body">
          {workspaceMode === 'board' ? (
            <Suspense fallback={<div className="whiteboard-loading" role="status"><Icon name="poll" size={20} />Loading whiteboard…</div>}>
              <Whiteboard
                role={snapshot.role ?? 'student'} pages={snapshot.board.pages} activePageId={snapshot.board.activePageId}
                elementsByPage={snapshot.board.elementsByPage} studentsCanDraw={snapshot.board.studentsCanDraw}
                subscribeBoardPointers={subscribeBoardPointers} getBoardPointersSnapshot={getBoardPointersSnapshot}
                followMeSeq={snapshot.boardFollowMeSeq}
                onUpdate={sendBoardUpdate} onCursor={sendBoardCursor} onLaser={sendBoardLaser} onCommitLocal={commitLocalPageElements}
                onSwitchPage={switchBoardPage} onCreatePage={createBoardPage} onRenamePage={renameBoardPage}
                onDuplicatePage={duplicateBoardPage} onDeletePage={deleteBoardPage} onReorderPages={reorderBoardPages}
                onBackground={setBoardBackground} onSetStudentsCanDraw={setStudentsCanDraw} onClearPage={clearBoardPage}
                onFollowMe={followMe} onImport={importBoard}
              />
            </Suspense>
          ) : (
            <div className="meeting-stage" ref={stageRef}>
              {layoutMode === 'gallery' && snapshot.peers.length > 0 ? (
                <div className={`stage-gallery ${snapshot.peers.length === 2 ? 'gallery-three' : ''}`}>{selfTile(false)}{snapshot.peers.map((peer) => peerTile(peer, false))}</div>
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
          )}
          <ChatPanel
            messages={snapshot.messages} open={snapshot.chatOpen} onClose={toggleChat} onSend={sendChatMessage} triggerRef={chatTriggerRef}
            isTutor={snapshot.role === 'tutor'} onDeleteMessage={deleteChatMessage} onClearChat={clearChat}
            canChat={snapshot.role === 'tutor' || snapshot.roomSettings.studentsCanChat}
          />
        </div>
        {(snapshot.error || snapshot.mediaError) && <div className="notice notice-error" role="alert"><Icon name="info" /><span>{snapshot.error || snapshot.mediaError}</span>{snapshot.reconnectFailed && <button className="inline-action" type="button" onClick={retryConnection}>Reconnect</button>}</div>}
        <div className="call-bottom">
          <p className="call-note"><Icon name="shield" size={17} />This session is not recorded.</p>
          <div className="call-controls" aria-label="Meeting controls">
            <MediaControls audio={snapshot.audio} video={snapshot.video} onAudio={() => void toggleAudio()} onVideo={() => void toggleVideo()} disabled={snapshot.preparing} inCall forceMuted={snapshot.forceMuted} />
            <div className="control-item popover-anchor">
              <button ref={deviceMenuTriggerRef} type="button" className="media-button" onClick={() => setDeviceMenuOpen(open => !open)} aria-label="Meeting settings" aria-haspopup="menu" aria-expanded={deviceMenuOpen}><Icon name="settings" size={20} /></button>
              <span>Settings</span>
              <DeviceMenu
                open={deviceMenuOpen} onClose={() => setDeviceMenuOpen(false)} cameras={snapshot.cameras} microphones={snapshot.microphones}
                selectedCamera={snapshot.selectedCamera} selectedMicrophone={snapshot.selectedMicrophone}
                onSelectCamera={(id) => void switchCamera(id)} onSelectMicrophone={(id) => void switchMicrophone(id)}
                canFlip={snapshot.cameras.length > 1} onFlip={() => void flipCamera()} triggerRef={deviceMenuTriggerRef}
                layoutMode={layoutMode} onLayoutMode={setLayoutMode} sideBySideAvailable={snapshot.peers.length === 1}
                dataSaver={snapshot.dataSaver} onDataSaver={setDataSaver}
              />
            </div>
            <span className="controls-divider" />
            {screenShareSupported && (() => {
              const shareBlocked = snapshot.role === 'student' && !snapshot.roomSettings.studentsCanShareScreen && !snapshot.screenSharing;
              return <div className="control-item"><button type="button" className={`media-button ${snapshot.screenSharing ? 'is-on' : ''}`} disabled={shareBlocked} onClick={() => void toggleScreenShare()} aria-pressed={snapshot.screenSharing} aria-label={shareBlocked ? 'The tutor has turned off screen sharing for students' : snapshot.screenSharing ? 'Stop sharing your screen' : 'Share your screen'}><Icon name={snapshot.screenSharing ? 'screen-off' : 'screen'} size={21} /></button><span>{snapshot.screenSharing ? (snapshot.screenShareAudio ? 'Sharing audio' : 'Stop sharing') : 'Share screen'}</span></div>;
            })()}
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
                onMuteParticipant={muteParticipant} onAllowUnmute={allowUnmute} onRemoveParticipant={removeParticipant}
                onLowerHand={lowerHand} onStopShare={stopShare}
              />
            </div>
            {snapshot.role === 'tutor' && <div className="control-item popover-anchor">
              <button ref={waitingRoomTriggerRef} type="button" className="media-button" onClick={() => setWaitingRoomPanelOpen(open => !open)} aria-label="Waiting room" aria-haspopup="menu" aria-expanded={waitingRoomPanelOpen}>
                <Icon name="people" size={20} />{snapshot.waiting.length > 0 && <span className="unread-badge">{snapshot.waiting.length > 9 ? '9+' : snapshot.waiting.length}</span>}
              </button>
              <span>Waiting room</span>
              <WaitingRoomPanel open={waitingRoomPanelOpen} onClose={() => setWaitingRoomPanelOpen(false)} triggerRef={waitingRoomTriggerRef} waiting={snapshot.waiting} onAdmit={admitOne} onAdmitAll={admitAll} onDeny={denyOne} />
            </div>}
            {snapshot.role === 'tutor' && <div className="control-item popover-anchor">
              <button ref={classControlsTriggerRef} type="button" className={`media-button ${snapshot.roomSettings.locked ? 'is-on' : ''}`} onClick={() => setClassControlsOpen(open => !open)} aria-label="Class controls" aria-haspopup="menu" aria-expanded={classControlsOpen}>
                <Icon name={snapshot.roomSettings.locked ? 'lock' : 'settings'} size={20} />
              </button>
              <span>Class controls</span>
              <ClassControlsMenu
                open={classControlsOpen} onClose={() => setClassControlsOpen(false)} triggerRef={classControlsTriggerRef}
                roomSettings={snapshot.roomSettings} onSetLocked={setRoomLocked} onSetStudentsCanShareScreen={setStudentsCanShareScreen}
                onSetStudentsCanChat={setStudentsCanChat} onMuteAll={muteAll}
                pollActive={snapshot.poll != null} onCreatePoll={createPoll}
                understandingActive={snapshot.understandingCheck != null} onStartUnderstandingCheck={startUnderstandingCheck}
                timerActive={snapshot.timer != null} onStartTimer={startTimer} onSendAnnouncement={sendAnnouncement}
                removedNames={snapshot.removedNames} onAllowRejoin={allowRejoin}
              />
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
              <button ref={leaveTriggerRef} type="button" className="media-button leave-control" onClick={() => setLeaveConfirmOpen(true)} aria-label={snapshot.role === 'tutor' ? 'End class' : 'Leave meeting'}><Icon name="leave" size={23} /></button><span>{snapshot.role === 'tutor' ? 'End class' : 'Leave'}</span>
              <LeaveConfirm open={leaveConfirmOpen} onClose={() => setLeaveConfirmOpen(false)} onConfirm={() => { setLeaveConfirmOpen(false); leave(); }} triggerRef={leaveTriggerRef} isTutor={snapshot.role === 'tutor'} />
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
                    dataSaver={snapshot.dataSaver} onDataSaver={setDataSaver}
                  />
                </div>
              </div>
            </div>
            <div className="permission-note"><Icon name="shield" size={19} /><p>Your preview is only visible to you.<br />Your camera and microphone stay off until you enable them.</p></div>
            {process.env.NODE_ENV !== 'production' && <p className="dev-feedback-note"><Icon name="info" size={15} />Testing nearby devices? Use headphones on one device to prevent audio feedback.</p>}
          </section>
          <section className="join-panel" aria-labelledby="join-heading">
            {isDevRoute && (
              <p className="dev-feedback-note" role="status">
                <Icon name="info" size={15} />Developer test lab — manual name/room entry for automated tests and local debugging, not part of the normal LearnThrive flow.
              </p>
            )}
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
        <dt>Whiteboard pages</dt><dd>{snapshot.board.pages.length}</dd>
        <dt>Whiteboard elements (active page)</dt><dd>{(snapshot.board.elementsByPage[snapshot.board.activePageId] ?? []).filter((element) => !element.isDeleted).length}</dd>
        {snapshot.peers.map((peer) => {
          const direction: DirectionDiagnostics | null = peer.direction;
          return <div key={peer.participant.id} className="diagnostics-peer">
            <dt>— {peer.participant.name} —</dt><dd>{peer.participant.role}</dd>
            <dt>Connection / ICE / signalling</dt><dd>{peer.connection} / {peer.ice} / {peer.rtcSignalling}</dd>
            <dt>Candidate path</dt><dd>{candidatePathLabel(peer.stats?.localCandidateType ?? null, peer.stats?.remoteCandidateType ?? null)} (local {peer.stats?.localCandidateType ?? 'n/a'}, remote {peer.stats?.remoteCandidateType ?? 'n/a'}, {peer.stats?.selectedCandidateProtocol ?? 'n/a'})</dd>
            <dt>RTT / Jitter</dt><dd>{peer.stats?.rtt != null ? `${peer.stats.rtt} ms` : 'n/a'} / {peer.stats?.jitter != null ? `${peer.stats.jitter} ms` : 'n/a'}</dd>
            <dt>Bitrate (current)</dt><dd>in {peer.stats?.inboundBitrateKbps ?? 'n/a'} kbps / out {peer.stats?.outboundBitrateKbps ?? 'n/a'} kbps</dd>
            <dt>Bytes sent / received</dt><dd>{peer.stats?.bytesSent ?? 'n/a'} / {peer.stats?.bytesReceived ?? 'n/a'}</dd>
            <dt>Packet loss</dt><dd>{peer.stats?.packetsLost ?? 'n/a'}</dd>
            <dt>Frames encoded / decoded</dt><dd>{peer.stats?.framesEncoded ?? 'n/a'} / {peer.stats?.framesDecoded ?? 'n/a'}</dd>
            <dt>Packets sent / received</dt><dd>{peer.stats?.packetsSent ?? 'n/a'} / {peer.stats?.packetsReceived ?? 'n/a'}</dd>
            <dt>Remote video dimensions / FPS</dt><dd>{peer.stats?.resolution ?? 'n/a'} / {peer.stats?.frameRate ?? 'n/a'}</dd>
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

export { App as ClassroomApp };
export default App;
