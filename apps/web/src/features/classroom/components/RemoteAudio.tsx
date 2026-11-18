import { useEffect, useRef } from 'react';

/**
 * Plays one remote participant's sound. It is mounted for as long as the person is in the room, whatever the stage is showing (the call, the
 * whiteboard, a shared screen): the picture is the tile's job and may come and go, but the sound must never stop because the view changed.
 * (Until this existed the audio lived on each tile's <video>, so opening the whiteboard removed the tiles and silenced everybody.)
 *
 * `muted` is the tutor's lock (forceMuted): a locked person is not played, as before. If the browser refuses to start sound until someone
 * has interacted with the page, `onBlocked` says so and `resume` (a number that goes up when someone presses the enable-audio button) tries again.
 */
export function RemoteAudio({ stream, muted, resume, onBlocked, onPlaying }: {
  stream: MediaStream | null;
  muted: boolean;
  resume: number;
  onBlocked: () => void;
  onPlaying: () => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    if (stream) void element.play().then(onPlaying, onBlocked);
    return () => { element.srcObject = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the callbacks are only reports; a new stream or a resume press is what restarts playback
  }, [stream, resume]);

  return <audio ref={ref} autoPlay muted={muted} className="remote-audio" aria-hidden="true" />;
}
