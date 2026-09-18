import { useEffect, useState } from 'react';

function format(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Owns its own 1Hz tick so a live-updating clock doesn't drive re-renders anywhere else. */
export function MeetingTimer({ connectedAt }: { connectedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (connectedAt == null) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [connectedAt]);

  if (connectedAt == null) return null;
  return <span className="meeting-timer" aria-label="Meeting duration">{format(now - connectedAt)}</span>;
}
