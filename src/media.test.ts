import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMedia, mediaErrorMessage } from './media';

describe('device errors', () => {
  it('gives permission recovery instructions without leaking internal text', () => {
    const error = new DOMException('private device detail', 'NotAllowedError');
    expect(mediaErrorMessage(error, 'camera')).toContain('permission');
    expect(mediaErrorMessage(error, 'camera')).not.toContain('private device');
  });
  it('distinguishes missing and busy devices', () => {
    expect(mediaErrorMessage(new DOMException('', 'NotFoundError'), 'microphone')).toContain('No microphone');
    expect(mediaErrorMessage(new DOMException('', 'NotReadableError'), 'camera')).toContain('another app');
  });
});

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  enabled = true;
  onended: (() => void) | null = null;
  constructor(public kind: 'audio' | 'video') {}
  stop() { this.readyState = 'ended'; }
}

class FakeMediaStream {
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) { this.tracks = tracks; }
  getTracks() { return [...this.tracks]; }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
  addTrack(track: FakeTrack) { this.tracks.push(track); }
  removeTrack(track: FakeTrack) { this.tracks = this.tracks.filter((existing) => existing !== track); }
}

describe('LocalMedia device switching (regression coverage for a race an adversarial review found)', () => {
  let pendingResolvers: Array<(stream: FakeMediaStream) => void>;

  beforeEach(() => {
    pendingResolvers = [];
    vi.stubGlobal('window', { isSecureContext: true, RTCPeerConnection: class {} });
    vi.stubGlobal('MediaStream', FakeMediaStream);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(() => new Promise((resolve: (stream: FakeMediaStream) => void) => { pendingResolvers.push(resolve); })),
      },
    });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('applies the latest mute intent rather than a stale pre-switch snapshot when a device switch resolves after a mute click', async () => {
    const media = new LocalMedia(() => {});

    const firstTrack = new FakeTrack('video');
    const enabling = media.enable('video');
    pendingResolvers[0](new FakeMediaStream([firstTrack]));
    await enabling;
    expect(media.track('video')?.enabled).toBe(true);

    const switching = media.switchDevice('video', 'camera-2');
    media.disable('video'); // the user mutes while the switch is still in flight
    const secondTrack = new FakeTrack('video');
    pendingResolvers[1](new FakeMediaStream([secondTrack]));
    await switching;

    expect(firstTrack.readyState).toBe('ended');
    expect(media.track('video')?.enabled).toBe(false);
  });

  it('leaves exactly one live track under a rapid double device switch, with no leaked track', async () => {
    const media = new LocalMedia(() => {});
    const firstTrack = new FakeTrack('audio');
    const enabling = media.enable('audio');
    pendingResolvers[0](new FakeMediaStream([firstTrack]));
    await enabling;

    const switchA = media.switchDevice('audio', 'mic-a');
    const switchB = media.switchDevice('audio', 'mic-b');
    const trackA = new FakeTrack('audio');
    const trackB = new FakeTrack('audio');
    pendingResolvers[1](new FakeMediaStream([trackA]));
    pendingResolvers[2](new FakeMediaStream([trackB]));
    await Promise.all([switchA, switchB]);

    const live = [firstTrack, trackA, trackB].filter((track) => track.readyState === 'live');
    expect(live.length).toBe(1);
    expect(media.track('audio')?.enabled).toBe(true);
  });
});
