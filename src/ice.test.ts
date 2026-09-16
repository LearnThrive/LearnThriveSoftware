import { afterEach, describe, expect, it, vi } from 'vitest';
import { getIceConfiguration } from './ice';

describe('getIceConfiguration', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('is STUN-only when no TURN variables are set', () => {
    vi.stubEnv('VITE_TURN_URL', '');
    vi.stubEnv('VITE_TURN_USERNAME', '');
    vi.stubEnv('VITE_TURN_CREDENTIAL', '');
    expect(getIceConfiguration().iceServers).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });

  it('adds a TURN entry with every configured URL once all three variables are present', () => {
    vi.stubEnv('VITE_TURN_URL', 'turn:relay.example.com:3478, turns:relay.example.com:5349');
    vi.stubEnv('VITE_TURN_USERNAME', 'user');
    vi.stubEnv('VITE_TURN_CREDENTIAL', 'secret');
    expect(getIceConfiguration().iceServers).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: ['turn:relay.example.com:3478', 'turns:relay.example.com:5349'], username: 'user', credential: 'secret' },
    ]);
  });

  it('stays STUN-only if the credential is missing even when a URL and username are set', () => {
    vi.stubEnv('VITE_TURN_URL', 'turn:relay.example.com:3478');
    vi.stubEnv('VITE_TURN_USERNAME', 'user');
    vi.stubEnv('VITE_TURN_CREDENTIAL', '');
    expect(getIceConfiguration().iceServers).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });
});
