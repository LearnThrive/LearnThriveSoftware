import { useEffect, useRef, useState } from 'react';

/** Live mic activity meter for the pre-join screen. Never records; owns its own AudioContext lifecycle. */
export function MicLevelMeter({ stream, active }: { stream: MediaStream | null; active: boolean }) {
  const [level, setLevel] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    setLevel(0);
    const track = stream?.getAudioTracks().find((candidate) => candidate.readyState === 'live');
    if (!active || !track || typeof AudioContext === 'undefined') return undefined;

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    const source = audioContext.createMediaStreamSource(new MediaStream([track]));
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (const value of data) { const normalized = (value - 128) / 128; sumSquares += normalized * normalized; }
      setLevel(Math.min(1, Math.sqrt(sumSquares / data.length) * 4));
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      source.disconnect();
      void audioContext.close();
    };
  }, [stream, active]);

  return (
    <div className="mic-meter" role="img" aria-label={active ? `Microphone level ${Math.round(level * 100)} percent` : 'Microphone is off'}>
      <div className="mic-meter-fill" style={{ transform: `scaleX(${active ? level : 0})` }} />
    </div>
  );
}
