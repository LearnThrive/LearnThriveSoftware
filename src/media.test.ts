import { describe, expect, it } from 'vitest';
import { mediaErrorMessage } from './media';

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
