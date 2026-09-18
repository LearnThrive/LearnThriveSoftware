import { useRef, useState, type RefObject } from 'react';
import { MAX_ANNOUNCEMENT_LENGTH, type PollVisibility, type RoomSettings, type TimerMode } from '@learnthrive/shared/protocol';
import { usePopoverDismiss } from '../usePopoverDismiss';
import { Icon } from './Icon';
import { PollCreator } from './PollCreator';

interface ClassControlsMenuProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  roomSettings: RoomSettings;
  onSetLocked: (locked: boolean) => void;
  onSetStudentsCanShareScreen: (value: boolean) => void;
  onSetStudentsCanChat: (value: boolean) => void;
  onMuteAll: () => void;
  pollActive: boolean;
  onCreatePoll: (question: string, options: string[], anonymous: boolean, resultsVisible: PollVisibility) => void;
  understandingActive: boolean;
  onStartUnderstandingCheck: () => void;
  timerActive: boolean;
  onStartTimer: (mode: TimerMode, durationMs: number | null) => void;
  onSendAnnouncement: (text: string) => void;
  removedNames: string[];
  onAllowRejoin: (name: string) => void;
}

type Expanded = 'poll' | 'timer' | 'announce' | null;

export function ClassControlsMenu({
  open, onClose, triggerRef, roomSettings, onSetLocked, onSetStudentsCanShareScreen, onSetStudentsCanChat, onMuteAll,
  pollActive, onCreatePoll, understandingActive, onStartUnderstandingCheck, timerActive, onStartTimer, onSendAnnouncement,
  removedNames, onAllowRejoin,
}: ClassControlsMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, onClose, panelRef, triggerRef);
  const [expanded, setExpanded] = useState<Expanded>(null);
  const [timerMode, setTimerMode] = useState<TimerMode>('stopwatch');
  const [timerMinutes, setTimerMinutes] = useState(10);
  const [announcementText, setAnnouncementText] = useState('');

  if (!open) return null;

  const closeExpanded = () => setExpanded(null);

  return (
    <div className="class-controls-menu" ref={panelRef} role="menu" aria-label="Class controls">
      <h2>Class controls</h2>

      <div className="class-controls-section">
        <p className="class-controls-section-title">Room</p>
        <button type="button" className="class-controls-toggle" onClick={() => onSetLocked(!roomSettings.locked)} aria-pressed={roomSettings.locked}>
          <Icon name={roomSettings.locked ? 'lock' : 'unlock'} size={15} />
          <span>{roomSettings.locked ? 'Room is locked' : 'Lock room'}</span>
        </button>
        <button type="button" className="class-controls-toggle" onClick={() => onSetStudentsCanShareScreen(!roomSettings.studentsCanShareScreen)} aria-pressed={roomSettings.studentsCanShareScreen}>
          <Icon name="screen" size={15} />
          <span>Students can share screen</span>
          <span className="class-controls-toggle-state">{roomSettings.studentsCanShareScreen ? 'On' : 'Off'}</span>
        </button>
        <button type="button" className="class-controls-toggle" onClick={() => onSetStudentsCanChat(!roomSettings.studentsCanChat)} aria-pressed={roomSettings.studentsCanChat}>
          <Icon name="chat" size={15} />
          <span>Students can chat</span>
          <span className="class-controls-toggle-state">{roomSettings.studentsCanChat ? 'On' : 'Off'}</span>
        </button>
        <button type="button" className="class-controls-action" onClick={onMuteAll}>
          <Icon name="microphone-off" size={15} />
          <span>Mute all students</span>
        </button>
      </div>

      <div className="class-controls-section">
        <p className="class-controls-section-title">Tools</p>

        {expanded === 'announce' ? (
          <div className="timer-creator">
            <label className="field-label" htmlFor="announcement-text">Announcement</label>
            <input
              id="announcement-text" value={announcementText} maxLength={MAX_ANNOUNCEMENT_LENGTH}
              placeholder="e.g. You have 5 minutes remaining." onChange={(event) => setAnnouncementText(event.target.value)}
            />
            <div className="poll-creator-actions">
              <button type="button" className="button-secondary" onClick={() => { setExpanded(null); setAnnouncementText(''); }}>Cancel</button>
              <button
                type="button" className="button button-primary" disabled={!announcementText.trim()}
                onClick={() => { onSendAnnouncement(announcementText.trim()); setAnnouncementText(''); setExpanded(null); onClose(); }}
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="class-controls-action" onClick={() => setExpanded('announce')}>
            <Icon name="spark" size={15} />
            <span>Send announcement</span>
          </button>
        )}

        {expanded === 'poll' ? (
          <PollCreator onCancel={closeExpanded} onCreate={(question, options, anonymous, resultsVisible) => { onCreatePoll(question, options, anonymous, resultsVisible); closeExpanded(); onClose(); }} />
        ) : (
          <button type="button" className="class-controls-action" disabled={pollActive} onClick={() => setExpanded('poll')}>
            <Icon name="poll" size={15} />
            <span>{pollActive ? 'Poll in progress' : 'Start a poll'}</span>
          </button>
        )}

        <button type="button" className="class-controls-action" disabled={understandingActive} onClick={() => { onStartUnderstandingCheck(); onClose(); }}>
          <Icon name="help-circle" size={15} />
          <span>{understandingActive ? 'Check in progress' : 'Start understanding check'}</span>
        </button>

        {expanded === 'timer' ? (
          <div className="timer-creator">
            <div className="device-menu-layout">
              <button type="button" className={timerMode === 'stopwatch' ? 'is-active' : ''} onClick={() => setTimerMode('stopwatch')}>Stopwatch</button>
              <button type="button" className={timerMode === 'countdown' ? 'is-active' : ''} onClick={() => setTimerMode('countdown')}>Countdown</button>
            </div>
            {timerMode === 'countdown' && (
              <label className="field-label" htmlFor="timer-minutes">
                Minutes
                <input
                  id="timer-minutes" type="number" min={1} max={240} value={timerMinutes}
                  onChange={(event) => setTimerMinutes(Math.max(1, Math.min(240, Number(event.target.value) || 1)))}
                />
              </label>
            )}
            <div className="poll-creator-actions">
              <button type="button" className="button-secondary" onClick={closeExpanded}>Cancel</button>
              <button
                type="button" className="button button-primary"
                onClick={() => { onStartTimer(timerMode, timerMode === 'countdown' ? timerMinutes * 60_000 : null); closeExpanded(); onClose(); }}
              >
                Start timer
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="class-controls-action" disabled={timerActive} onClick={() => setExpanded('timer')}>
            <Icon name="timer" size={15} />
            <span>{timerActive ? 'Timer running' : 'Start a timer'}</span>
          </button>
        )}
      </div>

      {removedNames.length > 0 && (
        <div className="class-controls-section">
          <p className="class-controls-section-title">Removed students</p>
          <p className="device-menu-hint">Removed students can&apos;t rejoin this class until you allow it.</p>
          {removedNames.map((removedName) => (
            <button key={removedName} type="button" className="class-controls-action" onClick={() => onAllowRejoin(removedName)}>
              <Icon name="user-x" size={15} />
              <span>Allow {removedName} to rejoin</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
