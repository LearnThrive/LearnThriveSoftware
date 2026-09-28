import { useEffect, useRef } from 'react';
import { startMicLevel } from '../micLevel';

/**
 * Live mic activity meter for the pre-join screen. Never records; owns its own AudioContext lifecycle
 * (see micLevel.ts).
 *
 * Deliberately holds no React state for the level: it changes every display frame and only one
 * element depends on it, so the analyser loop writes the bar's `transform` directly (a compositor
 * property) and the component renders once per prop change, not once per frame. The accessible name
 * is refreshed by the same loop at a human pace, not per frame.
 */
export function MicLevelMeter({ stream, active }: { stream: MediaStream | null; active: boolean }) {
  const meterRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const meter = meterRef.current;
    const fill = fillRef.current;
    if (!meter || !fill) return undefined;

    const setLevel = (level: number) => {
      fill.style.transform = `scaleX(${level})`;
    };
    setLevel(0);

    const track = stream?.getAudioTracks().find((candidate) => candidate.readyState === 'live');
    if (!active || !track) {
      meter.setAttribute('aria-label', 'Microphone is off');
      return undefined;
    }

    meter.setAttribute('aria-label', 'Microphone level 0 percent');
    const stop = startMicLevel(track, {
      onFrame: setLevel,
      onLabel: (percent) => meter.setAttribute('aria-label', `Microphone level ${percent} percent`),
    });
    return () => {
      stop();
      setLevel(0);
    };
  }, [stream, active]);

  return (
    <div
      ref={meterRef}
      className="mic-meter"
      role="img"
      aria-label={active ? 'Microphone level 0 percent' : 'Microphone is off'}
    >
      <div ref={fillRef} className="mic-meter-fill" style={{ transform: 'scaleX(0)' }} />
    </div>
  );
}
