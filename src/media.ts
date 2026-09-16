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

export interface DeviceOption { deviceId: string; label: string }

export function canEnumerateDevices(): boolean {
  return typeof navigator.mediaDevices?.enumerateDevices === 'function';
}

export async function listDevices(): Promise<{ cameras: DeviceOption[]; microphones: DeviceOption[] }> {
  if (!canEnumerateDevices()) return { cameras: [], microphones: [] };
  const devices = await navigator.mediaDevices.enumerateDevices();
  const label = (kind: string, index: number) => `${kind} ${index + 1}`;
  return {
    cameras: devices.filter((device) => device.kind === 'videoinput')
      .map((device, index) => ({ deviceId: device.deviceId, label: device.label || label('Camera', index) })),
    microphones: devices.filter((device) => device.kind === 'audioinput')
      .map((device, index) => ({ deviceId: device.deviceId, label: device.label || label('Microphone', index) })),
  };
}

/** Owns local camera/microphone tracks independently of room membership. */
export class LocalMedia {
  stream: MediaStream | null = null;
  readonly selectedDevice: { audio?: string; video?: string } = {};
  private generation = 0;
  private facing: 'user' | 'environment' = 'user';
  // The user's latest mute/unmute intent per kind, updated synchronously by enable()/disable().
  // acquire() reads this fresh when a pending device switch resolves, rather than trusting an
  // enabled snapshot captured before the await — otherwise a mute click during an in-flight
  // switch could be silently overwritten, re-enabling the mic/camera on the new device.
  private desiredEnabled: { audio: boolean; video: boolean } = { audio: false, video: false };

  constructor(private readonly changed: () => void) {}

  track(kind: 'audio' | 'video') {
    return this.stream?.getTracks().find((track) => track.kind === kind && track.readyState === 'live');
  }

  private async acquire(kind: 'audio' | 'video', constraint: MediaTrackConstraints) {
    const generation = this.generation;
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: kind === 'audio' ? constraint : false,
      video: kind === 'video' ? constraint : false,
    });
    // A permission prompt (or a slow device switch) can resolve after Leave or navigation.
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
      track.enabled = this.desiredEnabled[kind];
      this.stream!.addTrack(track);
      track.onended = () => this.changed();
    });
    this.changed();
  }

  async enable(kind: 'audio' | 'video'): Promise<void> {
    this.desiredEnabled[kind] = true;
    if (this.track(kind)) {
      this.track(kind)!.enabled = true;
      this.changed();
      return;
    }
    const support = browserSupportError();
    if (support) throw new Error(support);
    const preferred = this.selectedDevice[kind];
    await this.acquire(kind, kind === 'audio'
      ? { ...(preferred ? { deviceId: { exact: preferred } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : { ...(preferred ? { deviceId: { exact: preferred } } : { facingMode: this.facing }), width: { ideal: 1280 }, height: { ideal: 720 } });
  }

  /** Switches to a specific device. Only touches hardware if that kind is currently on. */
  async switchDevice(kind: 'audio' | 'video', deviceId: string): Promise<void> {
    this.selectedDevice[kind] = deviceId;
    if (!this.track(kind)?.enabled) return;
    const support = browserSupportError();
    if (support) throw new Error(support);
    await this.acquire(kind, kind === 'audio'
      ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } });
  }

  /** Flips between front/rear camera by facingMode. Only touches hardware if video is currently on. */
  async flipCamera(): Promise<void> {
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    delete this.selectedDevice.video;
    if (!this.track('video')?.enabled) return;
    const support = browserSupportError();
    if (support) throw new Error(support);
    await this.acquire('video', { facingMode: { exact: this.facing }, width: { ideal: 1280 }, height: { ideal: 720 } });
  }

  disable(kind: 'audio' | 'video') {
    this.desiredEnabled[kind] = false;
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
