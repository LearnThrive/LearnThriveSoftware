import { useEffect, useState } from 'react';
import type { RoomTimerState } from '@learnthrive/shared/protocol';
import { Icon } from './Icon';

function format(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

interface ClassTimerProps {
  timer: RoomTimerState;
  isTutor: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

// Owns its own 1Hz tick, same pattern as MeetingTimer — the server only broadcasts state
// transitions (start/pause/resume/stop), never a per-second tick.
export function ClassTimer({ timer, isTutor, onPause, onResume, onStop }: ClassTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (timer.paused) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [timer.paused, timer.anchorAt]);

  const elapsed = timer.paused ? (timer.elapsedAtPauseMs ?? 0) : now - timer.anchorAt;
  const displayMs = timer.mode === 'countdown' ? Math.max(0, (timer.durationMs ?? 0) - elapsed) : elapsed;
  const expired = timer.mode === 'countdown' && displayMs === 0;

  return (
    <span className={`class-timer ${expired ? 'is-expired' : ''}`} aria-label="Class timer">
      <Icon name="timer" size={13} />
      <span className="class-timer-value">{format(displayMs)}</span>
      {isTutor && (
        <span className="class-timer-controls">
          {timer.paused ? (
            <button type="button" onClick={onResume} aria-label="Resume timer">Resume</button>
          ) : (
            <button type="button" onClick={onPause} aria-label="Pause timer">Pause</button>
          )}
          <button type="button" onClick={onStop} aria-label="Stop timer">Stop</button>
        </span>
      )}
    </span>
  );
}
