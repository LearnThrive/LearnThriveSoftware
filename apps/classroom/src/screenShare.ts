export function canShareScreen(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export function screenShareErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'Screen sharing was cancelled or blocked by your browser.';
  if (name === 'NotFoundError') return 'No shareable screen or window was found.';
  return 'We could not start screen sharing. Please try again.';
}

export interface ScreenShareTracks { video: MediaStreamTrack; audio: MediaStreamTrack | null }

/** Owns the display-capture stream independently of the camera/microphone. */
export class ScreenShare {
  stream: MediaStream | null = null;
  /** The track actually being sent as the outgoing audio override — the mixed track when both
   * mic and screen audio are present, the raw screen-audio track alone otherwise, or null. Used
   * to re-attach the current share to a freshly (re)created PeerSession — see meeting.ts's startPeer. */
  outgoingAudioTrack: MediaStreamTrack | null = null;
  hasAudio = false;
  private generation = 0;
  private audioContext: AudioContext | null = null;

  constructor(private readonly onEnded: () => void) {}

  // The browser's own picker remains authoritative over tab/window/screen choice — this never
  // enumerates or selects a source itself. `micTrack`, if provided, is mixed with any captured
  // screen/tab/system audio via Web Audio so peers hear both at once, not one replacing the other.
  async start(micTrack: MediaStreamTrack | null): Promise<ScreenShareTracks> {
    const generation = this.generation;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, audio: true,
      // Chromium-only hints, silently ignored elsewhere: don't offer our own tab as a share
      // target (avoids an infinite-mirror pick), let the user switch which tab/window/screen is
      // shared without restarting the capture, and surface a "share tab/system audio" checkbox.
      selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include',
    } as DisplayMediaStreamOptions);
    // A picker left open across a Leave (stop() bumps the generation) must not resurrect a
    // capture that's already meant to be over.
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      return { video: stream.getVideoTracks()[0], audio: null };
    }
    const [videoTrack] = stream.getVideoTracks();
    const [screenAudioTrack] = stream.getAudioTracks();
    this.hasAudio = Boolean(screenAudioTrack);
    this.stream = stream;
    // Fires on the browser-native "Stop sharing" bar, not just our own Stop button — this is the
    // one signal that reliably fires regardless of which track the browser considers primary, so
    // both the video and any audio override are torn down together from here.
    videoTrack.onended = () => { this.stop(); this.onEnded(); };
    this.outgoingAudioTrack = screenAudioTrack
      ? (micTrack ? this.mixWithMicrophone(micTrack, screenAudioTrack) : screenAudioTrack)
      : null;
    return { video: videoTrack, audio: this.outgoingAudioTrack };
  }

  private mixWithMicrophone(mic: MediaStreamTrack, screen: MediaStreamTrack): MediaStreamTrack {
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    // Bound to these exact track objects at mix time — a later microphone *device switch*
    // (a new track object) won't be picked up by an in-progress mix; muting the existing mic
    // track (`.enabled = false`) works fine, since that's the same object staying silent.
    context.createMediaStreamSource(new MediaStream([mic])).connect(destination);
    context.createMediaStreamSource(new MediaStream([screen])).connect(destination);
    this.audioContext = context;
    return destination.stream.getAudioTracks()[0];
  }

  stop() {
    this.generation += 1;
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = null;
    this.hasAudio = false;
    this.outgoingAudioTrack?.stop();
    this.outgoingAudioTrack = null;
    void this.audioContext?.close();
    this.audioContext = null;
  }
}
