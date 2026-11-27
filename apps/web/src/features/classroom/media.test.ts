import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMedia, mediaErrorMessage } from './media';
import { MeetingController } from './meeting';

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

describe('staying in step with the browser camera and microphone', () => {
  let list: Array<{ kind: string; deviceId: string; label: string }>;
  let asked: Array<string | undefined>;

  const mic = (deviceId: string, label: string) => ({ kind: 'audioinput', deviceId, label });

  beforeEach(() => {
    list = [mic('default', 'Default - Laptop microphone'), mic('laptop', 'Laptop microphone')];
    asked = [];
    vi.stubGlobal('window', { isSecureContext: true, RTCPeerConnection: class {} });
    vi.stubGlobal('MediaStream', FakeMediaStream);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn(async () => list),
        getUserMedia: vi.fn(async (constraints: { audio: { deviceId?: { exact: string } } }) => {
          const wanted = constraints.audio.deviceId?.exact;
          asked.push(wanted);
          const track = new FakeTrack('audio');
          return new FakeMediaStream([Object.assign(track, { getSettings: () => ({ deviceId: wanted ?? list[0].deviceId }) })]);
        }),
      },
    });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('opens the device picked while muted, not the one that was in use before', async () => {
    const media = new LocalMedia(() => {});
    await media.enable('audio');
    media.disable('audio');
    await media.switchDevice('audio', 'laptop');
    expect(asked).toHaveLength(1); // nothing is switched on while muted
    await media.enable('audio');
    expect(asked[1]).toBe('laptop');
  });

  it('names the browser device without anyone picking one, and moves a live microphone when the browser choice changes', async () => {
    const meeting = new MeetingController();
    await meeting.refreshDevices();
    expect(meeting.getSnapshot().selectedMicrophone).toBe('default');

    await meeting.toggleAudio();
    list = [mic('default', 'Default - Headset'), mic('laptop', 'Laptop microphone'), mic('headset', 'Headset')];
    await meeting.refreshDevices();
    expect(asked).toHaveLength(2);
    expect(meeting.getSnapshot().audio).toBe(true);
  });

  it('keeps a device picked by hand until it is unplugged, then goes back to the browser choice', async () => {
    const meeting = new MeetingController();
    list.push(mic('headset', 'Headset'));
    await meeting.refreshDevices();
    await meeting.toggleAudio();
    await meeting.switchMicrophone('headset');

    list = [mic('default', 'Default - Other'), mic('laptop', 'Laptop microphone'), mic('headset', 'Headset')];
    await meeting.refreshDevices();
    expect(meeting.getSnapshot().selectedMicrophone).toBe('headset');

    list = [mic('default', 'Default - Laptop microphone'), mic('laptop', 'Laptop microphone')];
    await meeting.refreshDevices();
    expect(meeting.getSnapshot().selectedMicrophone).toBe('default');
    expect(meeting.getSnapshot().mediaError).toContain('disconnected');
  });
});
