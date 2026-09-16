export function canShareScreen(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export function screenShareErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'Screen sharing was cancelled or blocked by your browser.';
  if (name === 'NotFoundError') return 'No shareable screen or window was found.';
  return 'We could not start screen sharing. Please try again.';
}

/** Owns the display-capture stream independently of the camera/microphone. */
export class ScreenShare {
  stream: MediaStream | null = null;
  private generation = 0;

  constructor(private readonly onEnded: () => void) {}

  async start(): Promise<MediaStreamTrack> {
    const generation = this.generation;
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const [track] = stream.getVideoTracks();
    // A picker left open across a Leave (stop() bumps the generation) must not resurrect a
    // capture that's already meant to be over.
    if (generation !== this.generation) {
      track.stop();
      return track;
    }
    // Fires on the browser-native "Stop sharing" bar, not just our own Stop button.
    track.onended = () => { this.stop(); this.onEnded(); };
    this.stream = stream;
    return track;
  }

  stop() {
    this.generation += 1;
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = null;
  }
}
