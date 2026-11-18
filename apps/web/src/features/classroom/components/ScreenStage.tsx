import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/** What a layer laid over the shared screen needs to know: the size the picture is shown at, and the screen's own size (the drawing's coordinates). */
export interface ScreenFrame {
  width: number;
  height: number;
  intrinsicWidth: number;
  intrinsicHeight: number;
}

/**
 * The shared screen, shown in the meeting itself instead of replacing the whole call. The picture keeps its own proportions (never cropped or
 * stretched) inside a frame that is EXACTLY as big as the picture, sized here from the space available, so anything laid over it (`overlay`:
 * the tutor's drawing layer) lines up with the screen for everyone, whatever size their window is. The sound of a share arrives with the
 * person's voice (components/RemoteAudio.tsx), so the video here is always muted.
 */
export function ScreenStage({ stream, presenter, local = false, overlay }: {
  stream: MediaStream | null;
  presenter: string;
  local?: boolean;
  overlay?: (frame: ScreenFrame) => ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [intrinsic, setIntrinsic] = useState<{ width: number; height: number } | null>(null);
  const [available, setAvailable] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.srcObject = stream;
    const measure = () => { if (element.videoWidth > 0) setIntrinsic({ width: element.videoWidth, height: element.videoHeight }); };
    element.addEventListener('loadedmetadata', measure);
    element.addEventListener('resize', measure);
    if (stream) void element.play().catch(() => undefined);
    measure();
    return () => {
      element.removeEventListener('loadedmetadata', measure);
      element.removeEventListener('resize', measure);
      element.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setAvailable({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const frame: ScreenFrame | null = intrinsic && available.width > 0 && available.height > 0
    ? (() => {
      const scale = Math.min(available.width / intrinsic.width, available.height / intrinsic.height);
      return { width: Math.floor(intrinsic.width * scale), height: Math.floor(intrinsic.height * scale), intrinsicWidth: intrinsic.width, intrinsicHeight: intrinsic.height };
    })()
    : null;

  return (
    <div className="screen-stage" ref={stageRef}>
      <div className="screen-stage__label"><Icon name="screen" size={14} />{local ? 'You are presenting' : `${presenter} is presenting`}</div>
      <div className="screen-stage__frame" style={frame ? { width: frame.width, height: frame.height } : undefined}>
        <video ref={videoRef} autoPlay playsInline muted aria-label={`${local ? 'Your' : `${presenter}'s`} shared screen`} />
        {!frame && <p className="screen-stage__loading" role="status">Loading the shared screen…</p>}
        {frame && overlay?.(frame)}
      </div>
    </div>
  );
}
