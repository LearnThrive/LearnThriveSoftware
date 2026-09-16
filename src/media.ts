export function mediaErrorMessage(error: unknown, device: string): string {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Please allow ${device} permission in your browser's site settings, then try again. You can also join with it off.`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No ${device} was found. Connect one and try again, or join with it off.`;
    case 'NotReadableError':
    case 'AbortError':
      return `Your ${device} is unavailable. Close another app that may be using it, then try again. You can join with it off.`;
    default:
      return `We couldn't start your ${device}. Check your device and browser settings, or join with it off.`;
  }
}

export function browserSupportError(): string | null {
  if (!window.isSecureContext) return 'Camera and microphone access need a secure connection. Open localhost on this computer, or use the temporary HTTPS link.';
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return 'This browser does not support video meetings. Please use a recent Chrome, Edge, Firefox or Safari browser.';
  return null;
}

/** Owns local device tracks independently of room membership. */
export class LocalMedia {
  stream: MediaStream | null = null;
  private generation = 0;

  constructor(private readonly changed: () => void) {}

  track(kind: 'audio' | 'video') {
    return this.stream?.getTracks().find((track) => track.kind === kind && track.readyState === 'live');
  }

  async enable(kind: 'audio' | 'video'): Promise<void> {
    const existing = this.track(kind);
    if (existing) {
      existing.enabled = true;
      this.changed();
      return;
    }
    const support = browserSupportError();
    if (support) throw new Error(support);
    const generation = this.generation;
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: kind === 'audio' ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
      video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
    });
    // A permission prompt can resolve after Leave or navigation.
    if (generation !== this.generation) {
      acquired.getTracks().forEach((track) => track.stop());
      return;
    }
    if (!this.stream) this.stream = new MediaStream();
    acquired.getTracks().forEach((track) => {
      this.stream!.getTracks().filter((old) => old.kind === kind).forEach((old) => {
        old.stop();
        this.stream!.removeTrack(old);
      });
      this.stream!.addTrack(track);
      track.onended = () => this.changed();
    });
    this.changed();
  }

  disable(kind: 'audio' | 'video') {
    const track = this.track(kind);
    if (track) track.enabled = false;
    this.changed();
  }

  state() {
    return { audio: this.track('audio')?.enabled ?? false, video: this.track('video')?.enabled ?? false };
  }

  stop() {
    this.generation += 1;
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = null;
    this.changed();
  }
}
