import { useEffect, useRef, useState } from 'react';

const LABEL_UPDATE_INTERVAL_MS = 400; // assistive tech doesn't need frame-accurate level announcements

interface MicSamplerHandle {
  stop(): void;
}

interface MicSamplerOptions {
  track: MediaStreamTrack;
  onLevel: (level: number) => void;
  onLabelLevel: (level: number) => void;
  createAudioContext?: () => AudioContext;
  requestFrame?: (cb: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

/**
 * The analyser sampling loop, extracted out of the component so it's testable without a React/DOM
 * harness (plan11.md Task 4: "Add lifecycle tests for analyser/rAF cleanup"). Writes the visual
 * level via `onLevel` on every animation frame — the caller wires this straight to a ref-backed
 * DOM style, never React state, which is the actual fix this task exists for: the previous
 * version called setState here, re-rendering the whole component at animation-frame cadence for
 * as long as the microphone stayed active (a lesson's entire duration, not a bounded animation).
 * `onLabelLevel` is throttled internally and is the one callback safe to route into React state.
 *
 * Kept as its own copy here rather than a shared import — apps/web/src/features/classroom's
 * identical copy has the same duplication, matching this codebase's existing "ported from the
 * original apps/classroom" history rather than introducing a new shared internal package for one
 * component.
 */
export function startMicSampler(options: MicSamplerOptions): MicSamplerHandle {
  const {
    track,
    onLevel,
    onLabelLevel,
    createAudioContext = () => new AudioContext(),
    requestFrame = requestAnimationFrame,
    cancelFrame = cancelAnimationFrame,
  } = options;

  const audioContext = createAudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  const source = audioContext.createMediaStreamSource(new MediaStream([track]));
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  let frame: number;
  let lastLabelUpdate = 0;

  const tick = (t: number) => {
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (const value of data) {
      const normalized = (value - 128) / 128;
      sumSquares += normalized * normalized;
    }
    const level = Math.min(1, Math.sqrt(sumSquares / data.length) * 4);
    onLevel(level);
    if (t - lastLabelUpdate >= LABEL_UPDATE_INTERVAL_MS) {
      lastLabelUpdate = t;
      onLabelLevel(level);
    }
    frame = requestFrame(tick);
  };
  frame = requestFrame(tick);

  return {
    stop() {
      cancelFrame(frame);
      source.disconnect();
      void audioContext.close();
    },
  };
}

/** Live mic activity meter for the pre-join screen. Never records; owns its own AudioContext lifecycle. */
export function MicLevelMeter({ stream, active }: { stream: MediaStream | null; active: boolean }) {
  const fillRef = useRef<HTMLDivElement>(null);
  const [labelLevel, setLabelLevel] = useState(0);

  useEffect(() => {
    setLabelLevel(0);
    if (fillRef.current) fillRef.current.style.transform = 'scaleX(0)';
    const track = stream?.getAudioTracks().find((candidate) => candidate.readyState === 'live');
    if (!active || !track || typeof AudioContext === 'undefined') return undefined;

    const sampler = startMicSampler({
      track,
      onLevel: (level) => {
        if (fillRef.current) fillRef.current.style.transform = `scaleX(${level})`;
      },
      onLabelLevel: setLabelLevel,
    });

    return () => sampler.stop();
  }, [stream, active]);

  return (
    <div className="mic-meter" role="img" aria-label={active ? `Microphone level ${Math.round(labelLevel * 100)} percent` : 'Microphone is off'}>
      <div ref={fillRef} className="mic-meter-fill" style={{ transform: 'scaleX(0)' }} />
    </div>
  );
}
